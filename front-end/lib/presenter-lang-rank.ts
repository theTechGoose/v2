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
}

/** Pure: the presenter's language — REQ-829: a carried ?lang= first; then whoami's impersonator,
 *  the resolved user's when not impersonating; then the cookie; en. */
export function presenterLang(
  who: PresenterWhoAmI | undefined,
  user: PresenterIdentity | undefined,
  carry: PresenterCarry = {},
): Lang {
  const profile = who?.impersonating
    ? asLang(who.impersonator?.language)
    // REQ-631: the signed-in person (an editor while acting), not the account
    : asLang(personLanguage(user));
  return asLang(carry.query) ?? profile ?? asLang(carry.cookie) ?? "en";
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
  });
}

/** REQ-855 — this page's carry, read in the browser: its `?lang=` and the `pm_lang` cookie (what
 *  lib/presenter-lang.ts `presenterCarry` reads from a request). Empty on the server. */
export function pageLangCarry(): PresenterCarry {
  if (typeof document === "undefined" || !globalThis.location) return {};
  try {
    return {
      query: new URLSearchParams(globalThis.location.search).get("lang"),
      cookie: langFromCookie(document.cookie),
    };
  } catch {
    return {};
  }
}
