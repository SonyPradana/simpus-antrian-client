/**
 * Seam auth. Sekarang MATI (semua request lolos), tapi bentuknya sudah final
 * supayaggi hari ini tidak ada route yang lupa dilewatkan.
 *
 * Mengaktifkan: set env `AUTH_PASSWORD`. Password dibandingkan dengan
 * `timingSafeEqual` (hash SHA-256 kedua-duanya supaya panjang tidak bocor).
 * Session: token random 32 byte, disimpan di SQLite, cookie `antrian_session`.
 *
 * Tidak ada dependency auth tambahan - cukup `node:crypto` bawaan.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "./db";

export interface Session {
  user: string;
  expiresAt: number;
}

export interface SessionStore {
  readonly enabled: boolean;
  read(token: string | undefined): Session | null;
  issue(user: string): { token: string; session: Session };
  revoke(token: string): void;
  /** login -> token, atau null kalau password salah */
  login(password: string): { token: string; session: Session } | null;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam
export const SESSION_COOKIE = "antrian_session";

/** Auth mati. */
export class OpenSessionStore implements SessionStore {
  readonly enabled = false;

  read(): Session | null {
    return { user: "local", expiresAt: Date.now() + SESSION_TTL_MS };
  }

  issue(): { token: string; session: Session } {
    const session: Session = { user: "local", expiresAt: Date.now() + SESSION_TTL_MS };
    return { token: "open", session };
  }

  revoke(): void {}

  login(): { token: string; session: Session } {
    return this.issue();
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Auth aktif lewat env `AUTH_PASSWORD`. */
export class PasswordSessionStore implements SessionStore {
  readonly enabled = true;

  constructor(
    private readonly store: Store,
    private readonly password: string,
  ) {}

  private matches(candidate: string): boolean {
    return timingSafeEqual(digest(this.password), digest(candidate));
  }

  read(token: string | undefined): Session | null {
    if (!token) return null;
    const session = this.store.getSession(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.store.deleteSession(token);
      return null;
    }
    return session;
  }

  issue(user: string): { token: string; session: Session } {
    const token = randomBytes(32).toString("base64url");
    const session: Session = { user, expiresAt: Date.now() + SESSION_TTL_MS };
    this.store.createSession(token, session);
    return { token, session };
  }

  revoke(token: string): void {
    this.store.deleteSession(token);
  }

  login(password: string): { token: string; session: Session } | null {
    if (!this.matches(password)) return null;
    return this.issue("operator");
  }
}

export function createSessionStore(store: Store): SessionStore {
  const password = process.env.AUTH_PASSWORD?.trim();
  return password ? new PasswordSessionStore(store, password) : new OpenSessionStore();
}
