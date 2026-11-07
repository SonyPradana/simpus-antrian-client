/**
 * Kontrak executable - terjemahan langsung `docs/conventions.md` Section 2.
 *
 * ATURAN: file ini adalah SATU-SATUNYA sumber kebenaran bentuk data dari Go API.
 * Kalau ada perubahan di sisi server, ubah di sini DAN di `docs/conventions.md`.
 * Jangan pernah hand-roll parsing response di tempat lain.
 *
 * Sejak 2026-10-30 kontrak utama adalah facade `/api/v1/apm/*`
 * (docs/conventions.md §2.9). Endpoint legacy tidak dipakai client lagi.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Response Go API (read-only, dibekukan - lihat docs/conventions.md §2)
 * ------------------------------------------------------------------ */

export const PoliSchema = z.object({
  id: z.string().brand<"PoliId">(),
  kode_antrian: z.string().default(""),
  unit_id: z.string().default(""),
  nama: z.string(),
  kode_bpjs: z.string().default(""),
  poli_sakit: z.boolean().default(false),
  prefix: z.string().default(""),
  kode_hfis: z.string().optional(),
  nama_unit: z.string().optional(),
  nama_unit_antrian: z.string().optional(),
  total_antrian: z.number().default(0),
});
export type Poli = z.infer<typeof PoliSchema>;

export const DoctorSchema = z.object({
  kode_dokter: z.string().brand<"DoctorCode">(),
  nama_dokter: z.string(),
  jam_praktek: z.string().default(""),
  kapasitas: z.number().default(0),
  kode_poli: z.string().default(""),
});
export type Doctor = z.infer<typeof DoctorSchema>;

export const PatientSchema = z.object({
  no_rm: z.string().default(""),
  nama: z.string().default(""),
  nama_kk: z.string().optional(),
  alamat: z.string().default(""),
  dusun: z.string().optional(),
  desa: z.string().optional(),
  tanggal_lahir: z.string().optional(),
  no_bpjs: z.string().optional(),
  nik: z.string().optional(),
  sex_id: z.string().optional(),
  work_id: z.string().optional(),
  orchard_id: z.string().optional(),
  village_id: z.string().optional(),
  typepatient_id: z.string().optional(),
  education_id: z.string().optional(),
  jenis_pasien: z.string().optional(),
  is_bpjs: z.boolean().default(false),
  gakin: z.boolean().default(false),
  bayar: z.boolean().default(false),
  prolanis: z.string().optional(),
  prb: z.string().optional(),
});
export type Patient = z.infer<typeof PatientSchema>;

export const BPJSStatusSchema = z.object({
  is_bpjs: z.boolean().default(false),
  no_kartu: z.string().optional(),
  sumber: z.string().default(""),
  terverifikasi: z.boolean().default(false),
  aktif: z.boolean().optional(),
  status: z.string().optional(),
  jenis_peserta: z.string().optional(),
  kelas: z.string().optional(),
  kode_provider: z.string().optional(),
  nama_provider: z.string().optional(),
  tgl_mulai_aktif: z.string().optional(),
  tgl_akhir_berlaku: z.string().optional(),
  pesan: z.string().optional(),
});
export type BPJSStatus = z.infer<typeof BPJSStatusSchema>;

export const QueueSchema = z.object({
  kode: z.string().default(""),
  no_urut_poli: z.number().default(0),
  no_urut: z.number().default(0),
  tanggal: z.string().default(""),
  waktu: z.string().optional(),
  poli: z.string().default(""),
  dokter: z.string().default(""),
  kode_dokter: z.string().default(""),
  menunggu_di_depan: z.number().default(0),
  sisa_kuota: z.number().default(0),
});
export type Queue = z.infer<typeof QueueSchema>;

export const RegistrationOptionSchema = z.object({
  id: z.string(),
  nama: z.string(),
});
export type RegistrationOption = z.infer<typeof RegistrationOptionSchema>;

/** `GET /api/v1/apm/poli` dan `GET /api/v1/apm/dokter` (docs/conventions.md §2.9). */
export const DoctorListSchema = z.object({
  poli: PoliSchema,
  dokter: z.array(DoctorSchema).default([]),
  otomatis: z.boolean().default(false),
  dipilih: DoctorSchema.optional(),
});
export type DoctorList = z.infer<typeof DoctorListSchema>;

/* ------------------------------------------------------------------ *
 * APM facade - kontrak utama (docs/conventions.md §2.9)
 * ------------------------------------------------------------------ */

export const APMLookupModeSchema = z.enum([
  "existing_active",
  "existing_inactive",
  "existing_bpjs_unknown",
  "new",
]);
export type APMLookupMode = z.infer<typeof APMLookupModeSchema>;

/**
 * `POST /api/v1/apm/lookup`.
 * `patient`/`bpjs` tidak ada saat `mode = "new"` - bukan error.
 */
export const APMLookupResultSchema = z.object({
  mode: APMLookupModeSchema,
  can_register: z.boolean().default(false),
  fallback: z.literal("blank").optional(),
  reason: z.string().optional(),
  patient: PatientSchema.optional(),
  bpjs: BPJSStatusSchema.optional(),
});
export type APMLookupResult = z.infer<typeof APMLookupResultSchema>;

export const APMOptionSelectionSchema = z.object({
  petugas_id: z.string().default(""),
  poscheck_id: z.string().default(""),
  lokasi: z.string().default(""),
});
export type APMOptionSelection = z.infer<typeof APMOptionSelectionSchema>;

/** `GET /api/v1/apm/options` - hanya petugas + poscheck + default server. */
export const APMOptionsSchema = z.object({
  petugas: z.array(RegistrationOptionSchema).default([]),
  poscheck: z.array(RegistrationOptionSchema).default([]),
  terpilih: APMOptionSelectionSchema,
});
export type APMOptions = z.infer<typeof APMOptionsSchema>;

export const APMQueueModeSchema = z.enum(["registration", "blank"]);
export type APMQueueMode = z.infer<typeof APMQueueModeSchema>;

/**
 * Body `POST /api/v1/apm/queue`.
 *
 * Tidak ada field `lokasi`: server selalu mengambil nama dari `poschecks`.
 * `petugas_id` hanya sah untuk mode `registration`.
 */
export const APMQueueBodySchema = z.object({
  mode: APMQueueModeSchema,
  nik: z.string().optional(),
  no_bpjs: z.string().optional(),
  no_rm: z.string().optional(),
  poli_id: z.string().min(1),
  kode_dokter: z.string().optional(),
  petugas_id: z.string().optional(),
  poscheck_id: z.string().optional(),
  dry_run: z.boolean().optional(),
  pcare: z.boolean().optional(),
});
export type APMQueueBody = z.infer<typeof APMQueueBodySchema>;

/**
 * Response `POST /api/v1/apm/queue` - satu bentuk untuk registration & blank.
 * `patient`/`bpjs` hanya ada untuk mode registration.
 */
export const APMQueueResultSchema = z.object({
  mode: APMQueueModeSchema,
  needs_registration: z.boolean().default(false),
  patient: PatientSchema.optional(),
  bpjs: BPJSStatusSchema.optional(),
  poli: PoliSchema,
  dokter: DoctorSchema,
  antrian: QueueSchema,
  petugas_id: z.string().optional(),
  poscheck_id: z.string().optional(),
  lokasi: z.string().optional(),
  visit_id: z.number().optional(),
  dry_run: z.boolean().default(false),
  sudah_terdaftar: z.boolean().optional(),
});
export type APMQueueResult = z.infer<typeof APMQueueResultSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
  data: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

/** Envelope sukses `{ data: ... }` - docs/conventions.md §2. */
export function envelope<T extends z.ZodType>(schema: T) {
  return z.object({ data: schema });
}

/* ------------------------------------------------------------------ *
 * Request body ke Go API (ditulis client)
 * ------------------------------------------------------------------ */

export const IdentifierTypeSchema = z.enum(["nik", "bpjs", "no_rm"]);
export type IdentifierType = z.infer<typeof IdentifierTypeSchema>;

export const PatientRefSchema = z.object({
  type: IdentifierTypeSchema,
  value: z.string().min(1, "isi identitas pasien"),
});
export type PatientRef = z.infer<typeof PatientRefSchema>;

/* ------------------------------------------------------------------ *
 * Enum domain (docs/conventions.md §1)
 * ------------------------------------------------------------------ */

export const ItemStatusSchema = z.enum(["menunggu", "berjalan", "sukses", "gagal"]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const JobStateSchema = z.enum(["idle", "running", "paused", "stopped"]);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobSourceSchema = z.enum(["input", "excel"]);
export type JobSource = z.infer<typeof JobSourceSchema>;
