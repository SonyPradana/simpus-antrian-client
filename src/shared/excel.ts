/**
 * Deteksi header & pemetaan kolom Excel.
 *
 * Tidak ada format baku - header dideteksi dari teksnya (fuzzy).
 * Prioritas identifier: nik > bpjs > no_rm (docs/conventions.md §4).
 *
 * Modul ini murni (tanpa I/O) supaya bisa dipakai di browser tanpa node_modules
 * server, dan bisa diuji terpisah.
 */
import type { ExcelMapping, ExcelPreview } from "./types";

/** Normalisasi header: lowercase, tanpa tanda baca, spasi excess -> "_". */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Skor kecocokan header terhadap satu field.
 * Returns null kalau tidak cocok. Skor lebih tinggi = lebih yakin.
 */
export function matchHeader(header: string, field: ExcelField): number | null {
  const h = normalizeHeader(header);
  if (!h) return null;

  const contains = (needle: string) => h.includes(needle);

  switch (field) {
    case "nik":
      if (h === "nik" || h === "no_nik" || h === "nomor_nik") return 100;
      if (contains("nik") && !contains("bpjs")) return 80;
      return null;

    case "bpjs":
      if (h === "bpjs" || h === "no_bpjs" || h === "nomor_bpjs" || h === "kartu_bpjs") return 100;
      if (h === "no_kartu") return 90;
      if (contains("bpjs")) return 80;
      if (contains("kartu") && contains("bpjs")) return 80;
      return null;

    case "no_rm":
      if (h === "rm" || h === "no_rm" || h === "nomor_rm") return 100;
      if (contains("rekam_medis")) return 95;
      if (contains("no_rm") || contains("nomor_rm")) return 90;
      if (h.endsWith("_rm") || h === "rm_pasien") return 85;
      return null;

    case "poli":
      if (h === "poli" || h === "id_poli" || h === "kode_poli") return 100;
      if (contains("poli")) return 70;
      return null;

    case "dokter":
      if (h === "dokter" || h === "kode_dokter" || h === "nama_dokter") return 100;
      if (contains("dokter")) return 80;
      return null;

    case "lokasi":
      if (h === "lokasi" || h === "lokasi_pemeriksaan") return 100;
      if (contains("lokasi")) return 80;
      return null;

    case "tenaga":
      if (h === "tenaga" || h === "petugas" || h === "id_petugas" || h === "nama_petugas") return 100;
      if (contains("petugas") || contains("tenaga")) return 80;
      return null;

    default:
      return null;
  }
}

export type ExcelField = "nik" | "bpjs" | "no_rm" | "poli" | "dokter" | "lokasi" | "tenaga";

const FIELDS: ExcelField[] = ["nik", "bpjs", "no_rm", "poli", "dokter", "lokasi", "tenaga"];

/**
 * Auto-detect pemetaan kolom dari baris header.
 * - identifier: nik > bpjs > no_rm (hanya satu kolom yang dipakai)
 * - kolom lain: ambil yang skornya paling tinggi
 */
export function detectHeaders(headers: string[]): ExcelMapping {
  const scores: Record<string, number[]> = {};
  for (const field of FIELDS) scores[field] = headers.map((h) => matchHeader(h, field) ?? -1);

  const mapping: ExcelMapping = {};

  // identifier: prioritas nik > bpjs > no_rm
  for (const field of ["nik", "bpjs", "no_rm"] as const) {
    const list = scores[field] ?? [];
    let bestIndex = -1;
    let bestScore = 0;
    list.forEach((score, index) => {
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      mapping.identifier = bestIndex;
      mapping.identifierType = field;
      break;
    }
  }

  for (const field of ["poli", "dokter", "lokasi", "tenaga"] as const) {
    const list = scores[field] ?? [];
    let bestIndex = -1;
    let bestScore = 0;
    list.forEach((score, index) => {
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) mapping[field] = bestIndex;
  }

  return mapping;
}

/** Buang baris kosong di awal (banyak file excel punya baris judul di atas). */
export function trimLeadingEmptyRows(rows: string[][]): string[][] {
  const index = rows.findIndex((row) => row.some((cell) => cell.trim() !== ""));
  return index <= 0 ? rows : rows.slice(index);
}

/**
 * Cari baris mana yang jadi header.
 *
 * File dari puskesmas sering punya baris judul ("LAPORAN PESERTA ...").
 * Jadi bukan "baris pertama" - tapi baris yang paling banyak kolomnya cocok
 * dengan field yang kita kenal.
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 10);
  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] ?? [];
    const score = row.reduce((total, cell) => {
      const matched = FIELDS.some((field) => matchHeader(cell, field) !== null);
      return total + (matched ? 1 : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore > 0 ? bestIndex : 0;
}

/** Normalisasi id poli: "5" -> "05" (Poli.id selalu 2 digit). */
export function normalizePoliId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(2, "0");
  return trimmed;
}

/**
 * Cocokkan nilai kolom dokter dengan daftar dokter.
 * Coba kode MJKN dulu (exact), lalu nama (case-insensitive, substring).
 */
export function matchDoctor(
  value: string,
  doctors: ReadonlyArray<{ kode_dokter: string; nama_dokter: string }>,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const byCode = doctors.find((d) => d.kode_dokter === trimmed);
  if (byCode) return byCode.kode_dokter;

  const lower = trimmed.toLowerCase();
  const byName = doctors.find((d) => d.nama_dokter.toLowerCase() === lower);
  if (byName) return byName.kode_dokter;

  const partial = doctors.find((d) => d.nama_dokter.toLowerCase().includes(lower));
  if (partial) return partial.kode_dokter;

  return null;
}

/** Ringkasan file -> pratinjau untuk UI. */
export function buildPreview(rows: string[][]): ExcelPreview {
  const trimmed = trimLeadingEmptyRows(rows);
  const headerIndex = findHeaderRow(trimmed);
  const headers = (trimmed[headerIndex] ?? []).map((cell) => cell.trim());
  const body = trimmed.slice(headerIndex + 1);
  return {
    headers,
    rows: body.slice(0, 10),
    body,
    mapping: detectHeaders(headers),
  };
}
