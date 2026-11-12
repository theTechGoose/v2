/** REQ-146 — the pure rules of account admins. */
import type { AccountAdmin } from "@users/dto/account-admin.ts";
import type { Language } from "@users/dto/user.ts";
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

/** REQ-624 — how the signed-in person is named while acting for an account, and whether to ask */
export interface ActorName {
  /** never the owner's: her own real name, else the invite's name for THIS account, else her phone */
  name: string;
  /** true when she has no name anywhere — the app asks her once */
  needsName: boolean;
}

/** a US E.164 number as people read it ("(843) 555-0101"); any other number as stored */
export function readablePhone(phone: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

/** REQ-624 — the acting person's name: her own, else this account's invite name, else her phone */
export function actorName(actor: { phoneNumber: string; name?: string }, inviteName: string | undefined): ActorName {
  const own = realName(actor.name);
  if (own) return { name: own, needsName: false };
  const invited = inviteName?.trim();
  if (invited) return { name: invited, needsName: false };
  return { name: readablePhone(actor.phoneNumber), needsName: true };
}

/**
 * PUT /me while acting: everything in it is the PERSON's own and goes to HER record — her name and
 * email (REQ-624) and, REQ-631, her language. Nothing reaches the account: the owner's record (his
 * language included) is his alone. Kept as a split so a future account-level field has a place.
 */
export function splitActingPatch(
  patch: { name?: string; email?: string; language?: Language },
): { actor: { name?: string; email?: string; language?: Language }; account: Record<string, never> } {
  const actor: { name?: string; email?: string; language?: Language } = {};
  if (patch.name !== undefined) actor.name = patch.name;
  if (patch.email !== undefined) actor.email = patch.email;
  if (patch.language !== undefined) actor.language = patch.language;
  return { actor, account: {} };
}

/** REQ-631 — the signed-in person's language (hers while acting); REQ-632 — the required invite name.
 *  One rule each, shared with the front-end. */
export { inviteName, personLanguage } from "#person-name/mod.ts";
