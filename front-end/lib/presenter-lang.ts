/**
 * REQ-341 (demo-loop cycle 1, issue M10) — the language of the PERSON at the keyboard, for the demo
 * stage. Under impersonation the request's resolved user (/me, `ctx.state.user`) is the CUSTOMER —
 * the staff survives only as the session's `impersonatorId` — so a stage seeded from
 * `user.language` flipped to Spanish once the customer picked ES on their own topbar. The stage
 * asks GET /admin/whoami (in process, like /welcome's pixel read) and takes
 * `impersonator.language`; a plain session, a failed whoami or a missing cookie fall back to the
 * resolved user's language (en when unset).
 */
import type { Lang } from "./i18n.ts";
import { getSessionId } from "./auth.ts";
import { ssrBackendGetAuthed } from "./backend-fetch.ts";

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

/** Pure: the presenter's language from a whoami answer, the resolved user's otherwise. */
export function presenterLang(
  who: PresenterWhoAmI | undefined,
  user: PresenterIdentity | undefined,
): Lang {
  const presenter = who?.impersonating
    ? asLang(who.impersonator?.language)
    : undefined;
  return presenter ?? asLang(user?.language) ?? "en";
}

/** The request's presenter language: whoami with the request's session, then `presenterLang`. */
export async function presenterLangForRequest(
  req: Request,
  user: PresenterIdentity | undefined,
): Promise<Lang> {
  const sessionId = getSessionId(req);
  if (!sessionId) return presenterLang(undefined, user);
  try {
    const res = await ssrBackendGetAuthed<PresenterWhoAmI>(
      "/admin/whoami",
      sessionId,
    );
    return presenterLang(res.ok ? res.data : undefined, user);
  } catch {
    return presenterLang(undefined, user);
  }
}
