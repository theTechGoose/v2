import { Injectable } from "#danet/core";
import {
  type Session,
  SessionStore,
} from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import type { User } from "@users/dto/user.ts";

/** Thrown by `stop` when the current session isn't an impersonation session. */
export class NotImpersonatingError extends Error {
  constructor() {
    super("not_impersonating");
    this.name = "NotImpersonatingError";
  }
}

export interface ImpersonationResult {
  session: Session;
  user: User;
}

/**
 * Impersonate — start/stop acting as another user on behalf of a super admin.
 *
 * Impersonation is entirely server-side and reversible: a dedicated session
 * carries both the effective (target) user and the real super-admin id, so
 * requireUser() resolves the target while the act stays auditable and can be
 * unwound back to the super-admin's own session.
 *
 * The caller (admin controller) is responsible for proving the initiator is a
 * super admin (requireSuperAdmin) BEFORE calling `start`.
 */
@Injectable()
export class Impersonate {
  constructor(
    private sessions: SessionStore,
    private users: UserStore,
  ) {}

  /**
   * Begin impersonating `targetUserId`. `realUser` is the already-verified
   * super admin and `realSessionId` their current session (preserved so we
   * can hand it back). Throws NotFoundError if the target doesn't exist.
   */
  async start(
    input: { realUser: User; realSessionId: string; targetUserId: string },
  ): Promise<ImpersonationResult> {
    const target = await this.users.get(input.targetUserId);
    const session = await this.sessions.createImpersonation({
      targetUserId: target.id,
      impersonatorId: input.realUser.id,
      returnSessionId: input.realSessionId,
    });
    return { session, user: target };
  }

  /**
   * Stop impersonating, given the CURRENT (impersonation) session. Returns to
   * the super-admin's original session when it's still alive, otherwise mints
   * a fresh one for them. The impersonation session is dropped either way.
   */
  async stop(current: Session): Promise<ImpersonationResult> {
    if (!current.impersonatorId) throw new NotImpersonatingError();

    let real = current.returnSessionId
      ? await this.sessions.get(current.returnSessionId)
      : null;
    if (!real || real.userId !== current.impersonatorId) {
      real = await this.sessions.create(current.impersonatorId);
    }

    await this.sessions.delete(current.id);
    const user = await this.users.get(real.userId);
    return { session: real, user };
  }
}
