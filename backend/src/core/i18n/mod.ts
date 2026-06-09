/**
 * Backend i18n lookup — shares /lang/en.json + /lang/es.json with the frontend.
 *
 * Customer-facing comms (SMS, email, PDFs, notifications) and assistant copy
 * resolve strings here, keyed by the recipient's language (the contractor's
 * `user.language`, or `commsLanguage` for outgoing customer documents).
 *
 *   t("es", "sms.quoteReady", { jobName, url })
 *
 * Falls back to EN, then to the raw key, when a translation is missing.
 * Placeholders use `{name}` and are filled from `vars`.
 */
import en from "../../../../lang/en.json" with { type: "json" };
import es from "../../../../lang/es.json" with { type: "json" };

export type Lang = "en" | "es";

type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = { en: en as Dict, es: es as Dict };

export type Vars = Record<string, string | number>;

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Resolve a key in the given language, EN fallback, then raw key. */
export function t(lang: Lang, key: string, vars?: Vars): string {
  const v = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  return interpolate(v, vars);
}

/** Plural helper: picks `<key>.one` / `<key>.other` by count. */
export function tn(lang: Lang, key: string, n: number, vars?: Vars): string {
  return t(lang, `${key}.${n === 1 ? "one" : "other"}`, { n, ...vars });
}
