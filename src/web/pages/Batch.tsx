import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { partitionDuplicates } from "@/shared/dedupe";
import { detectIdentifierType, normalizeIdentifier } from "@/shared/identifier";
import type { Doctor, Poli, RegistrationOption } from "@/shared/schema";
import type { IdentifierType, Job, NewItem, QueueItem, Settings } from "@/shared/types";
import { batchHasUnsavedWork } from "@/shared/unsaved";
import { ExcelPanel } from "@/web/components/ExcelPanel";
import { QueueTable } from "@/web/components/QueueTable";
import { api, subscribeJob } from "@/web/lib/api";
import { IDENTIFIER_LABEL } from "@/web/lib/format";

const NONE = "__none__";

/** "auto" menebak jenis identitas per baris dari bentuk nomornya. */
type IdentifierChoice = IdentifierType | "auto";

const IDENTIFIER_CHOICE_LABEL: Record<IdentifierChoice, string> = {
  auto: "Auto",
  nik: IDENTIFIER_LABEL.nik,
  bpjs: IDENTIFIER_LABEL.bpjs,
  no_rm: IDENTIFIER_LABEL.no_rm,
};

export function Batch({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [poli, setPoli] = useState<Poli[]>([]);
  const [poliLoading, setPoliLoading] = useState(true);
  const [doctorsByPoli, setDoctorsByPoli] = useState<Record<string, Doctor[]>>({});

  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  /** Job lama di SQLite; tidak dimuat otomatis supaya tabel tidak berisi data lama. */
  const [previousJob, setPreviousJob] = useState<Job | null>(null);

  // poscheck + petugas dari server: nama lokasi tidak pernah diketik manual
  const [poscheck, setPoscheck] = useState<RegistrationOption[]>([]);
  const [petugas, setPetugas] = useState<RegistrationOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  // panel input
  const [panel, setPanel] = useState<"input" | "excel">("input");
  const [identifierChoice, setIdentifierChoice] = useState<IdentifierChoice>("auto");
  const [poliId, setPoliId] = useState(NONE);
  const [doctorCode, setDoctorCode] = useState(NONE);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [poscheckId, setPoscheckId] = useState(NONE);
  const [tenaga, setTenaga] = useState("");
  const [fallback, setFallback] = useState(false);
  const [identifier, setIdentifier] = useState("");
  /** File Excel sudah dibaca tapi barisnya belum ditambahkan ke tabel. */
  const [excelPending, setExcelPending] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  /* ------------------------------ subscribe ---------------------------- */

  const subscribe = useCallback((jobId: string) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = subscribeJob(jobId, (event) => {
      if (event.type === "items") {
        setItems(event.items);
        return;
      }
      if (event.type === "job") {
        setJob((prev) => (prev ? { ...prev, state: event.state } : prev));
        return;
      }
      if (event.type === "item") {
        setItems((prev) => {
          const index = prev.findIndex((item) => item.id === event.item.id);
          if (index < 0) return prev;
          const next = [...prev];
          next[index] = event.item;
          return next;
        });
      }
    });
  }, []);

  /* ----------------------------- bootstrap ----------------------------- */

  useEffect(() => {
    // Pengaturan + poscheck + petugas selalu dari server. Nama lokasi tidak
    // pernah disimpan di client supaya tidak melenceng dari tabel `poschecks`.
    void (async () => {
      try {
        const [current, options] = await Promise.all([api.getSettings(), api.options()]);
        setSettings(current);
        setPoscheck(options.poscheck);
        setPetugas(options.petugas);
        setTenaga(current.defaultTenaga || options.terpilih.petugas_id);
        const preferred =
          current.defaultPoscheckId &&
          options.poscheck.some((item) => item.id === current.defaultPoscheckId)
            ? current.defaultPoscheckId
            : options.terpilih.poscheck_id || options.poscheck[0]?.id || NONE;
        setPoscheckId(preferred);
      } catch {
        // biarkan default
      } finally {
        setOptionsLoading(false);
      }
    })();

    void (async () => {
      try {
        const list = await api.listPoli();
        setPoli(list);
      } catch {
        setPoli([]);
      } finally {
        setPoliLoading(false);
      }
    })();

    // Job lama TIDAK dimuat otomatis: membuka menu Batch harus mulai dari
    // tabel kosong, bukan sisa sesi sebelumnya. Operator memilih sendiri
    // lewat tombol "Lanjutkan antrian tersimpan" kalau memang mau meneruskan.
    void (async () => {
      try {
        const jobs = await api.listJobs();
        setPreviousJob(jobs[0] ?? null);
      } catch {
        setPreviousJob(null);
      }
    })();

    return () => unsubscribeRef.current?.();
  }, []);

  /* ------------------------------- doctors ----------------------------- */

  const loadDoctors = useCallback(async (id: string) => {
    try {
      const list = await api.listDoctors(id);
      setDoctorsByPoli((prev) => ({ ...prev, [id]: list.dokter }));
    } catch {
      setDoctorsByPoli((prev) => ({ ...prev, [id]: [] }));
    }
  }, []);

  // Poli berganti -> daftar dokter ikut berganti dan pilihan dokter lama
  // dibuang. Tanpa reset, kode dokter dari poli sebelumnya ikut terkirim.
  useEffect(() => {
    if (poliId === NONE) {
      setDoctorCode(NONE);
      setDoctorsLoading(false);
      return;
    }
    let cancelled = false;
    setDoctorCode(NONE);
    setDoctorsLoading(true);
    void (async () => {
      try {
        const list = await api.listDoctors(poliId);
        if (cancelled) return;
        setDoctorsByPoli((prev) => ({ ...prev, [poliId]: list.dokter }));
        // Satu dokter = otomatis; lebih dari satu = operator harus memilih.
        const auto =
          list.dipilih?.kode_dokter ??
          (list.dokter.length === 1 ? list.dokter[0]?.kode_dokter : undefined);
        setDoctorCode(auto ?? NONE);
      } catch {
        if (!cancelled) setDoctorsByPoli((prev) => ({ ...prev, [poliId]: [] }));
      } finally {
        if (!cancelled) setDoctorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poliId]);

  // muat daftar dokter poli saat poli bertukar (dipakai panel Excel)
  useEffect(() => {
    for (const item of poli) {
      if (!doctorsByPoli[item.id]) void loadDoctors(item.id);
    }
  }, [poli, doctorsByPoli, loadDoctors]);

  /* -------------------------------- items ------------------------------ */

  const selectedDoctors = doctorsByPoli[poliId] ?? [];

  const selectedPoscheck = useMemo(
    () => poscheck.find((item) => item.id === poscheckId),
    [poscheck, poscheckId],
  );

  // Baris yang sudah masuk tabel aman (tersimpan di SQLite), jadi yang
  // dianggap belum selesai hanya isian yang belum ditekan "Tambah".
  const dirty = batchHasUnsavedWork(identifier, excelPending);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const addItems = async (newItems: NewItem[]) => {
    // Tolak duplikat (identitas + poli + dokter), baik terhadap isi tabel
    // maupun terhadap baris lain di batch ini. Lihat `shared/dedupe.ts`.
    const { accepted, rejected } = partitionDuplicates(
      newItems,
      items.map((item) => ({
        identifierType: item.patient.type,
        identifierValue: item.patient.value,
        poliId: item.poliId,
        doctorCode: item.doctorCode,
      })),
    );

    if (rejected.length > 0) {
      toast.warning(`${rejected.length} baris duplikat dilewati`);
    }
    if (accepted.length === 0) return;

    try {
      if (!job) {
        const created = await api.createJob({
          source: "input",
          fallback,
          items: accepted.map((item) => ({
            identifierType: item.identifierType,
            identifierValue: item.identifierValue,
            poliId: item.poliId,
            doctorCode: item.doctorCode,
            poscheckId: item.poscheckId,
            lokasi: item.lokasi,
            tenaga: item.tenaga,
            fallback: item.fallback,
          })),
        });
        setJob(created.job);
        setItems(created.items);
        subscribe(created.job.id);
      } else {
        const updated = await api.appendItems(
          job.id,
          accepted.map((item) => ({
            identifierType: item.identifierType,
            identifierValue: item.identifierValue,
            poliId: item.poliId,
            doctorCode: item.doctorCode,
            poscheckId: item.poscheckId,
            lokasi: item.lokasi,
            tenaga: item.tenaga,
            fallback: item.fallback,
          })),
        );
        setItems(updated);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambah antrian");
    }
  };

  const addFromInput = () => {
    if (poliId === NONE) {
      toast.error("Pilih poli dulu");
      return;
    }
    const rawValues = identifier
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter((value) => value !== "");

    if (rawValues.length === 0) {
      toast.error("Isi identitas pasien dulu");
      return;
    }
    if (selectedDoctors.length > 1 && doctorCode === NONE) {
      toast.error("Pilih dokter dulu");
      return;
    }

    // Validasi bentuk identitas sebelum masuk tabel (lihat shared/identifier.ts).
    // Mode Auto menebak jenis per baris, karena satu batch boleh mencampur
    // NIK, No. BPJS, dan No. RM.
    const rows: Array<{ identifierType: IdentifierType; identifierValue: string }> = [];
    let skipped = 0;
    let firstError: string | null = null;
    for (const raw of rawValues) {
      const type = identifierChoice === "auto" ? detectIdentifierType(raw) : identifierChoice;
      const result = normalizeIdentifier(type, raw);
      if (result.ok) {
        rows.push({ identifierType: type, identifierValue: result.value });
      } else {
        skipped += 1;
        firstError ??= result.message;
      }
    }

    if (rows.length === 0) {
      toast.error(firstError ?? "Identitas tidak valid");
      return;
    }
    if (skipped > 0) {
      toast.warning(`${skipped} baris dilewati: ${firstError ?? ""}`);
    }

    void addItems(
      rows.map((row) => ({
        identifierType: row.identifierType,
        identifierValue: row.identifierValue,
        poliId,
        doctorCode: doctorCode === NONE ? "" : doctorCode,
        poscheckId: selectedPoscheck?.id ?? settings?.defaultPoscheckId ?? "",
        lokasi: selectedPoscheck?.nama ?? "",
        tenaga,
        fallback,
      })),
    );
    setIdentifier("");
  };

  /** Muat job lama hanya kalau operator memintanya - bukan saat tab dibuka. */
  const openPrevious = async () => {
    if (!previousJob) return;
    try {
      const payload = await api.getJob(previousJob.id);
      setJob(payload.job);
      setItems(payload.items);
      subscribe(payload.job.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuka antrian tersimpan");
    }
  };

  const reorder = async (ids: string[]) => {
    setItems((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      return ids
        .map((id) => byId.get(id))
        .filter((item): item is QueueItem => item !== undefined);
    });
    if (!job) return;
    try {
      await api.reorder(job.id, ids);
    } catch {
      // urutan akan kembali dari server
    }
  };

  /* ------------------------------ kontrol ------------------------------ */

  const running = job?.state === "running" || job?.state === "paused";
  const pending = items.filter((item) => item.status === "menunggu").length;
  const done = items.filter((item) => item.status === "sukses").length;
  const failed = items.filter((item) => item.status === "gagal").length;
  const progress = items.length === 0 ? 0 : Math.round(((done + failed) / items.length) * 100);

  const start = async () => {
    if (!job) return;
    try {
      await api.start(job.id);
      setJob((prev) => (prev ? { ...prev, state: "running" } : prev));
      toast.success("Pengiriman antrian dimulai");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memulai");
    }
  };

  const pause = async () => {
    if (!job) return;
    await api.pause(job.id);
    setJob((prev) => (prev ? { ...prev, state: "paused" } : prev));
  };

  const resume = async () => {
    if (!job) return;
    await api.resume(job.id);
    setJob((prev) => (prev ? { ...prev, state: "running" } : prev));
  };

  const stop = async () => {
    if (!job) return;
    await api.stop(job.id);
    setJob((prev) => (prev ? { ...prev, state: "stopped" } : prev));
  };

  const clearAll = async () => {
    if (!job) return;
    await api.deleteJob(job.id);
    setJob(null);
    setItems([]);
    // Sisa job lain (kalau ada) masih bisa dibuka lewat tombol di tabel kosong.
    try {
      const jobs = await api.listJobs();
      setPreviousJob(jobs[0] ?? null);
    } catch {
      setPreviousJob(null);
    }
  };

  /* -------------------------------- view ------------------------------- */

  return (
    <div className="space-y-6">
      {/* Hanya trigger tab yang dipakai; panel dirender sendiri di bawah.
          `TabsContent` + `forceMount` membuat SEMUA panel selalu "present"
          (Radix mengatur `hidden` dari hasil Presence), sehingga panel Import
          Excel ikut tampil di tab Input. Dengan div + `hidden`, panel yang
          tidak aktif tetap ter-mount tapi benar-benar tersembunyi. */}
      <Tabs value={panel} onValueChange={(value) => setPanel(value as "input" | "excel")}>
        <TabsList>
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="excel">Import Excel</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className={panel === "input" ? "space-y-4" : "hidden"}>
        <Card>
          <CardHeader>
            <CardTitle>Tambah antrian</CardTitle>
            <CardDescription>
              Pilih poli, lalu masukkan identitas pasien. Baris masuk ke tabel di bawah dan
              dikirim saat tombol Kirim ditekan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="batchPoli">Poli</Label>
                {poliLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select value={poliId} onValueChange={setPoliId}>
                    <SelectTrigger id="batchPoli" className="w-full">
                      <SelectValue placeholder="Pilih poli" />
                    </SelectTrigger>
                    <SelectContent>
                      {poli.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.nama}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="batchDokter">Dokter</Label>
                {poliId === NONE ? (
                  <p className="text-sm text-muted-foreground">Pilih poli terlebih dahulu.</p>
                ) : doctorsLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : selectedDoctors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Tidak ada dokter terjadwal di poli ini.
                  </p>
                ) : (
                  <Select
                    value={doctorCode}
                    onValueChange={setDoctorCode}
                    disabled={selectedDoctors.length === 1}
                  >
                    <SelectTrigger id="batchDokter" className="w-full">
                      <SelectValue placeholder="Pilih dokter" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedDoctors.map((doctor) => (
                        <SelectItem key={doctor.kode_dokter} value={doctor.kode_dokter}>
                          {doctor.nama_dokter} ({doctor.jam_praktek})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Lokasi & petugas tampil berpasangan. Kalau salah satu daftar
                  belum termuat, keduanya disembunyikan dan server memakai
                  pengaturan default - jangan tampilkan setengah pasang. */}
              {poscheck.length > 0 && petugas.length > 0 ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="batchLokasi">Lokasi pemeriksaan</Label>
                    <Select value={poscheckId} onValueChange={setPoscheckId}>
                      <SelectTrigger id="batchLokasi" className="w-full">
                        <SelectValue placeholder="Pilih lokasi" />
                      </SelectTrigger>
                      <SelectContent>
                        {poscheck.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.nama}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="batchPetugas">Petugas</Label>
                    <Select value={tenaga} onValueChange={setTenaga}>
                      <SelectTrigger id="batchPetugas" className="w-full">
                        <SelectValue placeholder="Pilih petugas" />
                      </SelectTrigger>
                      <SelectContent>
                        {petugas.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.nama}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {optionsLoading
                    ? "Memuat daftar lokasi & petugas dari server…"
                    : "Lokasi & petugas belum termuat dari server. Keduanya memakai pengaturan default."}
                </p>
              )}
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={fallback}
                onCheckedChange={(checked) => setFallback(checked === true)}
              />
              <span>
                <span className="font-medium">Fallback pasien baru</span>
                <span className="block text-xs text-muted-foreground">
                  Kalau pasien tidak ditemukan saat dikirim, terbitkan nomor antrian sebagai
                  pasien baru (tanpa data pasien).
                </span>
              </span>
            </label>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Jenis identitas</legend>
              <RadioGroup
                value={identifierChoice}
                onValueChange={(value) => setIdentifierChoice(value as IdentifierChoice)}
                className="flex flex-wrap gap-4"
              >
                {(Object.keys(IDENTIFIER_CHOICE_LABEL) as IdentifierChoice[]).map((choice) => (
                  <label key={choice} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={choice} id={`batch-id-${choice}`} />
                    <span>{IDENTIFIER_CHOICE_LABEL[choice]}</span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="batchIdentifier">
                {identifierChoice === "auto"
                  ? "Identitas pasien"
                  : `${IDENTIFIER_LABEL[identifierChoice]} pasien`}
              </Label>
              <Input
                id="batchIdentifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Satu nomor per baris (bisa banyak)"
              />
              {identifierChoice === "auto" ? (
                <p className="text-xs text-muted-foreground">
                  NIK 16 digit, No. BPJS 13 digit, sisanya No. RM. Tiap baris ditebak sendiri.
                </p>
              ) : null}
            </div>

            <Button onClick={addFromInput}>Tambah ke Antrean</Button>
          </CardContent>
        </Card>
      </div>

      {/* Panel Excel tetap ter-mount: pindah tab tidak boleh membuang file
          yang sudah dibaca. */}
      <div className={panel === "excel" ? "" : "hidden"}>
        <ExcelPanel
          doctorsByPoli={doctorsByPoli}
          poscheck={poscheck}
          defaultPoscheckId={selectedPoscheck?.id ?? settings?.defaultPoscheckId ?? ""}
          defaultTenaga={tenaga || settings?.defaultTenaga || ""}
          fallback={fallback}
          onAdd={(newItems) => void addItems(newItems)}
          onPendingChange={setExcelPending}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Antrean</CardTitle>
          <CardDescription>
            Urutan baris = urutan pengiriman. Drag handle untuk mengubah urutan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Belum ada antrian</EmptyTitle>
                <EmptyDescription>
                  Tambahkan lewat tab Input, atau import dari Excel.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {previousJob ? (
                  <Button variant="outline" size="sm" onClick={() => void openPrevious()}>
                    Buka antrian tersimpan
                  </Button>
                ) : null}
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-2">
                  {running && job?.state === "paused" ? (
                    <Button size="sm" onClick={resume}>
                      Lanjutkan
                    </Button>
                  ) : (
                    <Button size="sm" onClick={start} disabled={running || pending === 0}>
                      Kirim
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={pause} disabled={job?.state !== "running"}>
                    Pause
                  </Button>
                  <Button size="sm" variant="outline" onClick={stop} disabled={!running}>
                    Stop
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearAll}>
                    Hapus semua
                  </Button>
                </div>

                <div className="flex min-w-48 flex-1 items-center gap-2">
                  <Progress value={progress} className="h-2" />
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {done}/{items.length} sukses · {failed} gagal · {pending} menunggu
                  </span>
                </div>
              </div>

              {failed > 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>{failed} baris gagal</AlertTitle>
                  <AlertDescription>
                    Lihat kolom Pesan di tabel untuk alasannya.
                  </AlertDescription>
                </Alert>
              ) : null}

              <QueueTable items={items} onReorder={(ids) => void reorder(ids)} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
