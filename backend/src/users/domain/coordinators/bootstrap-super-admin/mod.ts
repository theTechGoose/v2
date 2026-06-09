import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import type { User } from "@users/dto/user.ts";

const IS_PROD = typeof Deno !== "undefined" &&
  Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

/** Thrown when the bootstrap gate rejects the request. */
export class BootstrapForbiddenError extends Error {
  constructor() {
    super("bootstrap_forbidden");
    this.name = "BootstrapForbiddenError";
  }
}

/**
 * BootstrapSuperAdmin — create the VERY FIRST super admin, before any super
 * admin exists to grant the flag the normal way.
 *
 * Gate (so this can't be used to self-promote in the wild):
 *   - Local dev (NOT Deno Deploy): always allowed. Local already lets anyone
 *     log in via the master OTP, so there's nothing more to protect here.
 *   - Production (Deno Deploy): requires the env `SUPERADMIN_BOOTSTRAP_TOKEN`
 *     to be set AND the caller to present a matching token. With the env
 *     unset (the default), the endpoint is hard-closed.
 *
 * Once one super admin exists, prefer the guarded grant/revoke endpoints; this
 * is only the cold-start path.
 */
@Injectable()
export class BootstrapSuperAdmin {
  constructor(private users: UserStore) {}

  /** Whether the gate allows a bootstrap with the given (optional) token. */
  isAllowed(token?: string): boolean {
    if (!IS_PROD) return true;
    const expected = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN");
    return Boolean(expected) && token === expected;
  }

  /**
   * Grant super-admin to the user with `phoneNumber`. Throws
   * BootstrapForbiddenError if the gate rejects, NotFoundError if no user owns
   * that phone, or a phone-parse error for a malformed number.
   */
  async byPhone(phoneNumber: string, token?: string): Promise<User> {
    if (!this.isAllowed(token)) throw new BootstrapForbiddenError();
    const phone = normalizePhone(phoneNumber);
    const existing = await this.users.findByPhone(phone);
    if (!existing) throw new Error(`no user with phone ${phone}`);
    return await this.users.setSuperAdmin(existing.id, true);
  }
}
