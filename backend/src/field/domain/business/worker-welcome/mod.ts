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
