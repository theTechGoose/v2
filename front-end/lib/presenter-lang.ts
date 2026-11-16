/**
 * REQ-341 (demo-loop cycle 1, issue M10) — the language of the PERSON at the keyboard, for the demo
 * stage. Under impersonation the request's resolved user (/me, `ctx.state.user`) is the CUSTOMER —
 * the staff survives only as the session's `impersonatorId` — so a stage seeded from
 * `user.language` flipped to Spanish once the customer picked ES on their own topbar. The stage
 * asks GET /admin/whoami (in process, like /welcome's pixel read) and takes
 * `impersonator.language`; a plain session, a failed whoami or a missing cookie fall back to the
 * resolved user's language (en when unset).
 *
 * REQ-829 (demo-loop cycle dm2, issue m7) — the presenter's LIVE language outranks the profile: an
 * es-profile staff member working on /admin?lang=en (REQ-592: page-scoped, never persisted) opens
 * the stage at /demo/stage?lang=en (every hop carries it: shared/demo-mode/ended.ts `stageHref`).
 * Order: an explicit ?lang= → the impersonator's profile → (not impersonating) the person's own →
 * the pm_lang cookie → en. Under impersonation the resolved user is the CUSTOMER, so it is never
 * the fallback there (the cookie is the presenter's browser's).
 */
import type { Lang } from "./i18n.ts";
import { getSessionId } from "./auth.ts";
import { ssrBackendGetAuthed } from "./backend-fetch.ts";
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

/** REQ-829 — the request's `?lang=` and `pm_lang` cookie */
export function presenterCarry(req: Request): PresenterCarry {
  return {
    query: new URL(req.url).searchParams.get("lang"),
    cookie: langFromCookie(req.headers.get("cookie")),
  };
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

/** The request's presenter language: whoami with the request's session, then `presenterLang`. */
export async function presenterLangForRequest(
  req: Request,
  user: PresenterIdentity | undefined,
): Promise<Lang> {
  const carry = presenterCarry(req);
  const sessionId = getSessionId(req);
  if (!sessionId) return presenterLang(undefined, user, carry);
  try {
    const res = await ssrBackendGetAuthed<PresenterWhoAmI>(
      "/admin/whoami",
      sessionId,
    );
    return presenterLang(res.ok ? res.data : undefined, user, carry);
  } catch {
    return presenterLang(undefined, user, carry);
  }
}
