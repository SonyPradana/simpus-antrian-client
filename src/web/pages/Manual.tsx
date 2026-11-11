import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  APMLookupResult,
  APMQueueBody,
  APMQueueResult,
  Doctor,
  Poli,
  RegistrationOption,
} from "@/shared/schema";
import { detectIdentifierType, normalizeIdentifier } from "@/shared/identifier";
import { actionForLookup, identifierKey, lookupReasonLabel } from "@/shared/mode";
import type { IdentifierType } from "@/shared/types";
import { manualHasUnsavedWork } from "@/shared/unsaved";
import { ClientError, api } from "@/web/lib/api";
import { IDENTIFIER_LABEL } from "@/web/lib/format";

const NONE = "__none__";

/** Pilihan radio identitas: "auto" menebak dari bentuk nomor. */
type IdentifierChoice = IdentifierType | "auto";

const IDENTIFIER_CHOICE_LABEL: Record<IdentifierChoice, string> = {
  auto: "Auto",
  nik: IDENTIFIER_LABEL.nik,
  bpjs: IDENTIFIER_LABEL.bpjs,
  no_rm: IDENTIFIER_LABEL.no_rm,
};

interface StepProps {
  step: number;
  label: string;
  active: boolean;
}

function StepIndicator({ steps }: { steps: StepProps[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((step, index) => (
        <li key={step.step} className="flex items-center gap-2">
          <span
            className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
              step.active
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {step.step}
          </span>
          <span className={step.active ? "font-medium" : "text-muted-foreground"}>
            {step.label}
          </span>
          {index < steps.length - 1 ? (
            <span className="mx-1 h-px w-6 bg-border" aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function Manual({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [step, setStep] = useState(1);
  const [poli, setPoli] = useState<Poli[]>([]);
  const [poliLoading, setPoliLoading] = useState(true);

  // step 1
  const [identifierChoice, setIdentifierChoice] = useState<IdentifierChoice>("auto");
  const [identifierValue, setIdentifierValue] = useState("");
  const [lokasiId, setLokasiId] = useState(NONE);
  const [tenaga, setTenaga] = useState("");
  const [petugas, setPetugas] = useState<Array<{ id: string; nama: string }>>([]);
  const [poscheck, setPoscheck] = useState<RegistrationOption[]>([]);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<ClientError | null>(null);
  const [patient, setPatient] = useState<APMLookupResult | null>(null);

  // fallback pasien baru
  const [fallback, setFallback] = useState(false);
  /** Mode tanpa identitas: lewati pencarian, terbitkan nomor sebagai pasien baru. */
  const [blankQueue, setBlankQueue] = useState(false);

  // step 2
  const [poliId, setPoliId] = useState(NONE);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorCode, setDoctorCode] = useState(NONE);
  const [doctorsLoading, setDoctorsLoading] = useState(false);

  // step 3
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ClientError | null>(null);
  const [result, setResult] = useState<APMQueueResult | null>(null);
  const [issuedCode, setIssuedCode] = useState("");

  useEffect(() => {
    // Petugas + poscheck selalu dari server: nama lokasi tidak pernah
    // diketik manual di client, supaya tidak melenceng dari tabel `poschecks`.
    void (async () => {
      try {
        const [options, current] = await Promise.all([
          api.options(),
          api.getSettings().catch(() => null),
        ]);
        setPetugas(options.petugas);
        setPoscheck(options.poscheck);
        setTenaga(current?.defaultTenaga || options.terpilih.petugas_id);
        const preferred =
          current?.defaultPoscheckId && options.poscheck.some((p) => p.id === current.defaultPoscheckId)
            ? current.defaultPoscheckId
            : options.terpilih.poscheck_id || options.poscheck[0]?.id || NONE;
        setLokasiId(preferred);
      } catch {
        setPetugas([]);
        setPoscheck([]);
      }
    })();

    void (async () => {
      try {
        setPoli(await api.listPoli());
      } catch {
        setPoli([]);
      } finally {
        setPoliLoading(false);
      }
    })();
  }, []);

  const selectedPoscheck = useMemo(
    () => poscheck.find((item) => item.id === lokasiId),
    [poscheck, lokasiId],
  );

  // Isian dianggap berjalan kalau operator sudah mengetik identitas atau
  // sudah masuk step 2/3. Step 4 (nomor terbit) bukan isian yang bisa hilang.
  const dirty = manualHasUnsavedWork(step, identifierValue);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const detectedType = useMemo(
    () => detectIdentifierType(identifierValue),
    [identifierValue],
  );
  const identifierType: IdentifierType =
    identifierChoice === "auto" ? detectedType : identifierChoice;

  const selectedPoli = useMemo(() => poli.find((item) => item.id === poliId), [poli, poliId]);

  // poli berubah -> daftar dokter berubah -> kode dokter reset
  useEffect(() => {
    if (poliId === NONE) {
      setDoctors([]);
      setDoctorCode(NONE);
      return;
    }
    let cancelled = false;
    setDoctorsLoading(true);
    void (async () => {
      try {
        const list = await api.listDoctors(poliId);
        if (cancelled) return;
        setDoctors(list.dokter);
        if (list.dipilih) setDoctorCode(list.dipilih.kode_dokter);
        else if (list.dokter.length === 1) setDoctorCode(list.dokter[0]?.kode_dokter ?? NONE);
        else setDoctorCode(NONE);
      } catch {
        if (!cancelled) {
          setDoctors([]);
          setDoctorCode(NONE);
        }
      } finally {
        if (!cancelled) setDoctorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poliId]);

  const reset = useCallback(() => {
    setStep(1);
    setBlankQueue(false);
    setIdentifierValue("");
    setPatient(null);
    setLookupError(null);
    setFallback(false);
    setPoliId(NONE);
    setDoctorCode(NONE);
    setSaveError(null);
    setResult(null);
  }, []);

  const startBlankQueue = () => {
    // Tanpa identitas: set flag lalu masuk Step 2. Penulisan terjadi di
    // Step 3 (mode=blank), supaya operator masih bisa membatalkan.
    setFallback(true);
    setBlankQueue(true);
    setPatient(null);
    setLookupError(null);
    setIdentifierValue("");
    setPoliId(NONE);
    setDoctorCode(NONE);
    setSaveError(null);
    setResult(null);
    setStep(2);
  };

  const continueWithoutId = () => {
    setFallback(true);
    setBlankQueue(true);
    setPatient(null);
    setLookupError(null);
    setPoliId(NONE);
    setDoctorCode(NONE);
    setSaveError(null);
    setResult(null);
    setStep(2);
  };

  const search = async () => {
    // Validasi bentuk dulu: lebih baik ditolak di sini daripada server
    // mengembalikan "pasien tidak ditemukan" untuk nomor yang rusak.
    const normalized = normalizeIdentifier(identifierType, identifierValue);
    if (!normalized.ok) {
      toast.error(normalized.message);
      return;
    }

    setLooking(true);
    setLookupError(null);
    setPatient(null);
    setFallback(false);
    try {
      const found = await api.lookup({ type: identifierType, value: normalized.value });
      setIdentifierValue(normalized.value);
      setPatient(found);
      // Keputusan registration vs blank datang dari server (docs/conventions.md 2.9),
      // bukan dari ada/tidaknya `patient`.
      setFallback(actionForLookup(found) === "blank");
      setStep(2);
    } catch (error) {
      if (error instanceof ClientError) setLookupError(error);
      else toast.error(error instanceof Error ? error.message : "Pencarian gagal");
    } finally {
      setLooking(false);
    }
  };

  const save = async () => {
    if (poliId === NONE) return;
    setSaving(true);
    setSaveError(null);
    try {
      const mode = fallback ? "blank" : "registration";
      const body: APMQueueBody = {
        mode,
        poli_id: poliId,
        ...(doctorCode !== NONE ? { kode_dokter: doctorCode } : {}),
        ...(selectedPoscheck ? { poscheck_id: selectedPoscheck.id } : {}),
      };

      if (mode === "registration") {
        if (!tenaga) {
          setSaveError(null);
          toast.error("Tenaga pendaftaran wajib diisi untuk pendaftaran.");
          return;
        }
        const normalized = normalizeIdentifier(identifierType, identifierValue);
        if (!normalized.ok) {
          toast.error(normalized.message);
          return;
        }
        body[identifierKey(identifierType)] = normalized.value;
        // Registrasi selalu verifikasi BPJS supaya "Nama Faskes" terisi.
        body.pcare = true;
        body.petugas_id = tenaga;
      }

      const queue = await api.queue(body);
      setResult(queue);
      setIssuedCode(queue.antrian.kode);
      toast.success("Pendaftaran berhasil");
      setStep(4);
    } catch (error) {
      if (error instanceof ClientError) setSaveError(error);
      else toast.error(error instanceof Error ? error.message : "Pendaftaran gagal");
    } finally {
      setSaving(false);
    }
  };

  const canContinueToConfirm =
    poliId !== NONE && (doctors.length <= 1 || doctorCode !== NONE) &&
    !(fallback === false && !tenaga);

  return (
    <div className="space-y-6">
      <StepIndicator
        steps={[
          { step: 1, label: "Identitas", active: step === 1 },
          { step: 2, label: "Poli & Dokter", active: step === 2 },
          { step: 3, label: "Konfirmasi", active: step === 3 },
        ]}
      />

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Identitas pasien</CardTitle>
            <CardDescription>
              Masukkan salah satu identitas: NIK, nomor BPJS, atau nomor rekam medis.
              Mode Auto menebak jenisnya dari panjang nomor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={blankQueue}
                onCheckedChange={(checked) => {
                  const on = checked === true;
                  setBlankQueue(on);
                  if (on) setFallback(true);
                }}
              />
              <span>
                <span className="font-medium">Pasien tanpa identitas (baru)</span>
                <span className="block text-xs text-muted-foreground">
                  Melewati pencarian identitas. Poli & dokter dipilih di langkah berikutnya;
                  lokasi & tenaga ikut isian di atas.
                </span>
              </span>
            </label>

            {!blankQueue ? (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium">Jenis identitas</legend>
                  <RadioGroup
                    value={identifierChoice}
                    onValueChange={(value) => setIdentifierChoice(value as IdentifierChoice)}
                    className="flex flex-wrap gap-4"
                  >
                    {(Object.keys(IDENTIFIER_CHOICE_LABEL) as IdentifierChoice[]).map(
                      (choice) => (
                        <label key={choice} className="flex items-center gap-2 text-sm">
                          <RadioGroupItem value={choice} id={`id-${choice}`} />
                          <span>{IDENTIFIER_CHOICE_LABEL[choice]}</span>
                        </label>
                      ),
                    )}
                  </RadioGroup>
                </fieldset>

                <div className="space-y-1.5">
                  <Label htmlFor="identifier">{IDENTIFIER_LABEL[identifierType]}</Label>
                  <Input
                    id="identifier"
                    value={identifierValue}
                    onChange={(event) => setIdentifierValue(event.target.value)}
                    placeholder="Masukkan nomor"
                    autoComplete="off"
                  />
                  {identifierChoice === "auto" ? (
                    <p className="text-xs text-muted-foreground">
                      {identifierValue.trim() === ""
                        ? "NIK 16 digit, No. BPJS 13 digit, sisanya No. RM."
                        : `Terdeteksi: ${IDENTIFIER_LABEL[detectedType]}`}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lokasi">Lokasi pemeriksaan</Label>
                <Select value={lokasiId} onValueChange={setLokasiId}>
                  <SelectTrigger id="lokasi" className="w-full">
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
                {poscheck.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Daftar lokasi belum termuat dari server.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tenaga">
                  Tenaga / petugas
                  {!fallback ? <span className="text-destructive"> *</span> : null}
                </Label>
                <Select value={tenaga} onValueChange={setTenaga}>
                  <SelectTrigger id="tenaga" className="w-full">
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
            </div>

            {lookupError ? (
              <Alert variant="destructive">
                <AlertTitle>Pencarian gagal</AlertTitle>
                <AlertDescription>
                  {lookupError.code}: {lookupError.message}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {blankQueue ? (
                <Button onClick={continueWithoutId}>Lanjut ke Poli &amp; Dokter</Button>
              ) : (
                <>
                  <Button onClick={search} disabled={looking || identifierValue.trim() === ""}>
                    {looking ? "Mencari..." : "Cari"}
                  </Button>
                  <Button variant="outline" onClick={startBlankQueue} disabled={looking}>
                    Antrian baru (tanpa identitas)
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Poli &amp; dokter</CardTitle>
            <CardDescription>
              {fallback
                ? "Pendaftaran sebagai pasien baru - tidak ada data pasien."
                : (patient?.patient?.nama ?? "-")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {fallback ? (
              <Alert>
                <AlertTitle>Nomor antrian pasien baru</AlertTitle>
                <AlertDescription>
                  {lookupReasonLabel(patient?.reason) ??
                    "Pasien akan mendapat nomor antrian tanpa data kunjungan."}{" "}
                  Identitas pasien dicatat di loket pendaftaran.
                </AlertDescription>
              </Alert>
            ) : null}

            {patient?.patient ? (
              <div className="rounded-md border p-4 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">No. RM</span>
                    <p className="font-medium">{patient.patient.no_rm || "-"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">BPJS</span>
                    <p className="font-medium">
                      {patient.bpjs?.is_bpjs
                        ? `${patient.bpjs.no_kartu ?? "-"} (${patient.bpjs.status ?? "aktif"})`
                        : "Bukan peserta BPJS"}
                    </p>
                  </div>
                </div>
                {patient.bpjs?.pesan ? (
                  <p className="mt-2 text-xs text-muted-foreground">{patient.bpjs.pesan}</p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="poli">Poli</Label>
              {poliLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : poli.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Tidak ada poli aktif. Periksa koneksi ke Go API.
                </p>
              ) : (
                <Select value={poliId} onValueChange={setPoliId}>
                  <SelectTrigger id="poli" className="w-full">
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
              <Label htmlFor="dokter">Dokter</Label>
              {poliId === NONE ? (
                <p className="text-sm text-muted-foreground">Pilih poli terlebih dahulu.</p>
              ) : doctorsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : doctors.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Tidak ada dokter terjadwal di poli ini hari ini.
                </p>
              ) : (
                <Select
                  value={doctorCode}
                  onValueChange={setDoctorCode}
                  disabled={doctors.length === 1}
                >
                  <SelectTrigger id="dokter" className="w-full">
                    <SelectValue placeholder="Pilih dokter" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((doctor) => (
                      <SelectItem key={doctor.kode_dokter} value={doctor.kode_dokter}>
                        {doctor.nama_dokter} ({doctor.jam_praktek})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {!fallback && !tenaga ? (
              <p className="text-xs text-destructive">
                Tenaga pendaftaran belum dipilih. Kembali ke langkah Identitas untuk mengisinya.
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Kembali
              </Button>
              <Button disabled={!canContinueToConfirm} onClick={() => setStep(3)}>
                Lanjut
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>Konfirmasi</CardTitle>
            <CardDescription>Periksa data sebelum menyimpan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-md border p-4 text-sm">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Pasien</dt>
                  <dd className="font-medium">
                    {fallback ? "Pasien baru (tanpa data)" : (patient?.patient?.nama ?? "-")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Identitas</dt>
                  <dd className="font-medium">
                    {fallback
                      ? "Tanpa identitas (dicatat di loket)"
                      : `${IDENTIFIER_LABEL[identifierType]}: ${identifierValue}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Poli</dt>
                  <dd className="font-medium">{selectedPoli?.nama ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Dokter</dt>
                  <dd className="font-medium">
                    {doctors.find((d) => d.kode_dokter === doctorCode)?.nama_dokter ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Lokasi</dt>
                  <dd className="font-medium">{selectedPoscheck?.nama ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tenaga</dt>
                  <dd className="font-medium">
                    {fallback
                      ? "-"
                      : (petugas.find((p) => p.id === tenaga)?.nama ?? (tenaga || "-"))}
                  </dd>
                </div>
              </dl>
            </div>

            {saveError ? (
              <Alert variant="destructive">
                <AlertTitle>Pendaftaran gagal</AlertTitle>
                <AlertDescription>
                  {saveError.code}: {saveError.message}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Kembali
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nomor antrian terbit</CardTitle>
            <CardDescription>{issuedCode}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-md border p-4 text-sm">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Kode</dt>
                  <dd className="text-2xl font-semibold">{issuedCode}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Poli</dt>
                  <dd className="font-medium">{result?.poli.nama ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Dokter</dt>
                  <dd className="font-medium">{result?.dokter.nama_dokter ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Sisa kuota</dt>
                  <dd className="font-medium">{result?.antrian.sisa_kuota ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Lokasi</dt>
                  <dd className="font-medium">{result?.lokasi ?? "-"}</dd>
                </div>
              </dl>
            </div>

            <Separator />

            <Button onClick={reset}>Daftar lagi</Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
