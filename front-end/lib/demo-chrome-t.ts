/**
 * REQ-494 (demo-loop cycle 3, M43) — the demo chrome speaks the viewer's
 * language. On /worker the page runs in a signed-in worker's language for the
 * session (REQ-285/416); the pill keeps the viewer's stored choice there
 * (demoChromeLang). Reads langSignal, so a toggle still re-renders it.
 *
 * REQ-544 (cycle 4, m49) — shared, so the overlay hands this same t to the
 * pill's children (EndDemo, PresenterChips) instead of them reading the
 * global t, which follows the worker's language on /worker.
 */
import { langSignal, tFor, type Vars } from "./i18n.ts";
import { demoChromeLang, storedLang } from "./lang.ts";

export function demoChromeT(key: string, vars?: Vars): string {
  const lang = demoChromeLang({
    path: globalThis.location?.pathname ?? "",
    live: langSignal.value,
    stored: storedLang(),
  });
  return tFor(lang, key, vars);
}
