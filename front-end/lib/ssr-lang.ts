/**
 * REQ-231 — the language the SERVER renders islands in, per request.
 *
 * `langSignal` (lib/lang.ts) is one module-level signal. In the browser that is
 * right (one user per tab); on the server it is shared by every request and was
 * never set, so every island that reads `t()` / `langSignal.value` rendered in
 * the Spanish-first default — an English user's page read Spanish until its
 * islands hydrated (demo stage-content-m2: ~20 s on the stage's replica frame,
 * ES pressed, "Cargando…"), and the assistant composer's placeholder came out
 * "Ej: El cliente quiere una losa…" (demo quote-invoice-money-m11).
 *
 * Here, on the server only, `langSignal.value` reads the CURRENT request's
 * language through an AsyncLocalStorage the root middleware opens around every
 * request — concurrent requests never see each other's language, whatever they
 * await. The app shell hands the same language to the browser
 * (`window.__PM_LANG`) so hydration starts from what the server painted.
 *
 * Server-only: imports node:async_hooks — never import it from an island or a
 * module an island imports (lib/lang.ts stays browser-safe).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { type Lang, langFromCookie, langSignal } from "./lang.ts";

/** What a request offers to decide its language (a Fresh ctx fits). */
export interface SsrLangSource {
  url: URL;
  req: Request;
  state: { lang?: Lang; user?: { language?: string } };
}

const asLang = (v: unknown): Lang | null => v === "en" || v === "es" ? v : null;

/**
 * The language a request's islands render in, or null when the request says
 * nothing (the caller falls back to the Spanish-first default). Order:
 *  1. ctx.state.lang — a page that resolved its own language (REQ-122 public
 *     pages),
 *  2. ?lang= — an explicit link,
 *  3. the signed-in user's own language — what the app switches to anyway the
 *     moment the dashboard cache loads the profile (lib/dash-cache.ts), and
 *     what must win over a pm_lang cookie another window on this origin left
 *     (the staff's own pages, around a demo's replica frame),
 *  4. the pm_lang cookie — the visitor's persisted choice.
 */
export function resolveSsrLang(src: SsrLangSource): Lang | null {
  return asLang(src.state?.lang) ??
    asLang(src.url.searchParams.get("lang")) ??
    asLang(src.state?.user?.language) ??
    langFromCookie(src.req.headers.get("cookie"));
}

const store = new AsyncLocalStorage<SsrLangSource>();

/** Server-side `langSignal.value`: the current request's language, the
 *  Spanish-first default inside a request that names none, and the signal's
 *  own value outside any request. Writes go to the signal as before. */
function installServerLang(): void {
  const proto = Object.getPrototypeOf(langSignal);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (!desc?.get || !desc.set) return;
  const get = desc.get, set = desc.set;
  Object.defineProperty(langSignal, "value", {
    configurable: true,
    enumerable: false,
    get(this: typeof langSignal) {
      const src = store.getStore();
      return src ? resolveSsrLang(src) ?? "es" : get.call(this);
    },
    set(this: typeof langSignal, v: Lang) {
      set.call(this, v);
    },
  });
}
if (typeof document === "undefined") installServerLang();

/** Run `fn` as one request: every `langSignal.value` / `t()` read inside it,
 *  across awaits, resolves from `src`. */
export function withRequestLang<T>(src: SsrLangSource, fn: () => T): T {
  return store.run(src, fn);
}

/** Root middleware (main.ts): opens the request's language scope. The source
 *  is the live ctx, so a user a route middleware loads later still counts. */
export function ssrLangMiddleware(
  ctx: SsrLangSource & { next(): Promise<Response> },
): Promise<Response> {
  return withRequestLang(ctx, () => ctx.next());
}

/** The boot-script line that hands the server's language to the browser's
 *  module-load seed (lib/lang.ts pickClientLang); empty when there is none. */
export function bootLangScript(lang: Lang | null): string {
  return lang ? `window.__PM_LANG=${JSON.stringify(lang)};` : "";
}
