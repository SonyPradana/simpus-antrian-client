/**
 * HTTP client for two external loket actions. All requests come from the BFF,
 * never the browser.
 *
 * - Print posts JSON to the simpus-antrian-terminal API: `POST /api/print`
 *   with `X-API-Key`. The terminal owns the legacy print server and the
 *   `printer = 'medium'` flag.
 * - Hadir still uses the legacy CodeIgniter endpoint. It needs `ci_session`
 *   hydration and body-text classification; HTTP 500 can contain both a
 *   success message and a database error.
 */
import { buildLoketPayload, dataUnitFor, validateHadir } from "@/shared/loket";
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
  /** Legacy base URL for the Hadir endpoint. */
  hadirBaseUrl: string;
  /** Base URL of the print terminal API; no `/api/print` suffix. */
  printBaseUrl: string;
  /** Secret sent as `X-API-Key` to the print terminal. */
  apiKey: string;
  unitId: string;
  timeoutMs: number;
}

export interface LoketApi {
  print(input: PrintRequest): Promise<LoketResult>;
  hadir(input: HadirRequest): Promise<LoketResult>;
}

type FetchLike = typeof fetch;

/**
 * Checks the unauthenticated terminal health endpoint. Any network error,
 * non-2xx status, or degraded payload means printing must be disabled.
 */
export async function isPrintBackendReady(
  cfg: Pick<LoketConfig, "printBaseUrl" | "timeoutMs">,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (cfg.printBaseUrl === "") return false;
  try {
    const response = await fetchImpl(`${cfg.printBaseUrl}/healthz`, {
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: unknown; db?: unknown };
    return body.status === "ok" && body.db === "ok";
  } catch {
    return false;
  }
}

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

interface PrintErrorBody {
  error?: { code?: string; message?: string };
}

async function readPrintError(response: Response): Promise<PrintErrorBody["error"]> {
  try {
    const body = (await response.json()) as PrintErrorBody;
    return body.error ?? {};
  } catch {
    return {};
  }
}

/** Terminal transport/auth failures are BFF failures, not client input errors. */
function printErrorStatus(httpStatus: number): number {
  if (httpStatus === 404) return 404;
  if (httpStatus === 409) return 409;
  if (httpStatus >= 500 || httpStatus === 401 || httpStatus === 403) return 502;
  return 400;
}

export function createLoketApi(cfg: LoketConfig, fetchImpl: FetchLike = fetch): LoketApi {
  let cookie = "";

  function appRoot(): string {
    const base = cfg.hadirBaseUrl.replace(/\/+$/, "");
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
      throw new LoketApiError(timeoutCode, 502, "Permintaan ke server eksternal gagal atau timeout");
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

    const dataUrl = `${root}index.php/Antrian/DataFingerUnit/${encodeURIComponent(cfg.unitId)}/${encodeURIComponent(dataUnitFor(cfg.unitId))}`;
    const second = await fetchWithTimeout(
      dataUrl,
      { redirect: "follow", headers: cookie ? { Cookie: cookie } : {} },
      "HADIR_SESSION_FAILED",
    );
    cookie = extractCookie(second) || cookie;
  }

  return {
    async print(input: PrintRequest): Promise<LoketResult> {
      if (cfg.printBaseUrl === "" || cfg.apiKey === "") {
        throw new LoketApiError(
          "PRINT_NOT_CONFIGURED",
          502,
          "PRINT_API_BASE_URL atau PRINT_API_KEY belum diisi",
        );
      }

      const kode = input.kode.trim();
      if (kode === "") {
        throw new LoketApiError("PRINT_INVALID", 400, "kode antrian wajib diisi");
      }

      const response = await fetchWithTimeout(
        `${cfg.printBaseUrl}/api/print`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": cfg.apiKey,
          },
          body: JSON.stringify({ kode, force: input.force === true }),
        },
        "PRINT_TIMEOUT",
      );

      // Duplicate guards are idempotent: the command is already recorded.
      if (response.status === 409) {
        const detail = await readPrintError(response);
        if (detail?.code === "ALREADY_REQUESTED" || detail?.code === "ALREADY_PRINTED") {
          return { ok: true };
        }
        throw new LoketApiError(
          detail?.code ?? "PRINT_NOT_ELIGIBLE",
          409,
          detail?.message ?? "Kode antrian tidak memenuhi syarat cetak",
        );
      }

      if (!response.ok) {
        const detail = await readPrintError(response);
        throw new LoketApiError(
          detail?.code ?? "PRINT_FAILED",
          printErrorStatus(response.status),
          detail?.message ?? `Terminal menolak perintah cetak (HTTP ${response.status})`,
        );
      }
      return { ok: true };
    },

    async hadir(input: HadirRequest): Promise<LoketResult> {
      const valid = validateHadir(input);
      if (!valid.ok) throw new LoketApiError("HADIR_INVALID", 400, valid.message);
      if (cfg.hadirBaseUrl === "") {
        throw new LoketApiError("HADIR_NOT_CONFIGURED", 502, "HADIR_API_BASE_URL belum diisi");
      }

      let body: string;
      try {
        body = buildLoketPayload(input, { unitId: cfg.unitId }).toString();
      } catch (error) {
        throw new LoketApiError(
          "HADIR_CONFIG",
          500,
          error instanceof Error ? error.message : "konfigurasi hadir tidak valid",
        );
      }

      const post = () =>
        fetchWithTimeout(
          `${cfg.hadirBaseUrl}/Hadir`,
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
