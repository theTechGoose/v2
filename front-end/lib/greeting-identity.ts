/**
 * REQ-423 — who the chrome says you are (demo cycle 2, p3 + S3). Pure, so the
 * islands and the jest unit project share one rule:
 *
 *   - the topbar greeting: a user with no real name (none, blank, or the seeded
 *     sign-in placeholder "Nuevo usuario" / "New user") is greeted with
 *     `dashTopbar.greetingNoName`, resolved by the caller's LIVE-language `t` —
 *     never a server-translated fallback word baked in as a name ("Hola, hola",
 *     then "Hey, hola" after the EN toggle);
 *   - the sidebar identity: the placeholder is no name — the business name
 *     stands in, else "Account"; the initials come from what is shown, so a
 *     placeholder never reads "NU".
 */
import {
  greetingFirstName,
  isPlaceholderName,
} from "../../shared/quote-flow/outbound-identity.ts";

/** A translator bound to the live language. */
export type Translate = (key: string, vars?: Record<string, string>) => string;

export interface GreetingInput {
  /** The SSR first name — undefined when the user has no real name. */
  greetingName?: string;
  /** A name saved on this page (pm:profile-updated); wins over the SSR one. */
  savedName?: string;
  /** Dict key replacing the "Hey, {name}" line, resolved in the live language. */
  greetingOverrideKey?: string;
  /** @deprecated SSR-frozen override string. */
  greetingOverride?: string;
}

export function topbarGreeting(t: Translate, input: GreetingInput): string {
  const noName = () => t("dashTopbar.greetingNoName");
  if (input.savedName !== undefined) {
    const first = greetingFirstName(input.savedName);
    return first ? t("dashTopbar.greeting", { name: first }) : noName();
  }
  if (input.greetingOverrideKey) return t(input.greetingOverrideKey);
  if (input.greetingOverride !== undefined) return input.greetingOverride;
  const first = greetingFirstName(input.greetingName);
  return first ? t("dashTopbar.greeting", { name: first }) : noName();
}

/** The profile fields the sidebar identity reads (a ProfileSnapshot fits). */
export interface IdentitySource {
  user: { name?: string | null };
  identity?:
    | { businessName?: string | null; displayName?: string | null }
    | null;
  initials?: string | null;
}

export interface SidebarIdentity {
  display: string;
  biz?: string;
  initials: string;
}

export function deriveInitials(src: string | undefined): string {
  const s = src?.trim();
  if (!s) return "•";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function sidebarIdentity(
  profile: IdentitySource | null | undefined,
  t: Translate,
): SidebarIdentity | null {
  if (!profile) return null;
  const raw = profile.user?.name?.trim();
  const userName = raw && !isPlaceholderName(raw) ? raw : undefined;
  const bizRaw =
    (profile.identity?.businessName ?? profile.identity?.displayName)?.trim();
  const bizName = bizRaw && !isPlaceholderName(bizRaw) ? bizRaw : undefined;
  if (userName) {
    // the server's initials are computed from this same real name
    const server = profile.initials?.trim();
    return {
      display: userName,
      ...(bizName ? { biz: bizName } : {}),
      initials: server && server !== "?" ? server : deriveInitials(userName),
    };
  }
  if (bizName) return { display: bizName, initials: deriveInitials(bizName) };
  return { display: t("common.account"), initials: deriveInitials(undefined) };
}

/** The cached profile with a just-saved name, so the sidebar follows at once. */
export function withSavedName<P extends IdentitySource>(
  profile: P,
  name: string,
): P {
  const real = !isPlaceholderName(name);
  return {
    ...profile,
    user: { ...profile.user, name },
    // the server initials were derived from the old name — re-derive
    initials: real ? deriveInitials(name) : undefined,
  };
}

/**
 * REQ-506 — the welcome-back toast line (demo cycle 3, m26 + s8). `template`
 * is the live-language "welcome.back" string ("Bienvenido de nuevo,
 * {firstName}."); `name` is /api/me's raw name. The seeded placeholder
 * ("Nuevo usuario" / "New user") or a blank name is no name, so the toast
 * reads the nameless `welcomeBackToast.noName` — never "…, Nuevo.".
 */
export function welcomeBackMessage(
  t: Translate,
  template: string,
  name: string | null | undefined,
): string {
  const first = greetingFirstName(name);
  return first
    ? template.replace("{firstName}", first)
    : t("welcomeBackToast.noName");
}
