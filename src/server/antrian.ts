/**
 * Client HTTP ke Go API + seam "swap R" (docs/conventions.md §9).
 *
 * `AntrianApi` adalah antarmuka. Ada dua implementasi:
 *  - `createAntrianApi()` -> HTTP ke facade `/api/v1/apm/*`
 *  - `createMockApi()`    -> fixture lokal (src/server/mock.ts)
 *
 * Catatan: TIDAK ada request ke Go API yang dieksekusi di repo ini kecuali
 * `MOCK_API=0` diset eksplisit di environment BFF.
 */
import type { z } from "zod";
import {
  ApiErrorSchema,
  APMLookupResultSchema,
  APMOptionsSchema,
  APMQueueResultSchema,
  DoctorListSchema,
  PoliSchema,
  envelope,
} from "@/shared/schema";
import { identifierKey } from "@/shared/mode";
import type {
  APMLookupResult,
  APMOptions,
  APMQueueBody,
  APMQueueResult,
  DoctorList,
  PatientRef,
  Poli,
} from "@/shared/schema";

export interface AntrianApi {
  listPoli(): Promise<Poli[]>;
  listDoctors(poliId: string): Promise<DoctorList>;
  apmOptions(): Promise<APMOptions>;
  apmLookup(ref: PatientRef, pcare: boolean): Promise<APMLookupResult>;
  apmQueue(body: APMQueueBody): Promise<APMQueueResult>;
}

/** Error terstruktur dari Go API. `data` dipakai untuk ALREADY_REGISTERED. */
export class AntrianApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly data?: unknown;

  constructor(code: string, status: number, message: string, data?: unknown) {
    super(message);
    this.name = "AntrianApiError";
    this.code = code;
    this.status = status;
    this.data = data;
  }

  /** ALREADY_REGISTERED bukan kegagalan - ini nomor antrian yang sudah ada. */
  get isAlreadyRegistered(): boolean {
    return this.code === "ALREADY_REGISTERED";
  }
}

const RETRYABLE_CODES = new Set(["QUEUE_BUSY"]);
const MAX_ATTEMPTS = 3;

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === "TypeError" ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("socket")
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry hanya untuk `QUEUE_BUSY` (lock MySQL) dan error jaringan.
 *
 * Catatan: POST /apm/queue tidak idempoten, tapi server punya cek duplikat
 * (ALREADY_REGISTERED) sehingga retry setelah response hilang aman: hasilnya
 * jadi 409, bukan nomor antrian ganda.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const wait = options.sleep ?? sleep;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const retryable =
        error instanceof AntrianApiError
          ? RETRYABLE_CODES.has(error.code)
          : isNetworkError(error);
      if (!retryable || attempt >= maxAttempts) throw error;
      await wait(1000 * 2 ** (attempt - 1));
    }
  }
}

class HttpAntrianApi implements AntrianApi {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T extends z.ZodType>(
    path: string,
    schema: T,
    init?: RequestInit,
  ): Promise<z.infer<T>> {
    // Facade APM tidak bisa dipakai tanpa key. Gagal cepat dengan pesan yang
    // bisa ditindaklanjuti, bukan 503 dari server.
    if (this.apiKey === "") {
      throw new AntrianApiError(
        "APM_NOT_CONFIGURED",
        503,
        "APM_API_KEY belum diset di BFF",
      );
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        ...init?.headers,
      },
    });

    const raw: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(raw);
      if (parsed.success) {
        throw new AntrianApiError(
          parsed.data.error.code,
          response.status,
          parsed.data.error.message,
          parsed.data.data,
        );
      }
      throw new AntrianApiError("INTERNAL_ERROR", response.status, `HTTP ${response.status}`);
    }

    const parsed = envelope(schema).safeParse(raw);
    if (!parsed.success) {
      throw new AntrianApiError(
        "BAD_RESPONSE",
        response.status,
        "respons server tidak sesuai kontrak",
        parsed.error.issues,
      );
    }
    // schema sudah memvalidasi bentuknya; cast ini hanya untuk tipe generik zod
    return (parsed.data as { data: z.infer<T> }).data;
  }

  listPoli(): Promise<Poli[]> {
    return withRetry(() => this.request("/api/v1/apm/poli", PoliSchema.array()));
  }

  listDoctors(poliId: string): Promise<DoctorList> {
    return withRetry(() =>
      this.request(
        `/api/v1/apm/dokter?poli_id=${encodeURIComponent(poliId)}`,
        DoctorListSchema,
      ),
    );
  }

  apmOptions(): Promise<APMOptions> {
    return withRetry(() => this.request("/api/v1/apm/options", APMOptionsSchema));
  }

  apmLookup(ref: PatientRef, pcare: boolean): Promise<APMLookupResult> {
    const query = new URLSearchParams({ pcare: String(pcare) });
    return withRetry(() =>
      this.request(`/api/v1/apm/lookup?${query.toString()}`, APMLookupResultSchema, {
        method: "POST",
        body: JSON.stringify({ [identifierKey(ref.type)]: ref.value }),
      }),
    );
  }

  apmQueue(body: APMQueueBody): Promise<APMQueueResult> {
    return withRetry(() =>
      this.request("/api/v1/apm/queue", APMQueueResultSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }
}

export function createAntrianApi(baseUrl: string, apiKey = ""): AntrianApi {
  return new HttpAntrianApi(baseUrl.replace(/\/+$/, ""), apiKey.trim());
}
