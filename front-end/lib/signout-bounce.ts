/**
 * REQ-907 — does a 401 from this origin's /api/* send the tab to /login?next=…?
 *
 * client.ts patches fetch so an expired session (a 401 on an authed app route) lands on /login
 * with the page to come back to. A sign-out is not an expired session: the sidebar fires
 * `pm:logout`, deletes the session and navigates to "/" itself — and a poll still in flight (the
 * demo overlay's held /active ask, a topbar count) comes back 401 in between. That 401 bounced
 * the tab to /login?next=/dashboard 9 ms after the sidebar's own navigation began, replacing it.
 * Once the sign-out has been announced, nothing bounces: the sign-out owns the navigation.
 */
export function bounceToLogin(o: {
  status: number;
  /** a same-origin /api/* request */
  api: boolean;
  /** the tab is on an authed app route (never a public page) */
  authed: boolean;
  /** `pm:logout` has fired in this tab */
  signingOut: boolean;
}): boolean {
  return o.status === 401 && o.api && o.authed && !o.signingOut;
}
