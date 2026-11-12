import { type Lang, t } from "@core/i18n/mod.ts";

/**
 * REQ-151 — the text a new worker gets: who added them, where to sign in (the /worker address),
 * their PIN; in the owner's language. One segment.
 */
export function workerWelcome(
  lang: Lang,
  v: { owner: string; url: string; pin: string },
): string {
  return t(lang, "sms.workerWelcome", v);
}

/** REQ-155 — the language a worker is texted in: their own, else the owner's, else English */
export function workerLang(
  worker: { language?: string },
  owner: { language?: string },
): Lang {
  const w = worker.language;
  if (w === "en" || w === "es") return w;
  return owner.language === "es" ? "es" : "en";
}

/** REQ-285 — the /worker address a worker is sent: it carries their language, so the screen opens in it */
export function workerSignInUrl(base: string, lang: Lang): string {
  return `${base}/worker?lang=${lang}`;
}

/** REQ-155 — a language off a request body: "en" | "es", undefined when absent, null when something else */
export function parseLang(raw: unknown): Lang | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return raw === "en" || raw === "es" ? raw : null;
}
