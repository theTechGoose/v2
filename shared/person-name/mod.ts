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
