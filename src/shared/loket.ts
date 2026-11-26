/**
 * Pure logic for external loket actions (Cetak Antrian and Hadir).
 *
 * Shared by the BFF and the browser. There is no I/O here so the rules can be
 * tested without a network. Endpoint facts are recorded in
 * PROMPT_CETAK_ANTRIAN.md.
 */

/** `unit` must be exactly this; other values are accepted but do not print. */
export const LOKET_UNIT = "Pendaftaran";

export interface LoketPayloadConfig {
  unit: string;
  unitId: string;
}

/** Only these four fields are sent to the external endpoint. */
export function buildLoketPayload(
  input: { kode: string; poli?: string },
  cfg: LoketPayloadConfig,
): URLSearchParams {
  if (cfg.unit !== LOKET_UNIT) {
    throw new Error(`PRINT_UNIT must be "${LOKET_UNIT}", got "${cfg.unit}"`);
  }
  const kode = (input.kode ?? "").trim();
  if (kode === "") throw new Error("queue code is required");

  const params = new URLSearchParams();
  params.set("kode", kode);
  params.set("unit", cfg.unit);
  params.set("poli", input.poli ?? "");
  params.set("unitId", cfg.unitId || "99");
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
