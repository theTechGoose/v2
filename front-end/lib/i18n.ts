/**
 * i18n lookup — single entry point for UI strings.
 *
 * Strings live in /lang/en.json + /lang/es.json (shared with the backend).
 * `t(key, vars?)` reads the current language from `langSignal` (so islands
 * that call it re-render on toggle) and falls back to EN, then to the raw
 * key, when a translation is missing. Use `tFor(lang, …)` from SSR/routes
 * where the language is already resolved (e.g. from `user.language`).
 *
 * Placeholders use `{name}` and are filled from `vars`:
 *   t("invoices.overdueCount", { n: 3 })  // "3 overdue"
 */
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };
import { type Lang, langSignal } from "./lang.ts";

export { type Lang, langSignal };

type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = { en: en as Dict, es: es as Dict };

export type Vars = Record<string, string | number>;

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Resolve a key in an explicit language (SSR / known-lang call sites). */
export function tFor(lang: Lang, key: string, vars?: Vars): string {
  const v = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  return interpolate(v, vars);
}

/** Resolve a key in the current UI language (reactive via langSignal). */
export function t(key: string, vars?: Vars): string {
  return tFor(langSignal.value, key, vars);
}

/**
 * Set the active UI language. This is the single switch for the logged-in app:
 * Settings calls it for an instant change, and the dashboard profile cache calls
 * it to seed from the server's `user.language`. Every island that reads
 * `langSignal` (via `t()` or `langSignal.value`) re-renders in response.
 */
export function setLang(lang: Lang): void {
  if (langSignal.value !== lang) langSignal.value = lang;
}

/** Plural helper: picks `<key>.one` / `<key>.other` by count. */
export function tn(key: string, n: number, vars?: Vars): string {
  return t(`${key}.${n === 1 ? "one" : "other"}`, { n, ...vars });
}
