/** REQ-146 — the pure rules of account admins. */
import type { AccountAdmin } from "@users/dto/account-admin.ts";
import { isPlaceholderName } from "@users/domain/business/placeholder-name/mod.ts";

export interface SignInAccount {
  /** the account the session opens in — `Session.userId`, what requireUser answers */
  userId: string;
  /** the person signing in, when that is not the account itself */
  actorId: string | undefined;
}

/**
 * Where a phone's sign-in lands: its own account when the number administers
 * none; otherwise the account of the EARLIEST invite, the person as the actor.
 */
export function pickSignInAccount(ownUserId: string, memberships: readonly AccountAdmin[]): SignInAccount {
  if (memberships.length === 0) return { userId: ownUserId, actorId: undefined };
  const earliest = [...memberships].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return { userId: earliest.userId, actorId: ownUserId };
}

/** a person's name as they set it — never the sign-up placeholder ("Nuevo usuario") */
export function realName(name: string | undefined): string | undefined {
  const n = name?.trim();
  return n && !isPlaceholderName(n) ? n : undefined;
}

/** how an account reads in the switcher: the business, else the owner's name, else the phone */
export function accountLabel(owner: { phoneNumber: string; name?: string }, businessName: string | undefined): string {
  const biz = businessName?.trim();
  if (biz) return biz;
  return realName(owner.name) ?? owner.phoneNumber;
}

/** what an invite refuses before anything is stored: the owner's own number */
export function inviteCheck(ownerPhone: string, phone: string): "own_number" | null {
  return ownerPhone === phone ? "own_number" : null;
}
