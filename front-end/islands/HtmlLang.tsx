import { useEffect } from "preact/hooks";
import { type Lang, langSignal } from "../lib/lang.ts";

/**
 * Mirrors the active UI language (`langSignal`) into `<html lang>` on the
 * client. Mounted once globally (routes/_app.tsx). SSR sets the initial
 * `lang` attribute from the pm_lang cookie; this keeps it correct after the
 * app resolves the language a different way — e.g. the dashboard seeding
 * `langSignal` from the logged-in user's profile language when there is no
 * pm_lang cookie, or an in-app language toggle. Renders nothing.
 */
export default function HtmlLang({ initial }: { initial?: Lang }) {
  useEffect(() => {
    const apply = (lang: Lang) => {
      if (lang && document.documentElement.lang !== lang) {
        document.documentElement.lang = lang;
      }
    };
    if (initial) apply(initial);
    // Only follow the signal AFTER mount. langSignal carries a module-load
    // DEFAULT ("es") on pages that never seeded it — the public customer
    // documents and the branded 404 — so subscribing to its current value
    // would immediately overwrite the correct server-resolved attribute and
    // relabel an English page as Spanish. A real toggle emits a change and
    // is honored; the default never is.
    let settled = !initial;
    const stop = langSignal.subscribe((lang) => {
      if (!settled) {
        settled = true;
        return;
      }
      apply(lang);
    });
    return () => stop();
  }, [initial]);
  return null;
}
