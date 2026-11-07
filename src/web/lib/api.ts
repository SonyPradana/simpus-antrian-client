/**
 * Client ke BFF (server ini sendiri). Semua error BFF dilempar sebagai
 * `ClientError` supaya UI bisa menampilkan pesan apa adanya.
 */
import type {
  APMLookupResult,
  APMOptions,
  APMQueueBody,
  APMQueueResult,
  DoctorList,
  PatientRef,
  Poli,
} from "@/shared/schema";
import type { Job, JobEvent, QueueItem, Settings } from "@/shared/types";

export class ClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ClientError";
    this.code = code;
  }
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  const raw = (await response.json().catch(() => null)) as Envelope<T> | null;

  if (raw?.error) {
    throw new ClientError(raw.error.code, raw.error.message);
  }
  if (!response.ok) {
    throw new ClientError("HTTP_ERROR", `HTTP ${response.status}`);
  }
  return raw?.data as T;
}

export interface JobPayload {
  job: Job;
  items: QueueItem[];
}

export const api = {
  health: () =>
    request<{ status: string; mock: boolean; apmConfigured: boolean }>("/api/health"),

  listPoli: () => request<Poli[]>("/api/poli"),

  listDoctors: (poliId: string) =>
    request<DoctorList>(`/api/dokter?poli_id=${encodeURIComponent(poliId)}`),

  options: () => request<APMOptions>("/api/options"),

  lookup: (patient: PatientRef) =>
    request<APMLookupResult>(
      `/api/lookup?type=${patient.type}&value=${encodeURIComponent(patient.value)}`,
    ),

  getSettings: () => request<Settings>("/api/settings"),

  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  listJobs: () => request<Job[]>("/api/jobs"),

  createJob: (input: {
    source: "input" | "excel";
    fallback: boolean;
    items: Array<{
      identifierType: PatientRef["type"];
      identifierValue: string;
      poliId?: string;
      doctorCode?: string;
      poscheckId?: string;
      lokasi?: string;
      tenaga?: string;
      fallback?: boolean;
    }>;
  }) =>
    request<JobPayload>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getJob: (id: string) => request<JobPayload>(`/api/jobs/${id}`),

  appendItems: (
    id: string,
    items: Array<{
      identifierType: PatientRef["type"];
      identifierValue: string;
      poliId?: string;
      doctorCode?: string;
      poscheckId?: string;
      lokasi?: string;
      tenaga?: string;
      fallback?: boolean;
    }>,
  ) =>
    request<QueueItem[]>(`/api/jobs/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  deleteJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),

  reorder: (id: string, ids: string[]) =>
    request<QueueItem[]>(`/api/jobs/${id}/reorder`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  start: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}/start`, { method: "POST" }),

  pause: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}/pause`, { method: "POST" }),

  resume: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}/resume`, { method: "POST" }),

  stop: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}/stop`, { method: "POST" }),

  // dipakai manual & batch - BFF meneruskan ke `POST /api/v1/apm/queue`
  queue: (body: APMQueueBody) =>
    request<APMQueueResult>("/api/queue", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

/**
 * Subscribe status job via SSE. Return fungsi unsubscribe.
 * Handler error tidak boleh mematikan stream.
 */
export function subscribeJob(
  jobId: string,
  onEvent: (event: JobEvent | { type: "items"; items: QueueItem[] }) => void,
): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/stream`);

  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data));
    } catch {
      // payload rusak -> abaikan
    }
  };

  return () => source.close();
}
