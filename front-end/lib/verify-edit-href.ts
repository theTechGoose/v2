/**
 * REQ-351 (demo cycle 1, p15-12) — where /verify's "Wrong number? Edit" link goes.
 *
 * Every page that sends a sign-in code and hands off to /verify names itself
 * with `?from=<origin>`; the link returns to that page's phone form. The map is
 * an allow-list — the query value is never reflected as a URL. A missing or
 * unknown origin goes to /login, the app's own phone form (never "/", the
 * marketing page, which has no "Edit your number" context).
 */
export const VERIFY_EDIT_HREFS = {
  /** /login — LoginForm */
  login: "/login",
  /** "/" — the home page's contact form (static/landing-scripts.js) */
  home: "/#contact",
  /** /landing — the trial form (TrialSignup) */
  landing: "/landing#trial",
  /** /landing2 — the signup card (Landing2Signup, recoverable-account hand-off) */
  landing2: "/landing2",
} as const;

export type VerifyOrigin = keyof typeof VERIFY_EDIT_HREFS;

/** Where Edit goes when the origin is missing or not on the list. */
export const DEFAULT_VERIFY_EDIT_HREF = VERIFY_EDIT_HREFS.login;

export function verifyEditHref(from: string | null | undefined): string {
  if (from && Object.hasOwn(VERIFY_EDIT_HREFS, from)) {
    return VERIFY_EDIT_HREFS[from as VerifyOrigin];
  }
  return DEFAULT_VERIFY_EDIT_HREF;
}
