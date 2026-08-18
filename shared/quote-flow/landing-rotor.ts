/**
 * ES hero rotor (P-16): each rotating word carries its OWN agreeing article
 * instead of a one-size-fits-none "las" baked into the hero prefix.
 *
 * Wiring sites:
 *  - front-end/routes/index.tsx rotor (~:217-235): data-es="cotizaciones." etc.
 *    should become buildRotorPhrase(entry) → "las cotizaciones."
 *  - front-end/static/landing-scripts.js ES dict "hero.h1b": the prefix
 *    "Nosotros manejamos las" must lose its article — each word brings its own.
 */

export interface RotorEntry {
  article: "el" | "la" | "los" | "las";
  word: string;
}

/** One entry per real rotor word, in the order the hero cycles them. */
export const ES_ROTOR: readonly RotorEntry[] = [
  { article: "las", word: "cotizaciones" },
  { article: "los", word: "contratos" },
  { article: "las", word: "facturas" },
  { article: "el", word: "papeleo" },
];

/** The full rotor phrase for one entry — "los contratos." */
export function buildRotorPhrase(entry: RotorEntry): string {
  return `${entry.article} ${entry.word}.`;
}
