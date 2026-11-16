/**
 * The presenter's language, ranked — pure and client-safe (no server imports), so the /demo
 * middleware (lib/presenter-lang.ts, which re-exports `presenterLang`) and the islands rank alike.
 *
 * REQ-341 / REQ-829 — `presenterLang`: an explicit ?lang= → whoami's impersonator profile → (not
 * impersonating) the person's own → the pm_lang cookie → en; never the impersonated customer's.
 * (Moved here unchanged from lib/presenter-lang.ts by REQ-855.)
 *
 * REQ-855 (demo-loop cycle dm3, issues m6 + rc-17) — `presenterChromeLang`: the language of the
 * PRESENTER's own demo chrome on a page that is not the stage (DemoModeOverlay's presenter pill, its
 * Opening…, the end of a demo it presented, its hop back to the stage). On the presenter's own
 * session (not impersonating: /admin, where Demo is pressed) the page's live language IS the
 * presenter's (REQ-829). Under impersonation the page is the CUSTOMER's — its langSignal is her
 * language (resolveSsrLang → personLanguage(customer)) — so the chrome ranks like the stage does:
 * `presenterLang(who, undefined, carry)`. The pill used the page's langSignal, so an English
 * presenter read "Modo demo · Guiando a Maria Lopez" on a Spanish customer's page, and its Back to
 * the demo carried ?lang=es into the stage.
 */
import type { Lang } from "./i18n.ts";
import { personLanguage } from "../../shared/person-name/mod.ts"; // REQ-631
import { langFromCookie } from "./lang.ts";

export interface PresenterIdentity {
  id?: string;
  language?: string;
}

export interface PresenterWhoAmI {
  authenticated?: boolean;
  impersonating?: boolean;
  impersonator?: PresenterIdentity | null;
}

function asLang(v: unknown): Lang | undefined {
  return v === "es" ? "es" : v === "en" ? "en" : undefined;
}

/** REQ-829 — what the request carries of the presenter's live language */
export interface PresenterCarry {
  /** an explicit `?lang=` on the address */
  query?: string | null;
  /** the browser's persisted `pm_lang` */
  cookie?: string | null;
  /** REQ-863 — the running demo's presenter language (`pm_demo_lang`); counts only while
   *  impersonating */
  demo?: string | null;
}

/** REQ-863 — the per-browser cookie holding the language the presenter runs the demo in */
export const DEMO_LANG_COOKIE = "pm_demo_lang";
/** a demo's day: long enough for any demo, short enough not to outlive it by much */
const DEMO_LANG_MAX_AGE = 12 * 60 * 60;

/** REQ-863 — `pm_demo_lang` from a Cookie header (or document.cookie); null when absent/invalid.
 *  "," separates too (HTTP/2 re-joined cookie fields, like `langFromCookie`). */
export function demoLangFromCookie(
  cookieHeader: string | null | undefined,
): Lang | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|[;,]\s*)pm_demo_lang=(en|es)(?:[;,]|$)/);
  return m ? (m[1] as Lang) : null;
}

/** REQ-863 — the cookie string recording `lang` as the demo's language (Set-Cookie and
 *  document.cookie alike) */
export function demoLangCookie(lang: Lang): string {
  return `${DEMO_LANG_COOKIE}=${lang}; Path=/; Max-Age=${DEMO_LANG_MAX_AGE}; SameSite=Lax`;
}

/** REQ-863 — the presenter picked `lang` for himself (the pill's EN | ES switch): this browser's
 *  demo language. Client-only; a no-op on the server. */
export function persistDemoLang(lang: Lang): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = demoLangCookie(lang);
  } catch { /* noop */ }
}

/** REQ-863 — a request that carries an explicit ?lang= (the stage's hop, the gate's EN | ES
 *  switch) records it as the demo's language on `res`; anything else leaves the cookie alone. */
export function recordDemoLang(req: Request, res: Response): Response {
  const lang = asLang(new URL(req.url).searchParams.get("lang"));
  if (!lang || demoLangFromCookie(req.headers.get("cookie")) === lang) {
    return res;
  }
  try {
    res.headers.append("set-cookie", demoLangCookie(lang));
    return res;
  } catch {
    // immutable headers (a Response.redirect): copy it
    const headers = new Headers(res.headers);
    headers.append("set-cookie", demoLangCookie(lang));
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
}

/** Pure: the presenter's language — REQ-829: a carried ?lang= first; then (REQ-863, impersonating)
 *  the demo's recorded language; then whoami's impersonator, the resolved user's when not
 *  impersonating; then the cookie; en. */
export function presenterLang(
  who: PresenterWhoAmI | undefined,
  user: PresenterIdentity | undefined,
  carry: PresenterCarry = {},
): Lang {
  const profile = who?.impersonating
    ? asLang(who.impersonator?.language)
    // REQ-631: the signed-in person (an editor while acting), not the account
    : asLang(personLanguage(user));
  // REQ-863: the language the presenter runs this demo in outranks his profile
  const demo = who?.impersonating ? asLang(carry.demo) : undefined;
  return asLang(carry.query) ?? demo ?? profile ?? asLang(carry.cookie) ??
    "en";
}

/** REQ-855 — the presenter's own chrome off the stage: the page's live language on the presenter's
 *  own session; under impersonation REQ-829's ranking (?lang= → impersonator → pm_lang → en), never
 *  the customer page's. `who` not known yet (or whoami failed): the live language. */
export function presenterChromeLang(
  src: {
    who: PresenterWhoAmI | null | undefined;
    live: Lang;
  } & PresenterCarry,
): Lang {
  if (!src.who?.impersonating) return src.live;
  return presenterLang(src.who, undefined, {
    query: src.query,
    cookie: src.cookie,
    demo: src.demo,
  });
}

/** REQ-855 — this page's carry, read in the browser: its `?lang=`, the `pm_lang` cookie and
 *  (REQ-863) the demo's `pm_demo_lang` (what lib/presenter-lang.ts `presenterCarry` reads from a
 *  request). Empty on the server. */
export function pageLangCarry(): PresenterCarry {
  if (typeof document === "undefined" || !globalThis.location) return {};
  try {
    return {
      query: new URLSearchParams(globalThis.location.search).get("lang"),
      cookie: langFromCookie(document.cookie),
      demo: demoLangFromCookie(document.cookie),
    };
  } catch {
    return {};
  }
}
