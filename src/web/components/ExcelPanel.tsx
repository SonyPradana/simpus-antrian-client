import { useEffect, useRef, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildPreview,
  matchDoctor,
  matchPoscheck,
  normalizePoliId,
  pickIdentifier,
} from "@/shared/excel";
import { normalizeIdentifier } from "@/shared/identifier";
import type { Doctor, RegistrationOption } from "@/shared/schema";
import type { ExcelMapping, IdentifierType, NewItem } from "@/shared/types";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const NONE = "__none__";

/** Kolom non-identitas yang bisa dipetakan manual. */
const COLUMN_FIELDS = ["poli", "dokter", "lokasi", "tenaga"] as const;
type ColumnField = (typeof COLUMN_FIELDS)[number];

const FIELD_LABEL: Record<ColumnField, string> = {
  poli: "Poli (id)",
  dokter: "Dokter (opsional)",
  lokasi: "Lokasi (opsional)",
  tenaga: "Petugas (opsional)",
};

/** Kolom identitas: boleh lebih dari satu, dipilih per baris. */
const IDENTIFIER_FIELDS = ["nik", "bpjs", "no_rm"] as const;

const IDENTIFIER_LABEL: Record<IdentifierType, string> = {
  nik: "NIK",
  bpjs: "No. BPJS",
  no_rm: "No. RM",
};

/** "auto" = pilih kolom identitas yang terisi di tiap baris. */
type IdentifierChoice = IdentifierType | "auto";

const IDENTIFIER_CHOICE_LABEL: Record<IdentifierChoice, string> = {
  auto: "Auto",
  nik: "NIK",
  bpjs: "No. BPJS",
  no_rm: "No. RM",
};

/** Contoh file yang disajikan BFF dari `public/`. */
const TEMPLATE_URL = "/contoh-import-antrian.xlsx";

export interface ExcelPanelProps {
  doctorsByPoli: Record<string, Doctor[]>;
  /** daftar poscheck dari server - sumber tunggal nama lokasi */
  poscheck: RegistrationOption[];
  defaultPoscheckId: string;
  defaultTenaga: string;
  fallback: boolean;
  onAdd: (items: NewItem[]) => void;
  /** true selama file sudah dipilih tapi barisnya belum ditambahkan */
  onPendingChange?: (pending: boolean) => void;
}

interface Parsed {
  headers: string[];
  /** 10 baris untuk pratinjau */
  rows: string[][];
  /** seluruh baris data - ini yang dipakai saat impor */
  body: string[][];
  mapping: ExcelMapping;
}

export function ExcelPanel({
  doctorsByPoli,
  poscheck,
  defaultPoscheckId,
  defaultTenaga,
  fallback,
  onAdd,
  onPendingChange,
}: ExcelPanelProps) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identifierChoice, setIdentifierChoice] = useState<IdentifierChoice>("auto");
  const inputRef = useRef<HTMLInputElement>(null);

  // File yang sudah dipilih tapi barisnya belum ditambahkan: kalau tab
  // ditinggal, hasil pembacaan ini hilang.
  useEffect(() => {
    onPendingChange?.(parsed !== null);
  }, [parsed, onPendingChange]);

  const handleFile = async (file: File) => {
    setError(null);
    setParsed(null);

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Format file harus .xlsx.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Ukuran file maksimal 10 MB.");
      return;
    }

    setBusy(true);
    try {
      const sheets = await readXlsxFile(file);
      const sheet = sheets[0];
      if (!sheet) {
        setError("File tidak berisi sheet.");
        return;
      }
      const allRows = sheet.data.map((row) =>
        row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
      );
      if (allRows.length > MAX_ROWS) {
        setError(`Maksimal ${MAX_ROWS} baris per file.`);
        return;
      }
      const preview = buildPreview(allRows);
      if (preview.headers.length === 0) {
        setError("File tidak berisi header.");
        return;
      }
      setParsed({
        headers: preview.headers,
        rows: preview.rows,
        body: preview.body,
        mapping: preview.mapping,
      });
      const hasIdentifier =
        preview.mapping.nik !== undefined ||
        preview.mapping.bpjs !== undefined ||
        preview.mapping.no_rm !== undefined;
      if (!hasIdentifier) {
        setError(
          "Kolom identitas tidak terdeteksi. Pastikan ada kolom NIK, No. BPJS, atau No. RM.",
        );
      }
    } catch {
      setError("Gagal membaca file. Pastikan file .xlsx tidak rusak.");
    } finally {
      setBusy(false);
    }
  };

  const setMapping = (field: ColumnField | IdentifierType, index: string) => {
    if (!parsed) return;
    const next: ExcelMapping = { ...parsed.mapping };
    if (index === NONE) {
      delete next[field];
    } else {
      next[field] = Number(index);
    }
    // Pesan "kolom identitas tidak terdeteksi" mungkin sudah tidak berlaku
    // setelah operator memetakan kolomnya sendiri.
    setError(null);
    setParsed({ ...parsed, mapping: next });
  };

  const build = (): { items: NewItem[]; skipped: number; firstSkip: string | null } => {
    if (!parsed) return { items: [], skipped: 0, firstSkip: null };
    const { mapping } = parsed;

    // Poli wajib: server menolak poli_id kosong, jadi jangan kirim baris yang
    // pasti gagal.
    if (mapping.poli === undefined) {
      return { items: [], skipped: 0, firstSkip: null };
    }

    const items: NewItem[] = [];
    let skipped = 0;
    let firstSkip: string | null = null;

    const skip = (reason: string) => {
      skipped += 1;
      firstSkip ??= reason;
    };

    for (const row of parsed.body) {
      // Satu file boleh memuat kolom NIK, BPJS, dan No. RM sekaligus; tiap
      // baris memakai kolom pertama yang terisi.
      const picked = pickIdentifier(row, mapping, identifierChoice);
      // baris kosong bukan kesalahan operator - lewati tanpa dihitung
      if (picked === null) continue;

      const identifier = normalizeIdentifier(picked.type, picked.raw);
      if (!identifier.ok) {
        skip(identifier.message);
        continue;
      }

      const poliId = normalizePoliId(row[mapping.poli] ?? "");
      if (poliId === "") {
        skip("kolom poli kosong");
        continue;
      }

      const doctorRaw = mapping.dokter === undefined ? "" : (row[mapping.dokter] ?? "").trim();
      const doctors = doctorsByPoli[poliId] ?? [];
      let doctorCode = "";
      if (doctorRaw !== "") {
        const matched = matchDoctor(doctorRaw, doctors);
        // Kalau daftar dokter sudah termuat tapi nama tidak cocok, tolak baris:
        // lebih baik gagal jelas daripada diam-diam pindah dokter.
        if (matched === null && doctors.length > 0) {
          skip(`dokter "${doctorRaw}" tidak ada di poli ${poliId}`);
          continue;
        }
        doctorCode = matched ?? "";
      }

      const lokasiRaw = mapping.lokasi === undefined ? "" : (row[mapping.lokasi] ?? "").trim();
      const tenagaRaw = mapping.tenaga === undefined ? "" : (row[mapping.tenaga] ?? "").trim();

      // Poscheck dicocokkan ke daftar server, bukan salinan lokal. Nama yang
      // tidak dikenal jatuh ke poscheck default supaya baris tetap sah.
      const matchedPoscheck =
        matchPoscheck(lokasiRaw, poscheck) ?? poscheck.find((item) => item.id === defaultPoscheckId);

      items.push({
        identifierType: picked.type,
        identifierValue: identifier.value,
        poliId,
        doctorCode,
        poscheckId: matchedPoscheck?.id ?? defaultPoscheckId,
        lokasi: matchedPoscheck?.nama ?? "",
        tenaga: tenagaRaw || defaultTenaga,
        fallback,
      });
    }

    return { items, skipped, firstSkip };
  };

  const { items, skipped, firstSkip } = build();
  const poliMissing = parsed !== null && parsed.mapping.poli === undefined;
  const identifierMissing =
    parsed !== null &&
    (identifierChoice === "auto"
      ? parsed.mapping.nik === undefined &&
        parsed.mapping.bpjs === undefined &&
        parsed.mapping.no_rm === undefined
      : parsed.mapping[identifierChoice] === undefined);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Import dari Excel</CardTitle>
            <CardDescription>
              Tarik file .xlsx ke sini. Header kolom dideteksi otomatis dan bisa diperbaiki
              manual.
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={TEMPLATE_URL} download>
              Unduh contoh .xlsx
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <button
          type="button"
          aria-label="Pilih atau tarik file Excel"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? "border-primary bg-muted" : "border-border"
          }`}
        >
          <span className="text-sm font-medium">
            {busy ? "Membaca file…" : "Tarik file .xlsx ke sini atau klik untuk pilih"}
          </span>
          <span className="text-xs text-muted-foreground">Maksimal 10 MB · 5.000 baris</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>File tidak bisa dipakai</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {parsed ? (
          <>
            <Separator />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(COLUMN_FIELDS).map((field) => (
                <div key={field} className="space-y-1.5">
                  <span className="text-sm font-medium">{FIELD_LABEL[field]}</span>
                  <Select
                    value={parsed.mapping[field] === undefined ? NONE : String(parsed.mapping[field])}
                    onValueChange={(value) => setMapping(field, value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Tidak ada" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Tidak ada</SelectItem>
                      {parsed.headers.map((header, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: header Excel bisa kosong/duplikat; index satu-satunya identitas kolom
                        <SelectItem key={`${index}-${header}`} value={String(index)}>
                          {header || `Kolom ${index + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">Kolom identitas</p>
              <p className="text-xs text-muted-foreground">
                File boleh memuat ketiganya. Mode Auto memakai kolom yang terisi di tiap baris.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {IDENTIFIER_FIELDS.map((field) => (
                  <div key={field} className="space-y-1.5">
                    <span className="text-sm">{IDENTIFIER_LABEL[field]}</span>
                    <Select
                      value={
                        parsed.mapping[field] === undefined ? NONE : String(parsed.mapping[field])
                      }
                      onValueChange={(value) => setMapping(field, value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Tidak ada" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Tidak ada</SelectItem>
                        {parsed.headers.map((header, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: header Excel bisa kosong/duplikat; index satu-satunya identitas kolom
                          <SelectItem key={`${index}-${header}`} value={String(index)}>
                            {header || `Kolom ${index + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <fieldset className="space-y-2 pt-2">
                <legend className="mb-2 text-sm font-medium">Jenis identitas</legend>
                <RadioGroup
                  value={identifierChoice}
                  onValueChange={(value) => setIdentifierChoice(value as IdentifierChoice)}
                  className="flex flex-wrap gap-4"
                >
                  {(Object.keys(IDENTIFIER_CHOICE_LABEL) as IdentifierChoice[]).map((choice) => (
                    <label key={choice} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value={choice} id={`excel-id-${choice}`} />
                      <span>{IDENTIFIER_CHOICE_LABEL[choice]}</span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">
                Pratinjau ({parsed.rows.length} dari {parsed.body.length} baris)
              </p>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {parsed.headers.map((header, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: header Excel bisa kosong/duplikat; index satu-satunya identitas kolom
                        <TableHead key={`${index}-${header}`} className="whitespace-nowrap">
                          {header || `Kolom ${index + 1}`}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.map((row, rowIndex) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: baris pratinjau hanya data posisional dari file
                      <TableRow key={`row-${rowIndex}-${row[0] ?? ""}`}>
                        {parsed.headers.map((_, colIndex) => (
                          <TableCell
                            key={`col-${colIndex}-${parsed.headers[colIndex] ?? ""}`}
                            className="text-xs"
                          >
                            {row[colIndex] ?? ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {poliMissing ? (
              <Alert variant="destructive">
                <AlertTitle>Kolom poli belum dipetakan</AlertTitle>
                <AlertDescription>
                  Server mewajibkan ID poli. Pilih kolom poli di atas sebelum menambahkan.
                </AlertDescription>
              </Alert>
            ) : null}

            {identifierMissing ? (
              <Alert variant="destructive">
                <AlertTitle>Kolom identitas belum dipetakan</AlertTitle>
                <AlertDescription>
                  Pilih minimal satu kolom NIK, No. BPJS, atau No. RM.
                </AlertDescription>
              </Alert>
            ) : null}

            {skipped > 0 ? (
              <Alert>
                <AlertTitle>{skipped} baris dilewati</AlertTitle>
                <AlertDescription>
                  {firstSkip}
                  {skipped > 1 ? " (dan baris lain dengan masalah serupa)" : ""}
                </AlertDescription>
              </Alert>
            ) : null}

            <Button
              disabled={items.length === 0}
              onClick={() => {
                if (items.length === 0) {
                  toast.error("Tidak ada baris yang bisa ditambahkan");
                  return;
                }
                onAdd(items);
                toast.success(
                  skipped > 0
                    ? `${items.length} baris ditambahkan, ${skipped} dilewati`
                    : `${items.length} baris ditambahkan ke antrian`,
                );
                setParsed(null);
              }}
            >
              Tambahkan {items.length} baris ke antrian
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
