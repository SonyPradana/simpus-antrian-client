/**
 * Pure logic for external loket actions (Cetak Antrian and Hadir).
 *
 * Shared by the BFF and the browser. There is no I/O here so the rules can be
 * tested without a network. The endpoint facts are verified externally.
 */

/** `unit` must be exactly this; other values are accepted but do not print. */
export const LOKET_UNIT = "Pendaftaran";

/** Default unit id; also used as the key for the session data unit mapping. */
export const LOKET_UNIT_ID = "99";

/** Session hydration uses a data unit derived from the configured unit id. */
export function dataUnitFor(unitId: string): string {
  const mapping: Record<string, string> = {
    "99": "Pendaftaran_1",
    "96": "Pendaftaran_2",
    "88": "Pendaftaran_3",
  };
  return mapping[unitId.trim()] ?? "Pendaftaran_1";
}

export interface LoketPayloadConfig {
  unitId: string;
}

/** Only these four fields are sent to the external endpoint. */
export function buildLoketPayload(
  input: { kode: string; poli?: string },
  cfg: LoketPayloadConfig,
): URLSearchParams {
  const kode = (input.kode ?? "").trim();
  if (kode === "") throw new Error("queue code is required");

  const params = new URLSearchParams();
  params.set("kode", kode);
  params.set("unit", LOKET_UNIT);
  params.set("poli", input.poli ?? "");
  params.set("unitId", cfg.unitId || LOKET_UNIT_ID);
  return params;
}

export type HadirValidation =
  | { ok: true }
  | {
      ok: false;
      code: "NO_KARTU_KOSONG" | "FASKES_KOSONG" | "FASKES_TIDAK_SESUAI";
      message: string;
    };

/**
 * Mirrors the validation of the external `.getdatasatu` button.
 * The BFF treats this as authoritative; the UI only mirrors it to disable the
 * button. The Indonesian messages are exact strings from the external app.
 */
export function validateHadir(input: {
  noKartu?: string;
  namaProvider?: string;
}): HadirValidation {
  const noKartu = (input.noKartu ?? "").trim();
  if (noKartu === "") {
    return {
      ok: false,
      code: "NO_KARTU_KOSONG",
      message: "Nomor BPJS Kosong. Pasien tidak memiliki nomor BPJS. Tidak bisa klik Hadir.",
    };
  }

  const namaProvider = (input.namaProvider ?? "").trim();
  if (namaProvider === "") {
    return {
      ok: false,
      code: "FASKES_KOSONG",
      message:
        "Nama Faskes Kosong. Nama Faskes Pasien Kosong atau Pasien daftar dari simpus. Tidak bisa klik Hadir. Silahkan Lakukan Sinkronisasi dari SIMPUS J-CARE",
    };
  }
  if (namaProvider === "lbl_namaprovider" || namaProvider === "Tidak Ada") {
    return {
      ok: false,
      code: "FASKES_TIDAK_SESUAI",
      message:
        "Nama Faskes Pasien Tidak Sesuai dan periksa settingan bridging pada APM Touch. Tidak bisa klik Hadir.",
    };
  }

  return { ok: true };
}
