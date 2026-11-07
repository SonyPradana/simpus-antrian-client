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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { partitionDuplicates } from "@/shared/dedupe";
import { normalizeIdentifier } from "@/shared/identifier";
import type { Doctor, Poli } from "@/shared/schema";
import type { IdentifierType, Job, NewItem, QueueItem, Settings } from "@/shared/types";
import { ExcelPanel } from "@/web/components/ExcelPanel";
import { QueueTable } from "@/web/components/QueueTable";
import { api, subscribeJob } from "@/web/lib/api";
import { IDENTIFIER_LABEL } from "@/web/lib/format";

const NONE = "__none__";

export function Batch() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [poli, setPoli] = useState<Poli[]>([]);
  const [poliLoading, setPoliLoading] = useState(true);
  const [doctorsByPoli, setDoctorsByPoli] = useState<Record<string, Doctor[]>>({});

  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);

  // panel input
  const [idType, setIdType] = useState<IdentifierType>("nik");
  const [poliId, setPoliId] = useState(NONE);
  const [doctorCode, setDoctorCode] = useState(NONE);
  const [fallback, setFallback] = useState(false);
  const [identifier, setIdentifier] = useState("");

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
    void (async () => {
      try {
        setSettings(await api.getSettings());
      } catch {
        // biarkan default
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

    // lanjutkan job terakhir yang ada (biar refresh tidak kehilangan antrian)
    void (async () => {
      try {
        const jobs = await api.listJobs();
        const last = jobs[0];
        if (!last) return;
        const payload = await api.getJob(last.id);
        setJob(payload.job);
        setItems(payload.items);
        subscribe(payload.job.id);
      } catch {
        // tidak ada job
      }
    })();

    return () => unsubscribeRef.current?.();
  }, [subscribe]);

  /* ------------------------------- doctors ----------------------------- */

  const loadDoctors = useCallback(async (id: string) => {
    try {
      const list = await api.listDoctors(id);
      setDoctorsByPoli((prev) => ({ ...prev, [id]: list.dokter }));
    } catch {
      setDoctorsByPoli((prev) => ({ ...prev, [id]: [] }));
    }
  }, []);

  useEffect(() => {
    if (poliId === NONE) {
      setDoctorCode(NONE);
      return;
    }
    void loadDoctors(poliId);
  }, [poliId, loadDoctors]);

  // muat daftar dokter poli saat poli bertukar (dipakai panel Excel)
  useEffect(() => {
    for (const item of poli) {
      if (!doctorsByPoli[item.id]) void loadDoctors(item.id);
    }
  }, [poli, doctorsByPoli, loadDoctors]);

  /* -------------------------------- items ------------------------------ */

  const selectedDoctors = doctorsByPoli[poliId] ?? [];

  const template = useMemo(
    () => settings?.lokasiTemplates.find((item) => item.nama === settings.defaultLokasi),
    [settings],
  );

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
    const values: string[] = [];
    let skipped = 0;
    let firstError: string | null = null;
    for (const raw of rawValues) {
      const result = normalizeIdentifier(idType, raw);
      if (result.ok) {
        values.push(result.value);
      } else {
        skipped += 1;
        firstError ??= result.message;
      }
    }

    if (values.length === 0) {
      toast.error(firstError ?? "Identitas tidak valid");
      return;
    }
    if (skipped > 0) {
      toast.warning(`${skipped} baris dilewati: ${firstError ?? ""}`);
    }

    void addItems(
      values.map((value) => ({
        identifierType: idType,
        identifierValue: value,
        poliId,
        doctorCode: doctorCode === NONE ? "" : doctorCode,
        poscheckId: template?.id ?? settings?.defaultPoscheckId ?? "",
        lokasi: settings?.defaultLokasi ?? "",
        tenaga: settings?.defaultTenaga ?? "",
        fallback,
      })),
    );
    setIdentifier("");
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
  };

  /* -------------------------------- view ------------------------------- */

  return (
    <div className="space-y-6">
      <Tabs defaultValue="input">
        <TabsList>
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="excel">Import Excel</TabsTrigger>
        </TabsList>

        <TabsContent value="input" className="mt-4 space-y-4">
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
                            {doctor.nama_dokter}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
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
                  value={idType}
                  onValueChange={(value) => setIdType(value as IdentifierType)}
                  className="flex flex-wrap gap-4"
                >
                  {(Object.keys(IDENTIFIER_LABEL) as IdentifierType[]).map((type) => (
                    <label key={type} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value={type} id={`batch-id-${type}`} />
                      <span>{IDENTIFIER_LABEL[type]}</span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="batchIdentifier">{IDENTIFIER_LABEL[idType]} pasien</Label>
                <Input
                  id="batchIdentifier"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder={`${IDENTIFIER_LABEL[idType]}, satu per baris (bisa banyak)`}
                />
              </div>

              <Button onClick={addFromInput}>Tambah ke Antrean</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="excel" className="mt-4">
          <ExcelPanel
            doctorsByPoli={doctorsByPoli}
            lokasiTemplates={settings?.lokasiTemplates ?? []}
            defaultLokasi={settings?.defaultLokasi ?? ""}
            defaultPoscheckId={settings?.defaultPoscheckId ?? ""}
            defaultTenaga={settings?.defaultTenaga ?? ""}
            fallback={fallback}
            onAdd={(newItems) => void addItems(newItems)}
          />
        </TabsContent>
      </Tabs>

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
              <EmptyContent />
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
