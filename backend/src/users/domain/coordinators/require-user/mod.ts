import type { ExecutionContext } from "#danet/core";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import type { User } from "@users/dto/user.ts";

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
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
  const found = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("pm_session="));
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
  try {
    return await users.get(session.userId);
  } catch {
    throw new UnauthorizedError();
  }
}
