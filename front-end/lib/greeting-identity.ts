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
import { computeInitials } from "../../shared/identity/initials.ts";

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
  /** REQ-619 (cycle 4, p4-p3d) — the page's nav label key (nav.invoices,
   *  appNav.settings…): the heading names the page instead of greeting. */
  pageTitleKey?: string;
}

export function topbarGreeting(t: Translate, input: GreetingInput): string {
  // REQ-619 — every page but /dashboard is named, not greeted; a name saved
  // on the page (Settings) must not turn the page title back into a greeting
  if (input.pageTitleKey) return t(input.pageTitleKey);
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

/** REQ-502: the server's own rule (shared/identity/initials.ts) — a one-word
 *  name pairs with the business ("Carl" + "Jensen Electric" → "CJ"). */
export function deriveInitials(
  src: string | undefined,
  businessName?: string,
): string {
  const i = computeInitials(src?.trim(), businessName);
  return i === "?" ? "•" : i;
}

/** The real business name the sidebar shows (never the placeholder). */
function businessOf(profile: IdentitySource): string | undefined {
  const bizRaw =
    (profile.identity?.businessName ?? profile.identity?.displayName)?.trim();
  return bizRaw && !isPlaceholderName(bizRaw) ? bizRaw : undefined;
}

export function sidebarIdentity(
  profile: IdentitySource | null | undefined,
  t: Translate,
): SidebarIdentity | null {
  if (!profile) return null;
  const raw = profile.user?.name?.trim();
  const userName = raw && !isPlaceholderName(raw) ? raw : undefined;
  const bizName = businessOf(profile);
  if (userName) {
    // the server's initials are computed from this same real name
    const server = profile.initials?.trim();
    return {
      display: userName,
      ...(bizName ? { biz: bizName } : {}),
      initials: server && server !== "?"
        ? server
        : deriveInitials(userName, bizName),
    };
  }
  if (bizName) {
    return { display: bizName, initials: deriveInitials(undefined, bizName) };
  }
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
    initials: real ? deriveInitials(name, businessOf(profile)) : undefined,
  };
}

/**
 * REQ-737 (demo cycle 5, p12) — the cached profile with every field a
 * pm:profile-updated announcement carries (the person's name, the business
 * name), so the sidebar follows a rename in Settings at once. An empty
 * announcement returns the profile untouched.
 */
export function withSavedProfile<P extends IdentitySource>(
  profile: P,
  detail: { name?: string; businessName?: string },
): P {
  let out = profile;
  if (detail.businessName !== undefined) {
    out = {
      ...out,
      identity: { ...(out.identity ?? {}), businessName: detail.businessName },
    };
    // the server initials may pair the name with the old business — re-derive
    const raw = out.user?.name?.trim();
    const userName = raw && !isPlaceholderName(raw) ? raw : undefined;
    out = { ...out, initials: deriveInitials(userName, businessOf(out)) };
  }
  if (detail.name !== undefined) out = withSavedName(out, detail.name);
  return out;
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
