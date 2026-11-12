/**
 * REQ-414 — Raphael, 2026-11-12: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 2, issue p4: "Landing and /login open in
 * Spanish for an English browser; /login has no language switch".
 *
 * The Spanish-first default stays (pickLangFromAcceptLanguage, a product
 * decision). The gap is the sign-in screens: /login and /verify painted no
 * EN | ES control, so a visitor who landed there directly could not switch.
 * Both now resolve their language through the ONE public-page resolver
 * (front-end/lib/page-lang.ts: ?lang= → pm_lang → Spanish), record it on
 * ctx.state.lang for the app shell, persist an explicit ?lang= pick to the
 * pm_lang cookie, and mount the EN | ES toggle (islands/PublicLangToggle.tsx).
 */
import * as fs from "fs";
import * as path from "path";
import { resolvePageLang } from "../../front-end/lib/page-lang";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe("REQ-414 (demo p4, cycle 2) /login and /verify carry an EN | ES switch", () => {
  for (const route of ["front-end/routes/login.tsx", "front-end/routes/verify.tsx"]) {
    describe(route, () => {
      const src = read(route);

      test("REQ-414 mounts the EN | ES toggle with ?lang= links to the same page", () => {
        expect(src).toMatch(/import PublicLangToggle from "\.\.\/islands\/PublicLangToggle\.tsx"/);
        expect(src).toMatch(/<PublicLangToggle/);
        expect(src).toMatch(/langToggleHref\([^)]*"en"\)/);
        expect(src).toMatch(/langToggleHref\([^)]*"es"\)/);
        expect(src).toMatch(/public-lang\.css/);
      });

      test("REQ-414 resolves its language through resolvePageLang and records it for the app shell", () => {
        expect(src).toMatch(/resolvePageLang\(ctx\.req\)/);
        expect(src).toMatch(/ctx\.state\.lang = lang/);
        // the old cookie-only resolve ignored ?lang= (the toggle's own links)
        expect(src).not.toMatch(/langFromCookie\(/);
      });

      test("REQ-414 persists an explicit ?lang= pick to pm_lang", () => {
        expect(src).toMatch(/headers: pickedLangHeaders\(picked\)/);
      });
    });
  }

  test("REQ-414 the one pm_lang writer the public pages and the sign-in screens share", () => {
    const helper = read("front-end/lib/public-page.ts");
    expect(helper).toMatch(/export function pickedLangHeaders/);
    expect(helper).toMatch(/pm_lang=\$\{picked\};path=\/;max-age=31536000;samesite=lax/);
  });

  test("REQ-414 the toggle's link wins over a saved choice; with none, Spanish stays the default for an English browser", () => {
    expect(resolvePageLang(req("http://x/login?lang=en", { cookie: "pm_lang=es" }))).toEqual({ lang: "en", picked: "en" });
    expect(resolvePageLang(req("http://x/login", { "accept-language": "en-US,en;q=0.9" }))).toEqual({ lang: "es", picked: null });
    expect(resolvePageLang(req("http://x/verify?phone=%2B15125550100", { cookie: "pm_lang=en" }))).toEqual({ lang: "en", picked: null });
  });
});
