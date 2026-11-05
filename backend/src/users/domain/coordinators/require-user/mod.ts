import type { ExecutionContext } from "#danet/core";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import type { User } from "@users/dto/user.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";

export class UnauthorizedError extends Error {
  /** HTTP status. Danet's exception layer serializes `error.status || 500`,
   *  so carrying the real status here maps every UnauthorizedError anywhere
   *  on the API surface to a proper 401 (P-35). */
  readonly status: number = 401;
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** REQ-146: an admin acting for an account asked for something only the
 *  owner may do (close, wipe, the plan, the admins). 403, `acting_as_admin`. */
export class ActingAsAdminError extends Error {
  readonly status: number = 403;
  readonly error = "acting_as_admin";
  constructor() {
    super("acting_as_admin");
    this.name = "ActingAsAdminError";
  }
}

/**
 * Extract the session id from either:
 *   - the `x-session-id` header (preferred — used by the SDK and tests), OR
 *   - the `pm_session` cookie set by /auth/verify-otp (browser fallback).
 *
 * Returns null when neither is present.
 */
export function readSessionId(ctx: ExecutionContext): string | null {
  const header = ctx.req.header("x-session-id");
  if (header) return header;
  const cookieHeader = ctx.req.header("cookie");
  if (!cookieHeader) return null;
  // Split on ";" AND ",": over HTTP/2 a navigation sends each cookie as its own
  // `Cookie` header field, which Deno re-joins with ", "; a ";"-only split then
  // misses pm_session when another cookie (e.g. pm_lang) is present.
  const found = cookieHeader.split(/[;,]/).map((c) => c.trim()).find((c) =>
    c.startsWith("pm_session=")
  );
  if (!found) return null;
  return decodeURIComponent(found.slice("pm_session=".length));
}

/**
 * Resolve the calling user from the request, or throw UnauthorizedError.
 *
 * Use this inside controller methods on protected endpoints. (A future
 * AuthGuard wired into Danet's guard pipeline can replace per-handler calls,
 * but this helper keeps things explicit and framework-agnostic for v1.)
 */
export async function requireUser(
  ctx: ExecutionContext,
  sessions: SessionStore,
  users: UserStore,
): Promise<User> {
  const sessionId = readSessionId(ctx);
  if (!sessionId) throw new UnauthorizedError();
  const session = await sessions.get(sessionId);
  if (!session) throw new UnauthorizedError();
  let user: User;
  try {
    user = await users.get(session.userId);
  } catch {
    throw new UnauthorizedError();
  }
  // REQ-039 (NW-52): a closed (soft-deleted) account has no live sessions.
  if (user.deletedAt) throw new UnauthorizedError();
  // REQ-146: a session acting for an account lives only while its admin
  // record does — the owner's removal takes effect on the next request.
  if (session.actorId) {
    let actor: User;
    try {
      actor = await users.get(session.actorId);
    } catch {
      throw new UnauthorizedError();
    }
    if (actor.deletedAt) throw new UnauthorizedError();
    const member = await new AccountAdminStore().find(actor.phoneNumber, user.id);
    if (!member) throw new UnauthorizedError();
  }
  return user;
}

/**
 * REQ-146: the owner alone — a session acting for the account as one of its
 * admins is refused with 403 `acting_as_admin`. Resolves the user like
 * requireUser (401 first) so a guarded route never leaks past a dead session.
 */
export async function requireOwner(
  ctx: ExecutionContext,
  sessions: SessionStore,
  users: UserStore,
): Promise<User> {
  const user = await requireUser(ctx, sessions, users);
  const session = await sessions.get(readSessionId(ctx)!);
  if (session?.actorId) throw new ActingAsAdminError();
  return user;
}
