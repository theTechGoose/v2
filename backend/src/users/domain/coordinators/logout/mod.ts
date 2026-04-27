import { Injectable } from "#danet/core";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";

/**
 * Logout — drop the session record. Idempotent: deleting a missing/expired
 * session is a no-op so the client can always blindly POST /auth/logout
 * regardless of whether the session is still valid.
 */
@Injectable()
export class Logout {
  constructor(private sessions: SessionStore) {}

  async run(sessionId: string): Promise<{ ok: true }> {
    await this.sessions.delete(sessionId);
    return { ok: true };
  }
}
