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
import { langFromCookie } from "./lang.ts";
// REQ-855 — the pure ranking lives in a client-safe module (the overlay ranks with it too)
import {
  type PresenterCarry,
  type PresenterIdentity,
  presenterLang,
  type PresenterWhoAmI,
} from "./presenter-lang-rank.ts";

export {
  type PresenterCarry,
  type PresenterIdentity,
  presenterLang,
  type PresenterWhoAmI,
};

/** REQ-829 — the request's `?lang=` and `pm_lang` cookie */
export function presenterCarry(req: Request): PresenterCarry {
  return {
    query: new URL(req.url).searchParams.get("lang"),
    cookie: langFromCookie(req.headers.get("cookie")),
  };
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
