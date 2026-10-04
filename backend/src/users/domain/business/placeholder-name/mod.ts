import type { Language } from "@users/dto/user.ts";

/** Brand-new users have no name. We seed a neutral, language-appropriate
 *  placeholder at creation so the app's identity-dependent UI is reachable
 *  immediately — most importantly the sidebar's user block, which is the only
 *  entry point to /settings and only renders once a name (or business name)
 *  exists. Without a name a fresh user literally cannot open Settings. The
 *  placeholder is freely overwritable in Settings or via the assistant. */
const PLACEHOLDER_NAMES = { en: "New user", es: "Nuevo usuario" } as const;

export function placeholderNameFor(language: Language | undefined): string {
  return language === "es" ? PLACEHOLDER_NAMES.es : PLACEHOLDER_NAMES.en;
}

/** True when `name` is empty or still the seeded placeholder — i.e. the user
 *  hasn't set a real name yet. Lets the dev seeder overwrite the
 *  placeholder without clobbering a genuinely-onboarded user's name, and keeps
 *  the placeholder off the CRM customer (REQ-058). */
export function isPlaceholderName(name: string | undefined): boolean {
  const n = name?.trim() ?? "";
  return n.length === 0 || n === PLACEHOLDER_NAMES.en || n === PLACEHOLDER_NAMES.es;
}
