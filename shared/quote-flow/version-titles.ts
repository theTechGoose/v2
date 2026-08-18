/**
 * Version-card fallback titles (P-24): when the LLM is unavailable the three
 * "choose a version" cards used to share one jobName with the collisions
 * numbered " (2)" / " (3)" — which read like three duplicates of the same
 * job rather than three versions of it. Each variant now carries an honest,
 * localized qualifier describing what it IS (concise → detailed), and the
 * duplicate-name disambiguator cycles the same qualifiers instead of
 * numbering.
 *
 * Bilingual labels live HERE (not in lang/*.json) so the frontend heuristic
 * (AsstChat.tsx localFallbackOptions) and the backend fallback
 * (generate-job-options fallbackOptions/disambiguate) stay in lockstep
 * without new dictionary keys.
 */

export type VersionVariant = "full" | "short" | "wider";

type Lang = "en" | "es";

const QUALIFIERS: Record<Lang, Record<Exclude<VersionVariant, "full">, string>> = {
  en: {
    short: "Short version",
    wider: "Wider scope",
  },
  es: {
    short: "Versión breve",
    wider: "Alcance ampliado",
  },
};

/** The localized qualifier for a non-primary variant. */
export function versionQualifier(
  variant: Exclude<VersionVariant, "full">,
  lang: Lang,
): string {
  return QUALIFIERS[lang][variant];
}

/** Title for one fallback version card: the base jobName, plus an honest
 *  localized qualifier for the non-primary variants — never a "(n)" suffix. */
export function versionTitle(
  baseName: string,
  variant: VersionVariant,
  lang: Lang,
): string {
  if (variant === "full") return baseName;
  return `${baseName} · ${QUALIFIERS[lang][variant]}`;
}

/** Ensure `name` is unique within `seen` (case-insensitive) WITHOUT the old
 *  " (2)" / " (3)" numbering: collisions take the version qualifiers in
 *  order, then a plain " 2"-style round counter as a last resort. Adds the
 *  final name to `seen`. */
export function disambiguateTitle(
  name: string,
  seen: Set<string>,
  lang: Lang,
): string {
  let unique = name;
  const variants: Exclude<VersionVariant, "full">[] = ["short", "wider"];
  for (let i = 0; seen.has(unique.toLowerCase()); i++) {
    const variant = variants[i % variants.length];
    const round = Math.floor(i / variants.length);
    unique = `${name} · ${QUALIFIERS[lang][variant]}${
      round > 0 ? ` ${round + 1}` : ""
    }`;
  }
  seen.add(unique.toLowerCase());
  return unique;
}
