/**
 * Tipe milik client (bukan dari Go API). Lihat docs/conventions.md §1.1.
 */
import type { IdentifierType, ItemStatus, JobSource, JobState } from "./schema";

export type { IdentifierType, ItemStatus, JobSource, JobState };

/** Satu baris di tabel antrian. */
export interface QueueItem {
  id: string;
  jobId: string;
  seq: number;
  patient: { type: IdentifierType; value: string };
  /** nama pasien (isi setelah registrasi sukses) */
  patientName: string;
  poliId: string;
  doctorCode: string;
  /** poscheck id -> dikirim sebagai `poscheck_id` (docs/conventions.md §2.9) */
  poscheckId: string;
  /** nama lokasi - HANYA untuk tampilan; server mengambil nama dari `poschecks` */
  lokasi: string;
  /** worker id -> dikirim sebagai `petugas_id` (khusus mode registration) */
  tenaga: string;
  fallback: boolean;
  status: ItemStatus;
  queueCode: string;
  message: string;
  errorCode: string;
  sudah_terdaftar: boolean;
}

export interface Job {
  id: string;
  state: JobState;
  source: JobSource;
  createdAt: number;
  fallback: boolean;
}

export interface LocationTemplate {
  /** poscheck id - dikirim sebagai `poscheck_id` */
  id: string;
  /** nama lokasi - label UI; tidak pernah dikirim ke server */
  nama: string;
}

export interface Settings {
  /** base URL Go API, mis. http://localhost:8080 */
  apiBaseUrl: string;
  /** template lokasi, bisa diedit user (client-side) */
  lokasiTemplates: LocationTemplate[];
  defaultPoscheckId: string;
  defaultLokasi: string;
  defaultTenaga: string;
}

/** Event yang di-push ke UI lewat SSE. */
export type JobEvent =
  | { type: "job"; jobId: string; state: JobState }
  | { type: "item"; jobId: string; item: QueueItem };

/** Baris baru yang akan dimasukkan ke tabel antrian. */
export interface NewItem {
  identifierType: IdentifierType;
  identifierValue: string;
  poliId: string;
  doctorCode: string;
  poscheckId: string;
  /** label lokasi untuk tabel; tidak dikirim ke server */
  lokasi: string;
  tenaga: string;
  fallback: boolean;
}

/** Pemetaan kolom Excel -> field item. */
export interface ExcelMapping {
  identifier?: number;
  /** jenis identitas yang terdeteksi (nik > bpjs > no_rm) */
  identifierType?: IdentifierType;
  poli?: number;
  dokter?: number;
  lokasi?: number;
  tenaga?: number;
}

export interface ExcelPreview {
  headers: string[];
  /** 10 baris pertama, hanya untuk pratinjau di UI */
  rows: string[][];
  /** seluruh baris data (tanpa header) - dipakai saat impor */
  body: string[][];
  mapping: ExcelMapping;
}
