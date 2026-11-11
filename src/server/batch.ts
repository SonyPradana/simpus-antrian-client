/**
 * Executor batch: menjalankan item antrian satu per satu (sequential).
 *
 * Kenapa sequential: Go API memakai MySQL `GET_LOCK('apm:queue:<date>')` dengan
 * timeout 5 detik (server/internal/service/service.go:245). Request paralel
 * akan saling berebut lock dan berakhir 503 QUEUE_BUSY.
 *
 * Bentuk error (docs/conventions.md §4):
 *   retry  - QUEUE_BUSY + error jaringan        -> sudah ditangani di antrian.ts
 *   escape - PATIENT_NOT_FOUND  -> fallback mode blank (kalau item.fallback)
 *   escape - ALREADY_REGISTERED -> sukses, ambil kode antrian yang sudah ada
 *   domain - sisanya -> status "gagal" + pesan
 */
import { APMQueueResultSchema, type APMQueueBody } from "@/shared/schema";
import type { JobEvent, QueueItem } from "@/shared/types";
import { AntrianApiError, type AntrianApi } from "./antrian";
import type { Store } from "./db";

/* ------------------------------- events ------------------------------- */

export class JobEvents {
  private readonly subscribers = new Map<string, Set<(event: JobEvent) => void>>();

  subscribe(jobId: string, handler: (event: JobEvent) => void): () => void {
    const set = this.subscribers.get(jobId) ?? new Set();
    set.add(handler);
    this.subscribers.set(jobId, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.subscribers.delete(jobId);
    };
  }

  publish(event: JobEvent): void {
    const set = this.subscribers.get(event.jobId);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // subscriber yang error tidak boleh menghentikan job
      }
    }
  }
}

/* ------------------------------- control ------------------------------ */

/** Kendali jalannya job: pause / resume / stop. */
export class JobControl {
  private paused = false;
  private stopped = false;
  private waiters: Array<() => void> = [];

  get isPaused(): boolean {
    return this.paused;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.wake();
  }

  stop(): void {
    this.stopped = true;
    this.paused = false;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Menunggu sampai di-resume (atau di-stop). */
  async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

/* ------------------------------- executor ----------------------------- */

export interface ExecutorOptions {
  /** kirim `pcare=true` (verifikasi BPJS). Registrasi default: true. */
  pcare: boolean;
}

/**
 * Body mode `registration`: identifier + petugas + poscheck.
 * Tidak ada `lokasi` - server mengambil nama dari `poschecks`.
 */
export function buildRegistrationBody(item: QueueItem, pcare: boolean): APMQueueBody {
  const body: APMQueueBody = {
    mode: "registration",
    poli_id: item.poliId,
  };

  if (item.patient.type === "bpjs") body.no_bpjs = item.patient.value;
  else if (item.patient.type === "nik") body.nik = item.patient.value;
  else body.no_rm = item.patient.value;

  if (item.doctorCode) body.kode_dokter = item.doctorCode;
  if (item.poscheckId) body.poscheck_id = item.poscheckId;
  if (item.tenaga) body.petugas_id = item.tenaga;
  if (pcare) body.pcare = true;

  return body;
}

/**
 * Body mode `blank`: tanpa identifier dan tanpa `petugas_id` (ditolak server).
 */
export function buildBlankBody(item: QueueItem): APMQueueBody {
  const body: APMQueueBody = { mode: "blank", poli_id: item.poliId };

  if (item.doctorCode) body.kode_dokter = item.doctorCode;
  if (item.poscheckId) body.poscheck_id = item.poscheckId;

  return body;
}

export class BatchExecutor {
  constructor(
    private readonly store: Store,
    private readonly api: AntrianApi,
    private readonly events: JobEvents,
    private readonly options: ExecutorOptions,
  ) {}

  async run(jobId: string, control: JobControl): Promise<void> {
    const items = this.store.listItems(jobId);
    this.setJobState(jobId, "running");

    for (const item of items) {
      await control.waitWhilePaused();
      if (control.isStopped) break;
      if (item.status !== "menunggu") continue;
      await this.executeItem(jobId, item);
    }

    this.setJobState(jobId, control.isStopped ? "stopped" : "idle");
  }

  private setJobState(jobId: string, state: "idle" | "running" | "paused" | "stopped"): void {
    this.store.setJobState(jobId, state);
    this.events.publish({ type: "job", jobId, state });
  }

  private publishItem(jobId: string, item: QueueItem): void {
    this.events.publish({ type: "item", jobId, item });
  }

  private async executeItem(jobId: string, item: QueueItem): Promise<void> {
    const running = this.store.updateItem(item.id, {
      status: "berjalan",
      message: "",
      errorCode: "",
    });
    if (running) this.publishItem(jobId, running);

    try {
      const result = await this.api.apmQueue(buildRegistrationBody(item, this.options.pcare));
      const done = this.store.updateItem(item.id, {
        status: "sukses",
        queueCode: result.antrian.kode,
        patientName: result.patient?.nama ?? "",
        // Lokasi dan poscheck mengikuti response server, bukan salinan client.
        lokasi: result.lokasi ?? item.lokasi,
        poscheckId: result.poscheck_id ?? item.poscheckId,
        message: "",
        errorCode: "",
      });
      if (done) this.publishItem(jobId, done);
      return;
    } catch (error) {
      if (!(error instanceof AntrianApiError)) {
        const failed = this.store.updateItem(item.id, {
          status: "gagal",
          message: error instanceof Error ? error.message : String(error),
          errorCode: "INTERNAL_ERROR",
        });
        if (failed) this.publishItem(jobId, failed);
        return;
      }

      // escape: sudah terdaftar hari ini -> tetap sukses, ambil nomornya
      if (error.isAlreadyRegistered) {
        // `data` divalidasi, bukan di-cast: kontrak APM memakai bentuk queue
        // yang sama dengan response sukses.
        const parsed = APMQueueResultSchema.safeParse(error.data);
        const done = this.store.updateItem(item.id, {
          status: "sukses",
          queueCode: parsed.success ? parsed.data.antrian.kode : "",
          lokasi: parsed.success ? (parsed.data.lokasi ?? item.lokasi) : item.lokasi,
          message: "pasien sudah terdaftar hari ini",
          errorCode: "",
          sudah_terdaftar: true,
        });
        if (done) this.publishItem(jobId, done);
        return;
      }

      // escape: tidak ditemukan -> fallback jadi pasien baru (kalau diizinkan)
      if (error.code === "PATIENT_NOT_FOUND" && item.fallback) {
        try {
          const result = await this.api.apmQueue(buildBlankBody(item));
          const done = this.store.updateItem(item.id, {
            status: "sukses",
            queueCode: result.antrian.kode,
            lokasi: result.lokasi ?? item.lokasi,
            message: "pasien tidak ditemukan -issued sebagai pasien baru",
            errorCode: "",
          });
          if (done) this.publishItem(jobId, done);
        } catch (fallbackError) {
          const failed = this.store.updateItem(item.id, {
            status: "gagal",
            message:
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            errorCode:
              fallbackError instanceof AntrianApiError ? fallbackError.code : "INTERNAL_ERROR",
          });
          if (failed) this.publishItem(jobId, failed);
        }
        return;
      }

      const failed = this.store.updateItem(item.id, {
        status: "gagal",
        message: error.message,
        errorCode: error.code,
      });
      if (failed) this.publishItem(jobId, failed);
    }
  }
}
