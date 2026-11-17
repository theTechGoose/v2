import { useEffect, useState } from "preact/hooks";
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

/**
 * REQ-367 (demo-loop cycle 1, m10) — calls `fn` with every CHANGE of the app
 * language from now on, never with the value the signal holds when it
 * subscribes: on a page that never seeded `langSignal` (a public document, the
 * branded 404) that value is the module-load default, not anybody's choice, and
 * following it would relabel an English page as Spanish (HtmlLang's rule). A
 * real switch — the topbar, the settings select, the onboarding wizard, the
 * contract's EN | ES — writes the signal and is followed. Returns the
 * unsubscribe.
 */
export function onLangChange(fn: (lang: Lang) => void): () => void {
  let first = true;
  return langSignal.subscribe((lang) => {
    if (first) {
      first = false;
      return;
    }
    fn(lang);
  });
}

/**
 * REQ-367 — the language a block the server painted shows in an island: the
 * SSR language for the server render and the first client render (hydration
 * matches the markup), then every switch after it (`onLangChange`).
 */
export function useLiveLang(ssrLang: Lang): Lang {
  const [lang, setLang] = useState<Lang>(ssrLang);
  useEffect(() => onLangChange(setLang), []);
  return lang;
}
