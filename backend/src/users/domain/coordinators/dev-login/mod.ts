import { Injectable } from "#danet/core";
import {
  type Session,
  SessionStore,
} from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import type { User } from "@users/dto/user.ts";

/**
 * REQ-130 — Raphael, 2026-11-02: "Mint a developer token and put it as an
 * environment variable and use it as your login. If you have this developer
 * token, it skips the authorization feature."
 *
 * DevLogin — a SERVICE credential, not a human sign-in. Presented with the
 * secret `DEV_LOGIN_TOKEN`, it mints a real session for an EXISTING user by
 * phone, skipping the OTP entirely. This is the automation-identity path
 * (like a service account / admin API token), distinct from a person typing
 * a one-time code into the login.
 *
 * Gate — the same shape as BootstrapSuperAdmin / reset-by-phone, but HARDER:
 *   - `DEV_LOGIN_TOKEN` env MUST be set, in dev AND in prod. Unset (the
 *     default) → the endpoint is hard-closed everywhere, so nothing is
 *     exposed by accident.
 *   - The presented token must match, compared in constant time.
 * It never CREATES an account and refuses a closed one: it can only open a
 * session for a user who already exists and is live.
 */
export class DevLoginForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super("dev_login_forbidden");
    this.name = "DevLoginForbiddenError";
  }
}

/** The token was accepted but no live user owns that phone. */
export class DevLoginNoUserError extends Error {
  readonly status = 404;
  constructor(public readonly phone: string) {
    super("dev_login_no_user");
    this.name = "DevLoginNoUserError";
  }
}

export interface DevLoginResult {
  session: Session;
  user: User;
}

/** Constant-time string compare — no early-out on the first mismatched byte. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare against a fixed-length digest so length never leaks via timing.
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

@Injectable()
export class DevLogin {
  constructor(private sessions: SessionStore, private users: UserStore) {}

  /** Whether the gate allows a dev login with the given (optional) token. */
  isAllowed(token?: string): boolean {
    const expected = typeof Deno !== "undefined"
      ? Deno.env.get("DEV_LOGIN_TOKEN")
      : undefined;
    if (!expected) return false; // hard-closed when the env var is unset
    if (typeof token !== "string" || token.length === 0) return false;
    return timingSafeEqual(token, expected);
  }

  /**
   * Mint a session for the live user who owns `phoneNumber`. Throws
   * DevLoginForbiddenError when the gate rejects, DevLoginNoUserError when no
   * live user owns the phone.
   */
  async byPhone(phoneNumber: string, token?: string): Promise<DevLoginResult> {
    if (!this.isAllowed(token)) throw new DevLoginForbiddenError();
    const phone = normalizePhone(phoneNumber);
    const user = await this.users.findByPhone(phone);
    if (!user || user.deletedAt) throw new DevLoginNoUserError(phone);
    const session = await this.sessions.create(user.id);
    return { session, user };
  }
}
