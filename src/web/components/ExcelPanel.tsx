import { useRef, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  matchHeader,
  matchPoscheck,
  normalizePoliId,
} from "@/shared/excel";
import { normalizeIdentifier } from "@/shared/identifier";
import type { Doctor, RegistrationOption } from "@/shared/schema";
import type { ExcelMapping, NewItem } from "@/shared/types";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const NONE = "__none__";

/** Kolom yang bisa dipetakan (bukan `identifierType` - itu turunan, bukan kolom). */
const COLUMN_FIELDS = ["identifier", "poli", "dokter", "lokasi", "tenaga"] as const;
type ColumnField = (typeof COLUMN_FIELDS)[number];

const FIELD_LABEL: Record<ColumnField, string> = {
  identifier: "Identitas (NIK/BPJS/No. RM)",
  poli: "Poli (id)",
  dokter: "Dokter (opsional)",
  lokasi: "Lokasi (opsional)",
  tenaga: "Tenaga (opsional)",
};

export interface ExcelPanelProps {
  doctorsByPoli: Record<string, Doctor[]>;
  /** daftar poscheck dari server - sumber tunggal nama lokasi */
  poscheck: RegistrationOption[];
  defaultPoscheckId: string;
  defaultTenaga: string;
  fallback: boolean;
  onAdd: (items: NewItem[]) => void;
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
}: ExcelPanelProps) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      if (preview.mapping.identifier === undefined) {
        setError(
          "Kolom identitas tidak terdeteksi. Pilih kolom NIK/BPJS/No. RM secara manual.",
        );
      }
    } catch {
      setError("Gagal membaca file. Pastikan file .xlsx tidak rusak.");
    } finally {
      setBusy(false);
    }
  };

  const setMapping = (field: ColumnField, index: string) => {
    if (!parsed) return;
    const next: ExcelMapping = { ...parsed.mapping };
    if (index === NONE) {
      delete next[field];
      if (field === "identifier") delete next.identifierType;
    } else {
      Object.assign(next, { [field]: Number(index) });
      if (field === "identifier") {
        // tentukan lagi jenis identitas dari header kolom yang dipilih
        const header = parsed.headers[Number(index)] ?? "";
        const detected = (["nik", "bpjs", "no_rm"] as const).find(
          (kind) => matchHeader(header, kind) !== null,
        );
        next.identifierType = detected ?? "nik";
      }
    }
    setParsed({ ...parsed, mapping: next });
  };

  const build = (): { items: NewItem[]; skipped: number; firstSkip: string | null } => {
    if (!parsed) return { items: [], skipped: 0, firstSkip: null };
    const { mapping } = parsed;

    // Poli wajib: server menolak poli_id kosong, jadi jangan kirim baris yang
    // pasti gagal.
    if (mapping.identifier === undefined || mapping.poli === undefined) {
      return { items: [], skipped: 0, firstSkip: null };
    }

    const identifierType = mapping.identifierType ?? "nik";
    const items: NewItem[] = [];
    let skipped = 0;
    let firstSkip: string | null = null;

    const skip = (reason: string) => {
      skipped += 1;
      firstSkip ??= reason;
    };

    for (const row of parsed.body) {
      const rawIdentifier = row[mapping.identifier] ?? "";
      // baris kosong bukan kesalahan operator - lewati tanpa dihitung
      if (rawIdentifier.trim() === "") continue;

      const identifier = normalizeIdentifier(identifierType, rawIdentifier);
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
        identifierType,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import dari Excel</CardTitle>
        <CardDescription>
          Tarik file .xlsx ke sini. Format header bebas - kolom dideteksi otomatis dan bisa
          diperbaiki manual.
        </CardDescription>
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
