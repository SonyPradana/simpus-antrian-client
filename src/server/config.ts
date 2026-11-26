/**
 * Konfigurasi runtime BFF.
 *
 * Semua nilai yang menentukan perilaku produksi dibaca dari environment,
 * bukan dari SQLite/browser. Tujuannya: operator di puskesmas tidak bisa
 * "tidak sengaja" menyalakan mock saat melayani pasien.
 *
 * Hanya satu file: `.env` di direktori kerja. Variabel yang sudah diset di
 * shell tidak ditimpa, jadi `MOCK_API=1 bun run dev` menang atas isi file.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** Mock hanya aktif kalau diminta eksplisit lewat env. Default mati. */
export const MOCK_API = bool(process.env.MOCK_API, false);

export const PORT = Number(process.env.PORT ?? 3000);
export const DB_PATH = process.env.ANTRIAN_DB ?? path.join(process.cwd(), "data", "antrian.db");
export const DIST_DIR = path.join(process.cwd(), "dist");
export const APM_API_KEY = (process.env.APM_API_KEY ?? "").trim();
export const AUTH_PASSWORD = (process.env.AUTH_PASSWORD ?? "").trim();

/** Base URL Go API. Env menang atas nilai yang tersimpan di settings. */
export const APM_BASE_URL = (process.env.APM_BASE_URL ?? "").trim();

/* ------------------- external loket actions ------------------- */

/**
 * Base URL for loket actions, for example
 * `http://192.168.1.99/antrian/index.php/Antrian`.
 * Empty means the actions are disabled. Do not hardcode a production host.
 */
export const PRINT_API_BASE_URL = (process.env.PRINT_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

/** Must be exactly `Pendaftaran` for the print command to run. */
export const PRINT_UNIT = (process.env.PRINT_UNIT ?? "Pendaftaran").trim();
export const PRINT_UNIT_ID = (process.env.PRINT_UNIT_ID ?? "99").trim();
export const PRINT_TIMEOUT_MS = Number(process.env.PRINT_TIMEOUT_MS ?? 5000);

export const PRINT_ENABLED = bool(process.env.PRINT_ENABLED, PRINT_API_BASE_URL !== "");
export const PRINT_ALLOW_MOCK = bool(process.env.PRINT_ALLOW_MOCK, false);
export const PRINT_ON_BATCH = bool(process.env.PRINT_ON_BATCH, false);

export const HADIR_ENABLED = bool(process.env.HADIR_ENABLED, PRINT_ENABLED);
export const HADIR_ALLOW_MOCK = bool(process.env.HADIR_ALLOW_MOCK, PRINT_ALLOW_MOCK);

/** Used for session hydration: 99 -> Pendaftaran_1, 96 -> Pendaftaran_2. */
export const LOKET_DATAUNIT = (process.env.LOKET_DATAUNIT ?? "Pendaftaran_1").trim();
