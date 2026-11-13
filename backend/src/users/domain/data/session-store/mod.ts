import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ownSession } from "@users/domain/business/transfer-account/mod.ts";

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
  /** REQ-146: set when the session acts FOR an account as one of its admins —
   *  the admin's OWN user id. `userId` is then the owner's. requireUser
   *  re-checks the admin record on every request, so a removal cuts it. */
  actorId?: string;
  /** REQ-806: an approved ops view — reads only; requireSession refuses every write */
  readOnly?: boolean;
  /** REQ-806: the session is dead after this (an ops view: 30 minutes) */
  expiresAt?: string;
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

  /**
   * REQ-806: an approved ops view of `targetUserId` — read-only, gone after `ttlMs`, and carrying
   * the approving super admin as `impersonatorId` so the act is auditable. No return session: it
   * is nobody's sign-in.
   */
  async createOpsView(
    input: { targetUserId: string; impersonatorId: string; ttlMs: number },
  ): Promise<Session> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const now = Date.now();
    const session: Session = {
      id,
      userId: input.targetUserId,
      createdAt: new Date(now).toISOString(),
      impersonatorId: input.impersonatorId,
      readOnly: true,
      expiresAt: new Date(now + input.ttlMs).toISOString(),
    };
    await kv.set(["session", id], session, { expireIn: input.ttlMs });
    return session;
  }

  /** REQ-146: a session IN `userId`'s account for `actorId`, one of its admins. */
  async createActing(userId: string, actorId: string): Promise<Session> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const session: Session = { id, userId, actorId, createdAt: new Date().toISOString() };
    await kv.set(["session", id], session, { expireIn: TTL_MS });
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    const kv = await getKv();
    const result = await kv.get<Session>(["session", sessionId]);
    return result.value ?? null;
  }

  /**
   * REQ-220: drop every session that is `userId` signed in as themselves — an admin's acting
   * session and an impersonation stay (ownSession). There is no per-user index; the scan is the
   * same whole-prefix sweep WipeAccount does. Returns how many went.
   */
  async deleteOwn(userId: string): Promise<number> {
    const kv = await getKv();
    let gone = 0;
    for await (const entry of kv.list<Session>({ prefix: ["session"] })) {
      if (entry.value && ownSession(entry.value, userId)) {
        await kv.delete(entry.key);
        gone++;
      }
    }
    return gone;
  }

  async delete(sessionId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete(["session", sessionId]);
  }
}
