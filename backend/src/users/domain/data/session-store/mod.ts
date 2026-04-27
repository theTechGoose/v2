import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
}

const TTL_MS = 30 * 24 * 60 * 60 * 1_000;     // 30 days

/**
 * SessionStore — opaque session tokens with a 30-day TTL.
 *
 * Storage:
 *   ["session", sessionId] → Session   (expires after TTL_MS)
 *
 * Sessions are write-once / read-many / delete-on-logout. There's no update.
 */
@Injectable()
export class SessionStore {
  async create(userId: string): Promise<Session> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const session: Session = { id, userId, createdAt: new Date().toISOString() };
    await kv.set(["session", id], session, { expireIn: TTL_MS });
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    const kv = await getKv();
    const result = await kv.get<Session>(["session", sessionId]);
    return result.value ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete(["session", sessionId]);
  }
}
