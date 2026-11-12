import { type Lang, langSignal } from "./lang.ts";

/**
 * REQ-269 (demo i18n-formatting-m2) — the language a server-rendered block shows
 * once it lives in an island: the SSR language (from `user.language`) for the
 * server render and the first client render, so hydration matches the markup;
 * after mount the app language (`langSignal`), so the topbar's EN/ES toggle
 * reaches it without a reload. Reading the signal here subscribes the caller.
 */
export function liveLang(hydrated: boolean, ssrLang: Lang): Lang {
  return hydrated ? langSignal.value : ssrLang;
}
