/**
 * HTTP client for two actions in the external queue application:
 * CetakAntrian and Hadir. All requests come from the BFF, never the browser.
 *
 * Verified facts (see PROMPT_CETAK_ANTRIAN.md):
 * - print: static 200, no session required, `unit` must be exactly
 *   `Pendaftaran`.
 * - hadir: 303 -> /bpjs/process_bpjs_data/..., requires `ci_session`, and
 *   success must be read from the body. HTTP 500 can contain both a success
 *   message and a database error.
 */
import { buildLoketPayload, validateHadir } from "@/shared/loket";
import type { HadirRequest, PrintRequest } from "@/shared/schema";

export type LoketWarning = "log_lokal_gagal" | "pcare_sudah_terdaftar";

export interface LoketResult {
  ok: boolean;
  skipped?: boolean;
  state?: "terkirim";
  warning?: LoketWarning;
}

export class LoketApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LoketApiError";
  }
}

export interface LoketConfig {
  baseUrl: string;
  unit: string;
  unitId: string;
  dataUnit: string;
  timeoutMs: number;
}

export interface LoketApi {
  print(input: PrintRequest): Promise<LoketResult>;
  hadir(input: HadirRequest): Promise<LoketResult>;
}

type FetchLike = typeof fetch;

type HadirOutcome =
  | { ok: true; warning?: LoketWarning }
  | { ok: false; code: string; message: string; retrySession?: boolean };

/**
 * Classifies a Hadir response from the final body, not the HTTP status.
 * Exported so it can be tested without a network.
 */
export function classifyHadir(body: string, kode: string): HadirOutcome {
  if (body.includes("Data BPJS tidak ditemukan di session")) {
    return {
      ok: false,
      code: "HADIR_SESSION_FAILED",
      message: "Session BPJS tidak ditemukan di server antrian",
      retrySession: true,
    };
  }

  const sukses = `Anda Telah Mengirim Hadir No Antrian ${kode}`;
  if (body.includes(sukses)) {
    if (body.includes("Gagal mengirim ke PCARE BPJS") || body.includes("HTTP Code: 412")) {
      return { ok: true, warning: "pcare_sudah_terdaftar" };
    }
    if (body.includes("Database Error")) {
      return { ok: true, warning: "log_lokal_gagal" };
    }
    return { ok: true };
  }

  if (body.includes("kdProviderPeserta tidak ditemukan di data kunjungan")) {
    return {
      ok: false,
      code: "HADIR_INVALID_FASKES",
      message: "Faskes belum terisi di data kunjungan. Sinkronisasi dari SIMPUS J-CARE dulu.",
    };
  }

  return {
    ok: false,
    code: "HADIR_FAILED",
    message: "Server antrian tidak mengonfirmasi pengiriman kehadiran",
  };
}

function extractCookie(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = raw.match(/ci_session=([^;]+)/i);
  return match ? `ci_session=${match[1]}` : "";
}

export function createLoketApi(cfg: LoketConfig, fetchImpl: FetchLike = fetch): LoketApi {
  let cookie = "";

  function appRoot(): string {
    const base = cfg.baseUrl.replace(/\/+$/, "");
    return `${base.replace(/\/index\.php\/Antrian$/i, "")}/`;
  }

  async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutCode: string,
  ): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(cfg.timeoutMs) });
    } catch {
      throw new LoketApiError(timeoutCode, 502, "Permintaan ke server antrian gagal atau timeout");
    }
  }

  /** GET the app root and DataFingerUnit to hydrate the `ci_session` used by
   * /Hadir. Only one cookie is stored; the browser is not involved. */
  async function ensureSession(force = false): Promise<void> {
    if (cookie !== "" && !force) return;
    cookie = "";

    const root = appRoot();
    const first = await fetchWithTimeout(
      root,
      { redirect: "follow" },
      "HADIR_SESSION_FAILED",
    );
    cookie = extractCookie(first);

    const dataUrl = `${root}index.php/Antrian/DataFingerUnit/${encodeURIComponent(cfg.unitId)}/${encodeURIComponent(cfg.dataUnit)}`;
    const second = await fetchWithTimeout(
      dataUrl,
      { redirect: "follow", headers: cookie ? { Cookie: cookie } : {} },
      "HADIR_SESSION_FAILED",
    );
    cookie = extractCookie(second) || cookie;
  }

  return {
    async print(input: PrintRequest): Promise<LoketResult> {
      if (cfg.baseUrl === "") {
        throw new LoketApiError(
          "PRINT_NOT_CONFIGURED",
          502,
          "PRINT_API_BASE_URL belum diisi",
        );
      }

      let body: string;
      try {
        body = buildLoketPayload(input, { unit: cfg.unit, unitId: cfg.unitId }).toString();
      } catch (error) {
        throw new LoketApiError(
          "PRINT_CONFIG",
          500,
          error instanceof Error ? error.message : "konfigurasi cetak tidak valid",
        );
      }

      const response = await fetchWithTimeout(
        `${cfg.baseUrl}/CetakAntrian`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
        "PRINT_TIMEOUT",
      );
      if (!response.ok) {
        throw new LoketApiError(
          "PRINT_FAILED",
          502,
          `Server antrian menolak perintah cetak (HTTP ${response.status})`,
        );
      }
      return { ok: true };
    },

    async hadir(input: HadirRequest): Promise<LoketResult> {
      const valid = validateHadir(input);
      if (!valid.ok) throw new LoketApiError("HADIR_INVALID", 400, valid.message);
      if (cfg.baseUrl === "") {
        throw new LoketApiError("HADIR_NOT_CONFIGURED", 502, "PRINT_API_BASE_URL belum diisi");
      }

      let body: string;
      try {
        body = buildLoketPayload(input, { unit: cfg.unit, unitId: cfg.unitId }).toString();
      } catch (error) {
        throw new LoketApiError(
          "HADIR_CONFIG",
          500,
          error instanceof Error ? error.message : "konfigurasi hadir tidak valid",
        );
      }

      const post = () =>
        fetchWithTimeout(
          `${cfg.baseUrl}/Hadir`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              ...(cookie ? { Cookie: cookie } : {}),
            },
            body,
            redirect: "follow",
          },
          "HADIR_TIMEOUT",
        );

      await ensureSession();
      let response = await post();
      let outcome = classifyHadir(await response.text(), input.kode.trim());

      // The only allowed retry: the session was lost before BPJS received it.
      if (!outcome.ok && outcome.retrySession) {
        cookie = "";
        await ensureSession(true);
        response = await post();
        outcome = classifyHadir(await response.text(), input.kode.trim());
      }

      if (!outcome.ok) {
        const status = outcome.code === "HADIR_INVALID_FASKES" ? 400 : 502;
        throw new LoketApiError(outcome.code, status, outcome.message);
      }

      return {
        ok: true,
        state: "terkirim",
        ...(outcome.warning ? { warning: outcome.warning } : {}),
      };
    },
  };
}

export function createDisabledLoketApi(): LoketApi {
  const skipped = async (): Promise<LoketResult> => ({ ok: true, skipped: true });
  return { print: skipped, hadir: skipped };
}
