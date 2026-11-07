/**
 * Aturan mode pendaftaran APM (docs/conventions.md §2.9).
 *
 * Lookup tidak lagi memakai 404 untuk "pasien tidak ditemukan"; server
 * mengembalikan `mode`. UI/executor wajib memetakan mode itu ke salah satu
 * dari dua mode queue, bukan menebak dari ada/tidaknya `patient`.
 *
 * Semua fungsi murni supaya bisa diuji tanpa React.
 */
import type { APMLookupResult, APMQueueMode, IdentifierType } from "./schema";

/** Mode queue yang harus dikirim untuk hasil lookup tertentu. */
export function actionForLookup(result: APMLookupResult): APMQueueMode {
  switch (result.mode) {
    case "existing_active":
      return "registration";
    case "existing_inactive":
      return "blank";
    case "existing_bpjs_unknown":
      // Server sudah memutuskan lewat `can_register`; jangan menebak sendiri.
      return result.can_register ? "registration" : "blank";
    case "new":
      return "blank";
  }
}

/** Nama field identitas di body APM (`bpjs` -> `no_bpjs`). */
export function identifierKey(type: IdentifierType): "nik" | "no_bpjs" | "no_rm" {
  return type === "bpjs" ? "no_bpjs" : type;
}

/** Kalimat pendek untuk `reason` dari server; null kalau tidak ada. */
export function lookupReasonLabel(reason: string | undefined): string | null {
  switch (reason) {
    case "patient_not_found":
      return "Pasien tidak ditemukan di SIMPUS.";
    case "bpjs_inactive":
      return "Kepersertaan BPJS tidak aktif.";
    case "bpjs_incomplete":
      return "Data BPJS belum lengkap.";
    case "bpjs_unverified":
      return "Status BPJS tidak bisa diverifikasi.";
    case "bpjs_dob_mismatch":
      return "Tanggal lahir berbeda dengan data BPJS.";
    default:
      return reason === undefined || reason === "" ? null : reason;
  }
}
