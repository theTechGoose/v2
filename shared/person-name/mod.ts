/**
 * REQ-624 — who the app names. A session acting for someone else's account (an invited editor,
 * REQ-146) is the owner's ACCOUNT but HER person: /me and the /profile snapshot carry `actor`
 * then, and every "Hi {name}", sidebar user block, toast and "your name" field reads the actor
 * over the account's user. The business (name, logo, documents) stays the account's.
 */
import { isPlaceholderName } from "../quote-flow/outbound-identity.ts";

export interface ActorLike {
  name?: string;
  needsName?: boolean;
}

export interface PersonLike {
  name?: string;
  actor?: ActorLike | null;
}

/** the signed-in person's name: the actor's while acting (never the owner's), else the user's */
export function personName(
  user: PersonLike | null | undefined,
  actor: ActorLike | null | undefined = user?.actor,
): string | undefined {
  const n = actor ? actor.name : user?.name;
  return n?.trim() || undefined;
}

/** the first word to greet with — none for the sign-up placeholder ("New user" / "Nuevo usuario"),
 *  nor for an editor with no name yet (her phone stands in for her name, never greeted with) */
export function greetingFirstName(
  user: PersonLike | null | undefined,
  actor: ActorLike | null | undefined = user?.actor,
): string | undefined {
  if (actor?.needsName) return undefined;
  const n = personName(user, actor);
  if (!n || isPlaceholderName(n)) return undefined;
  return n.split(/\s+/)[0];
}

/** Settings' "your name" field: hers while acting — blank while she has none (her phone stands in) */
export function editableName(
  user: PersonLike | null | undefined,
  actor: ActorLike | null | undefined = user?.actor,
): string {
  if (actor) return actor.needsName ? "" : (actor.name?.trim() ?? "");
  return user?.name ?? "";
}

export type PersonLang = "en" | "es";

const asLang = (v: unknown): PersonLang | undefined =>
  v === "en" || v === "es" ? v : undefined;

/**
 * REQ-631 — the signed-in person's UI language: the actor's while acting (an invited editor's own
 * record, never the owner's), falling back to the account's when she has none yet; the account's
 * own on its own session. Undefined when neither is a language, so each caller keeps its default.
 * What the business sends its customers is NOT this — that is the business identity's
 * commsLanguage (and, for a few owner-addressed copies, the owner's own record).
 */
/** REQ-631 — the ACCOUNT's own language, for business content only (the
 *  send-in languages a business starts with, REQ-348) — never the UI's, which
 *  is `personLanguage`. */
export function accountLanguage(
  user: { language?: string } | null | undefined,
): PersonLang | undefined {
  return asLang(user?.language);
}

export function personLanguage(
  user:
    | { language?: string; actor?: { language?: string } | null }
    | null
    | undefined,
  actor: { language?: string } | null | undefined = user?.actor,
): PersonLang | undefined {
  if (actor) return asLang(actor.language) ?? asLang(user?.language);
  return asLang(user?.language);
}

/** the sign-up placeholders, any case — never a name an owner may give an editor */
const PLACEHOLDERS = new Set(["new user", "nuevo usuario"]);

/**
 * REQ-632 — the editor's name on an invite, required: the trimmed name (at most 120 characters),
 * or null when it is missing, not text, blank/whitespace, or the sign-up placeholder. The one rule
 * the invite form (Invite disabled, inline error) and the API (400 name_required) share.
 */
export function inviteName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.trim();
  if (!n || PLACEHOLDERS.has(n.toLowerCase())) return null;
  return n.slice(0, 120);
}
