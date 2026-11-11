import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { transferCheck } from "@users/domain/business/transfer-account/mod.ts";
import type { User } from "@users/dto/user.ts";

export type TransferErrorCode = "bad_phone" | "same_number" | "phone_taken";

/** a refused transfer: the code the dialog reads, and the HTTP status it travels under */
export class TransferError extends Error {
  constructor(readonly error: TransferErrorCode, readonly status: number) {
    super(error);
    this.name = "TransferError";
  }
}

/**
 * TransferAccount (REQ-220) — "a button next to the phone that says transfer account … put a
 * different phone number in, changes the phone number, and now that person owns the account."
 *
 * AMENDMENT (2026-11-11, "I shouldn't get a code … transfer it without the code"): the number
 * alone moves the account — no text, no code. One atomic write puts the account on the new
 * number (same id, every record) and frees the old one; then the owner's own sessions are
 * dropped and the new owner's admin invite on this account is removed.
 */
@Injectable()
export class TransferAccount {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
    private admins: AccountAdminStore,
  ) {}

  async run(owner: User, rawPhone: unknown): Promise<User> {
    let phone: string;
    try {
      phone = normalizePhone(rawPhone as string);
    } catch {
      throw new TransferError("bad_phone", 400);
    }
    const refused = transferCheck(owner.phoneNumber, phone, await this.users.findByPhone(phone));
    if (refused) throw new TransferError(refused, 409);

    // the atomic write re-checks the number: someone may have signed up on it this instant
    const moved = await this.users.changePhone(owner.id, phone);
    if (!moved) throw new TransferError("phone_taken", 409);

    // the new owner is the owner now — not also an admin of its own account
    const invite = await this.admins.find(phone, owner.id);
    if (invite) await this.admins.delete(invite);
    await this.sessions.deleteOwn(owner.id);
    return moved;
  }
}
