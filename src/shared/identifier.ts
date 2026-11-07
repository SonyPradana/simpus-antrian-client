/**
 * Normalisasi & validasi identitas pasien.
 *
 * Kenapa perlu: Excel memperlakukan NIK 16 digit sebagai angka, sehingga
 *   - nol di depan hilang  ("0332..." -> 15 digit)
 *   - nilai panjang tampil sebagai notasi ilmiah ("3,32E+15")
 *   - sel bertipe angka desimal ("123.0")
 * Kalau lolos apa adanya, nomor yang dicari bukan nomor pasien.
 *
 * Semua fungsi murni (tanpa I/O) supaya bisa dipakai web, server, dan test.
 */
import type { IdentifierType } from "./schema";

export type IdentifierIssue =
  | "empty"
  | "scientific"
  | "decimal"
  | "non_digit"
  | "nik_length"
  | "bpjs_length";

export interface IdentifierOk {
  ok: true;
  value: string;
}

export interface IdentifierError {
  ok: false;
  code: IdentifierIssue;
  message: string;
}

export type IdentifierResult = IdentifierOk | IdentifierError;

/** NIK = 16 digit, No. BPJS = 13 digit, No. RM bebas (bisa huruf). */
export const NIK_LENGTH = 16;
export const BPJS_LENGTH = 13;

/**
 * Tebak jenis identitas dari bentuknya (mode "Auto" di form manual).
 *
 * Hanya panjang digit yang dipakai: No. RM yang kebetulan 13/16 digit akan
 * terbaca NIK/BPJS. Operator harus melihat label hasil deteksi dan bisa
 * mengganti pilihan manual - ini tebakan, bukan validasi.
 */
export function detectIdentifierType(raw: string): IdentifierType {
  const value = raw.trim().replace(/[\s-]/g, "");

  if (/^\d+$/.test(value)) {
    if (value.length === NIK_LENGTH) return "nik";
    if (value.length === BPJS_LENGTH) return "bpjs";
  }

  return "no_rm";
}

const SCIENTIFIC = /^\d+(?:[.,]\d+)?e[+-]?\d+$/i;
const TRAILING_ZERO_DECIMAL = /^(\d+)[.,]0+$/;

const LABEL: Record<IdentifierType, string> = {
  nik: "NIK",
  bpjs: "No. BPJS",
  no_rm: "No. RM",
};

/**
 * Bersihkan lalu validasi. Selalu dipanggil sebelum nilai masuk ke tabel
 * antrian atau ke request Go API.
 */
export function normalizeIdentifier(type: IdentifierType, raw: string): IdentifierResult {
  const input = raw.trim();

  if (input === "") {
    return { ok: false, code: "empty", message: `${LABEL[type]} masih kosong` };
  }

  // Deteksi SEBELUM spasi dibuang, supaya pesannya jelas untuk operator.
  if (SCIENTIFIC.test(input.replace(/\s+/g, ""))) {
    return {
      ok: false,
      code: "scientific",
      message: `${LABEL[type]} berubah jadi notasi ilmiah. Set format kolom Excel ke "Teks".`,
    };
  }

  let value = input.replace(/[\s-]/g, "");

  // "1234567890.0" -> "1234567890"
  const integerized = TRAILING_ZERO_DECIMAL.exec(value);
  if (integerized?.[1]) value = integerized[1];

  if (type === "no_rm") {
    return { ok: true, value };
  }

  if (/[.,]/.test(value)) {
    return {
      ok: false,
      code: "decimal",
      message: `${LABEL[type]} mengandung desimal. Sel Excel bukan teks.`,
    };
  }

  if (!/^\d+$/.test(value)) {
    return {
      ok: false,
      code: "non_digit",
      message: `${LABEL[type]} harus berupa angka.`,
    };
  }

  if (type === "nik" && value.length !== NIK_LENGTH) {
    return {
      ok: false,
      code: "nik_length",
      message: `NIK harus ${NIK_LENGTH} digit, sekarang ${value.length}. Nol di depan biasanya hilang di Excel.`,
    };
  }

  if (type === "bpjs" && value.length !== BPJS_LENGTH) {
    return {
      ok: false,
      code: "bpjs_length",
      message: `No. BPJS harus ${BPJS_LENGTH} digit, sekarang ${value.length}.`,
    };
  }

  return { ok: true, value };
}
