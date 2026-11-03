/**
 * REQ-138 — a worker's session: a random token in an HttpOnly `pm_worker`
 * cookie, 30 days; five wrong PINs lock the worker for a minute. KV with
 * expiry, so every isolate sees the same sessions and locks.
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

export const WORKER_COOKIE = "pm_worker";
const SESSION_DAYS = 30;
const LOCK_AFTER = 5;
const LOCK_MS = 60_000;

export interface WorkerSession {
  token: string;
  workerId: string;
  userId: string;
  createdAt: string;
}

@Injectable()
export class WorkerSessionStore {
  async create(workerId: string, userId: string): Promise<WorkerSession> {
    const s: WorkerSession = { token: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""), workerId, userId, createdAt: new Date().toISOString() };
    const kv = await getKv();
    await kv.set(["field_worker_session", s.token], s, { expireIn: SESSION_DAYS * 86_400_000 });
    return s;
  }
  async get(token: string): Promise<WorkerSession | null> {
    const kv = await getKv();
    return (await kv.get<WorkerSession>(["field_worker_session", token])).value;
  }
  async delete(token: string): Promise<void> {
    const kv = await getKv();
    await kv.delete(["field_worker_session", token]);
  }
  /** true while the worker is locked out */
  async locked(workerId: string): Promise<boolean> {
    const kv = await getKv();
    const m = (await kv.get<{ n: number }>(["field_worker_lock", workerId])).value;
    return !!m && m.n >= LOCK_AFTER;
  }
  async miss(workerId: string): Promise<void> {
    const kv = await getKv();
    const key = ["field_worker_lock", workerId];
    const cur = (await kv.get<{ n: number }>(key)).value?.n ?? 0;
    await kv.set(key, { n: cur + 1 }, { expireIn: LOCK_MS });
  }
  async clearMisses(workerId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete(["field_worker_lock", workerId]);
  }
  static cookie(token: string): string {
    return `${WORKER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
  }
  static clearCookie(): string {
    return `${WORKER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  static tokenFrom(cookieHeader: string | undefined | null): string | null {
    if (!cookieHeader) return null;
    const found = cookieHeader.split(/[;,]/).map((c) => c.trim()).find((c) => c.startsWith(`${WORKER_COOKIE}=`));
    return found ? decodeURIComponent(found.slice(WORKER_COOKIE.length + 1)) : null;
  }
}
