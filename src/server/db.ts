/**
 * Penyimpanan client: settings, cache API, dan job + item antrian.
 *
 * SQLite lewat `bun:sqlite` (bawaan Bun, tanpa dependency).
 * Skema: docs/conventions.md §1.1
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { IdentifierType, ItemStatus, JobSource, JobState } from "@/shared/schema";
import type { Job, QueueItem, Settings } from "@/shared/types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  state      TEXT NOT NULL DEFAULT 'idle',
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  fallback   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_items (
  id               TEXT PRIMARY KEY,
  job_id           TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  identifier_type  TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  patient_name    TEXT NOT NULL DEFAULT '',
  poli_id          TEXT NOT NULL DEFAULT '',
  doctor_code      TEXT NOT NULL DEFAULT '',
  poscheck_id      TEXT NOT NULL DEFAULT '',
  lokasi           TEXT NOT NULL DEFAULT '',
  tenaga           TEXT NOT NULL DEFAULT '',
  fallback         INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'menunggu',
  queue_code       TEXT NOT NULL DEFAULT '',
  message          TEXT NOT NULL DEFAULT '',
  error_code       TEXT NOT NULL DEFAULT '',
  sudah_terdaftar  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items(job_id, seq);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

interface ItemRow {
  id: string;
  job_id: string;
  seq: number;
  identifier_type: string;
  identifier_value: string;
  patient_name: string;
  poli_id: string;
  doctor_code: string;
  poscheck_id: string;
  lokasi: string;
  tenaga: string;
  fallback: number;
  status: string;
  queue_code: string;
  message: string;
  error_code: string;
  sudah_terdaftar: number;
}

interface JobRow {
  id: string;
  state: string;
  source: string;
  created_at: number;
  fallback: number;
}

function toItem(row: ItemRow): QueueItem {
  return {
    id: row.id,
    jobId: row.job_id,
    seq: row.seq,
    patient: {
      type: row.identifier_type as IdentifierType,
      value: row.identifier_value,
    },
    patientName: row.patient_name,
    poliId: row.poli_id,
    doctorCode: row.doctor_code,
    poscheckId: row.poscheck_id,
    lokasi: row.lokasi,
    tenaga: row.tenaga,
    fallback: row.fallback === 1,
    status: row.status as ItemStatus,
    queueCode: row.queue_code,
    message: row.message,
    errorCode: row.error_code,
    sudah_terdaftar: row.sudah_terdaftar === 1,
  };
}

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: "http://localhost:8080",
  defaultPoscheckId: "",
  defaultTenaga: "",
};

export class Store {
  readonly db: Database;

  constructor(filePath: string) {
    // Hasil ekstraksi zip belum punya folder data/; tanpa ini SQLite gagal
    // membuka file dan exe mati saat pertama dijalankan.
    if (filePath !== ":memory:") mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA foreign_keys = ON;");
    this.db.run(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /* ---------------------------- settings ---------------------------- */

  getSettings(): Settings {
    const row = this.db.query<{ value: string }, [string]>(
      "SELECT value FROM settings WHERE key = ?",
    ).get("app");
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      // Hanya field yang dikenal: baris lama bisa memuat `lokasiTemplates`
      // atau `defaultLokasi` yang sekarang tidak dipakai lagi.
      const parsed = JSON.parse(row.value) as Partial<Settings>;
      return {
        apiBaseUrl: parsed.apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl,
        defaultPoscheckId: parsed.defaultPoscheckId ?? DEFAULT_SETTINGS.defaultPoscheckId,
        defaultTenaga: parsed.defaultTenaga ?? DEFAULT_SETTINGS.defaultTenaga,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  setSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch };
    this.db
      .query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run("app", JSON.stringify(next));
    return next;
  }

  /* ------------------------------ cache ----------------------------- */

  getCache<T>(key: string): T | null {
    const row = this.db
      .query<{ value: string; expires_at: number }, [string]>(
        "SELECT value, expires_at FROM cache WHERE key = ?",
      )
      .get(key);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.query("DELETE FROM cache WHERE key = ?").run(key);
      return null;
    }
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  setCache(key: string, value: unknown, ttlMs: number): void {
    this.db
      .query(
        "INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
      )
      .run(key, JSON.stringify(value), Date.now() + ttlMs);
  }

  clearCache(): void {
    this.db.run("DELETE FROM cache");
  }

  /* ------------------------------- job ------------------------------ */

  createJob(id: string, source: JobSource, fallback: boolean): Job {
    const createdAt = Date.now();
    this.db
      .query(
        "INSERT INTO jobs (id, state, source, created_at, fallback) VALUES (?, 'idle', ?, ?, ?)",
      )
      .run(id, source, createdAt, fallback ? 1 : 0);
    return { id, state: "idle", source, createdAt, fallback };
  }

  listJobs(): Job[] {
    const rows = this.db
      .query<JobRow, []>("SELECT * FROM jobs ORDER BY created_at DESC")
      .all();
    return rows.map((row) => ({
      id: row.id,
      state: row.state as JobState,
      source: row.source as JobSource,
      createdAt: row.created_at,
      fallback: row.fallback === 1,
    }));
  }

  getJob(id: string): Job | null {
    const row = this.db.query<JobRow, [string]>("SELECT * FROM jobs WHERE id = ?").get(id);
    if (!row) return null;
    return {
      id: row.id,
      state: row.state as JobState,
      source: row.source as JobSource,
      createdAt: row.created_at,
      fallback: row.fallback === 1,
    };
  }

  setJobState(id: string, state: JobState): void {
    this.db.query("UPDATE jobs SET state = ? WHERE id = ?").run(state, id);
  }

  /* ------------------------------- item ----------------------------- */

  insertItems(items: QueueItem[]): void {
    const insert = this.db.query(
      `INSERT INTO job_items
        (id, job_id, seq, identifier_type, identifier_value, patient_name, poli_id, doctor_code,
         poscheck_id, lokasi, tenaga, fallback, status, queue_code, message, error_code, sudah_terdaftar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAll = this.db.transaction((rows: QueueItem[]) => {
      for (const item of rows) {
        insert.run(
          item.id,
          item.jobId,
          item.seq,
          item.patient.type,
          item.patient.value,
          item.patientName,
          item.poliId,
          item.doctorCode,
          item.poscheckId,
          item.lokasi,
          item.tenaga,
          item.fallback ? 1 : 0,
          item.status,
          item.queueCode,
          item.message,
          item.errorCode,
          item.sudah_terdaftar ? 1 : 0,
        );
      }
    });
    insertAll(items);
  }

  listItems(jobId: string): QueueItem[] {
    const rows = this.db
      .query<ItemRow, [string]>("SELECT * FROM job_items WHERE job_id = ? ORDER BY seq")
      .all(jobId);
    return rows.map(toItem);
  }

  updateItem(
    id: string,
    patch: Partial<
      Pick<
        QueueItem,
        | "status"
        | "queueCode"
        | "message"
        | "errorCode"
        | "sudah_terdaftar"
        | "poliId"
        | "doctorCode"
        | "poscheckId"
        | "lokasi"
        | "tenaga"
        | "patientName"
      >
    >,
  ): QueueItem | null {
    const current = this.db
      .query<ItemRow, [string]>("SELECT * FROM job_items WHERE id = ?")
      .get(id);
    if (!current) return null;

    const next = { ...toItem(current), ...patch };
    this.db
      .query(
        `UPDATE job_items SET
           status = ?, queue_code = ?, message = ?, error_code = ?,
           sudah_terdaftar = ?, poli_id = ?, doctor_code = ?, poscheck_id = ?,
           lokasi = ?, tenaga = ?, patient_name = ?
         WHERE id = ?`,
      )
      .run(
        next.status,
        next.queueCode,
        next.message,
        next.errorCode,
        next.sudah_terdaftar ? 1 : 0,
        next.poliId,
        next.doctorCode,
        next.poscheckId,
        next.lokasi,
        next.tenaga,
        next.patientName,
        id,
      );
    return next;
  }

  reorderItems(jobId: string, orderedIds: string[]): void {
    const update = this.db.query("UPDATE job_items SET seq = ? WHERE id = ? AND job_id = ?");
    const apply = this.db.transaction(() => {
      orderedIds.forEach((id, index) => {
        update.run(index, id, jobId);
      });
    });
    apply();
  }

  deleteJob(id: string): void {
    this.db.query("DELETE FROM job_items WHERE job_id = ?").run(id);
    this.db.query("DELETE FROM jobs WHERE id = ?").run(id);
  }

  /* ----------------------------- session ----------------------------- */

  createSession(token: string, session: { user: string; expiresAt: number }): void {
    this.db
      .query(
        "INSERT INTO sessions (token, user, expires_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET user = excluded.user, expires_at = excluded.expires_at",
      )
      .run(token, session.user, session.expiresAt);
  }

  getSession(token: string): { user: string; expiresAt: number } | null {
    const row = this.db
      .query<{ user: string; expires_at: number }, [string]>(
        "SELECT user, expires_at FROM sessions WHERE token = ?",
      )
      .get(token);
    if (!row) return null;
    return { user: row.user, expiresAt: row.expires_at };
  }

  deleteSession(token: string): void {
    this.db.query("DELETE FROM sessions WHERE token = ?").run(token);
  }
}

