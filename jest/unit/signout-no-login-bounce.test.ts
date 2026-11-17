/**
 * REQ-907 — signing out lands on the landing page, never on /login?next=…
 *
 * Found by the REQ-834 story (red since cycle dm2) and a throwaway probe (2026-11-16): the
 * sidebar's Log out fires `pm:logout`, awaits POST /api/auth/logout and sets location to "/".
 * A page in a demo has a held `GET /api/demo-mode/active?wait=` in flight; the backend answers it
 * 401 the moment the session dies — and client.ts's global fetch patch (every 401 from /api/* on
 * an authed route → `/login?next=<here>`) navigated the tab to /login?next=/dashboard 9 ms after
 * the sidebar's own navigation to "/" began, replacing it. Any island's poll can lose that race.
 *
 * Now: once `pm:logout` has fired in a tab, the patch bounces nothing — the sign-out owns the
 * navigation (`bounceToLogin`, lib/signout-bounce.ts, says no while `signingOut`); a 401 before
 * any sign-out bounces as before (an expired session).
 */
import * as fs from "fs";
import * as path from "path";
import { bounceToLogin } from "../../front-end/lib/signout-bounce";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-907 — a 401 during the sign-out never bounces the tab to /login", () => {
  test("REQ-907 bounceToLogin: an expired session's 401 on an authed route bounces; after pm:logout it does not", () => {
    const base = { status: 401, api: true, authed: true, signingOut: false };
    expect(bounceToLogin(base)).toBe(true);
    expect(bounceToLogin({ ...base, signingOut: true })).toBe(false);
    // the old scope is unchanged
    expect(bounceToLogin({ ...base, status: 200 })).toBe(false);
    expect(bounceToLogin({ ...base, api: false })).toBe(false);
    expect(bounceToLogin({ ...base, authed: false })).toBe(false);
  });

  test("REQ-907 wiring: client.ts hears pm:logout and asks bounceToLogin with it", () => {
    const client = read("front-end/client.ts");
    expect(client).toMatch(
      /addEventListener\("pm:logout", \(\) => \{\s*signingOut = true;/,
    );
    expect(client).toMatch(/bounceToLogin\(\{[\s\S]{0,200}signingOut,?\s*\}\)/);
    expect(client).not.toMatch(/res\.status === 401 && isApiRequest\(input\) &&/);
  });
});
