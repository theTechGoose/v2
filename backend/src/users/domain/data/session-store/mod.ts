import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

export interface Session {
  id: string;
  /** The EFFECTIVE user this session acts as — what requireUser() resolves.
   *  During impersonation this is the impersonated (target) user. */
  userId: string;
  createdAt: string;
  /** Set only on impersonation sessions: the REAL super-admin user id behind
   *  the impersonation. Kept on the session so the act is server-side,
   *  reversible, and auditable. */
  impersonatorId?: string;
  /** The super-admin's own session to hand back to on stop-impersonating. */
  returnSessionId?: string;
}

const TTL_MS = 30 * 24 * 60 * 60 * 1_000; // 30 days

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
    const session: Session = {
      id,
      userId,
      createdAt: new Date().toISOString(),
    };
    await kv.set(["session", id], session, { expireIn: TTL_MS });
    return session;
  }

  /**
   * Mint an impersonation session: acts as `targetUserId` while recording the
   * real super-admin (`impersonatorId`) and the session to return to
   * (`returnSessionId`). The super-admin's original session is left intact so
   * stop-impersonating can hand it straight back.
   */
  async createImpersonation(
    input: {
      targetUserId: string;
      impersonatorId: string;
      returnSessionId: string;
    },
  ): Promise<Session> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const session: Session = {
      id,
      userId: input.targetUserId,
      createdAt: new Date().toISOString(),
      impersonatorId: input.impersonatorId,
      returnSessionId: input.returnSessionId,
    };
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
