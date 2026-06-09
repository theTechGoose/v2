import type { ExecutionContext } from "#danet/core";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import type { User } from "@users/dto/user.ts";

/** Thrown when an authenticated, NON-super-admin user hits an admin endpoint.
 *  Distinct from UnauthorizedError (no/invalid session) so the surface can
 *  tell "log in" from "you're logged in but not allowed". */
export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

/**
 * Resolve the calling user and assert they're a super admin, or throw.
 *
 * Layers on top of requireUser: first proves a valid session (→ throws
 * UnauthorizedError if not), then checks the server-side `superAdmin` flag
 * (→ throws ForbiddenError if not). The client is NEVER trusted for the
 * super-admin decision — it's read straight off the stored User.
 */
export async function requireSuperAdmin(
  ctx: ExecutionContext,
  sessions: SessionStore,
  users: UserStore,
): Promise<User> {
  const user = await requireUser(ctx, sessions, users);
  if (user.superAdmin !== true) throw new ForbiddenError();
  return user;
}
