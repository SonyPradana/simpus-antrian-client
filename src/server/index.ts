/**
 * BFF (backend-for-frontend) - Bun/Elysia.
 *
 * Tugas server ini:
 *  1. menjadi proxy ke Go API (Go API tidak diekspos ke browser)
 *  2. menyimpan antrian batch di SQLite (bertahan saat browser refresh)
 *  3. menjalankan batch executor (sequential) + push status via SSE
 *  4. menyajikan UI hasil build Vite
 */
import { existsSync } from "node:fs";
import { staticPlugin } from "@elysiajs/static";
import { Elysia, t } from "elysia";
import { z } from "zod";
import { AntrianApiError, createAntrianApi, type AntrianApi } from "./antrian";
import { SESSION_COOKIE, createSessionStore, type SessionStore } from "./auth";
import { BatchExecutor, JobControl, JobEvents } from "./batch";
import {
  APM_API_KEY,
  APM_BASE_URL,
  DB_PATH,
  DIST_DIR,
  MOCK_API,
  PORT,
} from "./config";
import { Store } from "./db";
import { createMockApi } from "./mock";
import { APMQueueBodySchema } from "@/shared/schema";
import type { Job, QueueItem } from "@/shared/types";

const CACHE_TTL = {
  poli: 10 * 60_000,
  dokter: 5 * 60_000,
  options: 10 * 60_000,
} as const;

const store = new Store(DB_PATH);
const events = new JobEvents();
const sessions: SessionStore = createSessionStore(store);

/* --------------------------- api resolution --------------------------- */

let apiCache: { key: string; api: AntrianApi } | null = null;

/**
 * API aktif ditentukan environment, bukan settings di browser/SQLite.
 * `MOCK_API=1` -> fixture lokal; selain itu -> HTTP ke Go API.
 *
 * Key APM hanya dibaca dari env BFF; tidak pernah dikirim ke browser.
 */
function getApi(): AntrianApi {
  const settings = store.getSettings();
  const baseUrl = APM_BASE_URL || settings.apiBaseUrl;
  const key = `${MOCK_API ? "mock" : "http"}:${baseUrl}:${APM_API_KEY ? "key" : "nokey"}`;
  if (!apiCache || apiCache.key !== key) {
    apiCache = {
      key,
      api: MOCK_API ? createMockApi() : createAntrianApi(baseUrl, APM_API_KEY),
    };
    store.clearCache();
  }
  return apiCache.api;
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = store.getCache<T>(key);
  if (hit) return hit;
  const value = await load();
  store.setCache(key, value, ttl);
  return value;
}

/* ------------------------------- helpers ------------------------------ */

function toItemPayload(item: QueueItem) {
  return {
    id: item.id,
    jobId: item.jobId,
    seq: item.seq,
    patient: item.patient,
    patientName: item.patientName,
    poliId: item.poliId,
    doctorCode: item.doctorCode,
    poscheckId: item.poscheckId,
    lokasi: item.lokasi,
    tenaga: item.tenaga,
    fallback: item.fallback,
    status: item.status,
    queueCode: item.queueCode,
    message: item.message,
    errorCode: item.errorCode,
    sudah_terdaftar: item.sudah_terdaftar,
  };
}

function errorPayload(error: unknown) {
  if (error instanceof AntrianApiError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Teruskan status HTTP dari Go API supaya BFF tidak salah kode. */
function errorStatus(error: unknown): number {
  if (error instanceof AntrianApiError) return error.status;
  return 500;
}

/* -------------------------------- jobs -------------------------------- */

const controls = new Map<string, JobControl>();
const running = new Map<string, Promise<void>>();

const ItemInput = t.Object({
  identifierType: t.Union([t.Literal("nik"), t.Literal("bpjs"), t.Literal("no_rm")]),
  identifierValue: t.String({ minLength: 1 }),
  poliId: t.Optional(t.String()),
  doctorCode: t.Optional(t.String()),
  poscheckId: t.Optional(t.String()),
  lokasi: t.Optional(t.String()),
  tenaga: t.Optional(t.String()),
  fallback: t.Optional(t.Boolean()),
});

const CreateJobBody = t.Object({
  source: t.Union([t.Literal("input"), t.Literal("excel")]),
  fallback: t.Optional(t.Boolean()),
  items: t.Array(ItemInput),
});

const AppendItemsBody = t.Object({
  items: t.Array(ItemInput),
});

const ReorderBody = t.Object({
  ids: t.Array(t.String()),
});

const app = new Elysia()
  .onError(({ code, error }) => {
    if (code === "VALIDATION") return;
    console.error("[antrian]", error);
  })

  /* ------------------------------ auth -------------------------------- */

  .derive(async ({ cookie }) => {
    const raw = cookie[SESSION_COOKIE];
    const token = raw === undefined ? undefined : String(raw.value ?? "");
    return { session: sessions.read(token) };
  })

  .onBeforeHandle(({ session, status }) => {
    if (!sessions.enabled) return;
    if (!session) {
      return status(401, { error: { code: "UNAUTHORIZED", message: "belum masuk" } });
    }
  })

  .post("/api/auth/login", async ({ body, set, status }) => {
    const parsed = z.object({ password: z.string() }).safeParse(body);
    if (!parsed.success) {
      return status(400, { error: { code: "INVALID_INPUT", message: "password wajib diisi" } });
    }
    const result = sessions.login(parsed.data.password);
    if (!result) {
      return status(401, { error: { code: "UNAUTHORIZED", message: "password salah" } });
    }
    set.headers["Set-Cookie"] =
      `${SESSION_COOKIE}=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${8 * 60 * 60}`;
    return { data: { user: result.session.user } };
  })

  .post("/api/auth/logout", ({ set }) => {
    set.headers["Set-Cookie"] = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    return { data: { ok: true } };
  })

  /* ----------------------------- health ------------------------------- */

  .get("/api/health", () => ({
    status: "ok",
    mock: MOCK_API,
    apmConfigured: APM_API_KEY !== "",
  }))

  /* --------------------------- data proxies --------------------------- */

  .get("/api/poli", async ({ status }) => {
    try {
      const poli = await cached("poli", CACHE_TTL.poli, () => getApi().listPoli());
      return { data: poli };
    } catch (error) {
      return status(errorStatus(error), { error: errorPayload(error) });
    }
  })

  .get("/api/dokter", async ({ query, status }) => {
    try {
      const poliId = query.poli_id ?? "";
      const result = await cached(`dokter:${poliId}`, CACHE_TTL.dokter, () =>
        getApi().listDoctors(poliId),
      );
      return { data: result };
    } catch (error) {
      return status(errorStatus(error), { error: errorPayload(error) });
    }
  })

  .get("/api/options", async ({ status }) => {
    try {
      const options = await cached("options", CACHE_TTL.options, () => getApi().apmOptions());
      return { data: options };
    } catch (error) {
      return status(errorStatus(error), { error: errorPayload(error) });
    }
  })

  /* --------------------------- queue (APM) ---------------------------- */

  .post("/api/queue", async ({ body, status }) => {
    const parsed = APMQueueBodySchema.safeParse(body);
    if (!parsed.success) {
      return status(400, {
        error: { code: "INVALID_INPUT", message: "data antrian tidak lengkap" },
      });
    }
    try {
      const result = await getApi().apmQueue(parsed.data);
      return { data: result };
    } catch (error) {
      return status(errorStatus(error), { error: errorPayload(error) });
    }
  })

  .get("/api/lookup", async ({ query, status }) => {
    const parsed = z
      .object({
        type: z.enum(["nik", "bpjs", "no_rm"]),
        value: z.string().min(1),
      })
      .safeParse({ type: query.type, value: query.value });
    if (!parsed.success) {
      return status(400, { error: { code: "INVALID_INPUT", message: "identitas tidak valid" } });
    }
    try {
      // Lookup tidak memverifikasi PCare (cepat); registrasi yang memverifikasi.
      const result = await getApi().apmLookup(parsed.data, false);
      return { data: result };
    } catch (error) {
      return status(errorStatus(error), { error: errorPayload(error) });
    }
  })

  /* ----------------------------- settings ----------------------------- */

  .get("/api/settings", () => ({ data: store.getSettings() }))

  .put("/api/settings", async ({ body, status }) => {
    const parsed = z
      .object({
        apiBaseUrl: z.string().optional(),
        defaultPoscheckId: z.string().optional(),
        defaultTenaga: z.string().optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return status(400, { error: { code: "INVALID_INPUT", message: "setting tidak valid" } });
    }
    const next = store.setSettings(parsed.data);
    store.clearCache();
    return { data: next };
  })

  /* -------------------------------- jobs ------------------------------ */

  .get("/api/jobs", () => ({ data: store.listJobs() }))

  .post("/api/jobs", ({ body, status }) => {
    const jobId = crypto.randomUUID();
    const job = store.createJob(jobId, body.source, body.fallback ?? false);

    const items: QueueItem[] = body.items.map((item, index) => ({
      id: crypto.randomUUID(),
      jobId,
      seq: index,
      patient: { type: item.identifierType, value: item.identifierValue },
      patientName: "",
      poliId: item.poliId ?? "",
      doctorCode: item.doctorCode ?? "",
      poscheckId: item.poscheckId ?? "",
      lokasi: item.lokasi ?? "",
      tenaga: item.tenaga ?? "",
      fallback: item.fallback ?? body.fallback ?? false,
      status: "menunggu",
      queueCode: "",
      message: "",
      errorCode: "",
      sudah_terdaftar: false,
    }));

    store.insertItems(items);
    return status(201, { data: { job, items: items.map(toItemPayload) } });
  }, { body: CreateJobBody })

  .post("/api/jobs/:id/items", ({ params, body, status }) => {
    const job = store.getJob(params.id);
    if (!job) {
      return status(404, { error: { code: "NOT_FOUND", message: "job tidak ditemukan" } });
    }
    const existing = store.listItems(params.id);
    const items: QueueItem[] = body.items.map((item, index) => ({
      id: crypto.randomUUID(),
      jobId: params.id,
      seq: existing.length + index,
      patient: { type: item.identifierType, value: item.identifierValue },
      patientName: "",
      poliId: item.poliId ?? "",
      doctorCode: item.doctorCode ?? "",
      poscheckId: item.poscheckId ?? "",
      lokasi: item.lokasi ?? "",
      tenaga: item.tenaga ?? "",
      fallback: item.fallback ?? job.fallback ?? false,
      status: "menunggu",
      queueCode: "",
      message: "",
      errorCode: "",
      sudah_terdaftar: false,
    }));
    store.insertItems(items);
    return { data: store.listItems(params.id).map(toItemPayload) };
  }, { body: AppendItemsBody })

  .get("/api/jobs/:id", ({ params, status }) => {    const job = store.getJob(params.id);
    if (!job) {
      return status(404, { error: { code: "NOT_FOUND", message: "job tidak ditemukan" } });
    }
    return { data: { job, items: store.listItems(params.id).map(toItemPayload) } };
  })

  .delete("/api/jobs/:id", ({ params }) => {
    store.deleteJob(params.id);
    controls.get(params.id)?.stop();
    return { data: { ok: true } };
  })

  .post("/api/jobs/:id/reorder", ({ params, body, status }) => {
    const job = store.getJob(params.id);
    if (!job) {
      return status(404, { error: { code: "NOT_FOUND", message: "job tidak ditemukan" } });
    }
    store.reorderItems(params.id, body.ids);
    return { data: store.listItems(params.id).map(toItemPayload) };
  }, { body: ReorderBody })

  .post("/api/jobs/:id/start", ({ params, status }) => {
    const job = store.getJob(params.id);
    if (!job) {
      return status(404, { error: { code: "NOT_FOUND", message: "job tidak ditemukan" } });
    }
    if (running.has(params.id)) {
      return status(409, { error: { code: "ALREADY_RUNNING", message: "job sedang berjalan" } });
    }

    const control = new JobControl();
    controls.set(params.id, control);

    const executor = new BatchExecutor(store, getApi(), events, {
      // Registrasi selalu verifikasi BPJS supaya "Nama Faskes" terisi.
      pcare: true,
    });

    const promise = executor.run(params.id, control).finally(() => {
      running.delete(params.id);
      controls.delete(params.id);
    });
    running.set(params.id, promise);

    return { data: { ok: true } };
  })

  .post("/api/jobs/:id/pause", ({ params }) => {
    controls.get(params.id)?.pause();
    store.setJobState(params.id, "paused");
    events.publish({ type: "job", jobId: params.id, state: "paused" });
    return { data: { ok: true } };
  })

  .post("/api/jobs/:id/resume", ({ params }) => {
    controls.get(params.id)?.resume();
    store.setJobState(params.id, "running");
    events.publish({ type: "job", jobId: params.id, state: "running" });
    return { data: { ok: true } };
  })

  .post("/api/jobs/:id/stop", ({ params }) => {
    controls.get(params.id)?.stop();
    store.setJobState(params.id, "stopped");
    events.publish({ type: "job", jobId: params.id, state: "stopped" });
    return { data: { ok: true } };
  })

  /* -------------------------------- SSE ------------------------------- */

  .get("/api/jobs/:id/stream", ({ params }) => {
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;

    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (chunk: string) => {
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              // stream sudah tertutup
            }
          };

          // snapshot awal
          write(
            `data: ${JSON.stringify({ type: "items", items: store.listItems(params.id) })}\n\n`,
          );

          const unsubscribe = events.subscribe(params.id, (event) => {
            write(`data: ${JSON.stringify(event)}\n\n`);
          });

          const heartbeat = setInterval(() => write(": ping\n\n"), 15_000);

          cleanup = () => {
            clearInterval(heartbeat);
            unsubscribe();
            try {
              controller.close();
            } catch {
              // sudah tertutup
            }
          };
        },
        // release resource saat client disconnect (docs/conventions.md §8)
        cancel() {
          cleanup?.();
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  });

/* ------------------------------- static ------------------------------- */

if (existsSync(DIST_DIR)) {
  app.use(await staticPlugin({ assets: DIST_DIR, prefix: "/" }));
} else {
  app.get("/", () => ({
    message: "UI belum di-build. Jalankan `bun run build:web` atau `bunx vite` untuk dev.",
  }));
}

app.listen(PORT);

console.log(`[antrian] BFF listen :${PORT}`);
console.log(`[antrian] db         ${DB_PATH}`);
console.log(
  `[antrian] api        ${
    MOCK_API
      ? "MOCK (tidak menyentuh Go API)"
      : APM_BASE_URL || store.getSettings().apiBaseUrl
  }`,
);
if (!MOCK_API && APM_API_KEY === "") {
  console.warn("[antrian] APM_API_KEY kosong - facade /api/v1/apm/* akan menolak request");
}

export type { Job };
