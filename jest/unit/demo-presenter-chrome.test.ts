/**
 * REQ-855 — demo-loop cycle dm3, issues m5 + m6 + rc-17. While a staff member guides a customer,
 * the presenter's own chrome on a page that is not the stage is the PRESENTER's:
 *
 *   - m6: the overlay's presenter pill ("Demo mode · Guiding {name} · Back to the demo") read the
 *     page's langSignal, which under impersonation is the CUSTOMER's language — fleet-0 saw an
 *     English bar next to "Modo demo Guiando a Maria Lopez | Volver a la demo" — and its Back to
 *     the demo went to stageHref(langSignal.value), carrying the customer's ?lang= into the stage
 *     (rc-17: a Spanish stage, End → /admin?lang=es).
 *   - m5: the red "Impersonating … Return to your account" bar was drawn next to that pill (and
 *     over /admin's guide gate) because it decided by path only; and no EN/ES control was left to
 *     the staff while guiding.
 */
import * as fs from "fs";
import * as path from "path";
import { presenterChromeLang } from "../../front-end/lib/presenter-lang-rank.ts";
import {
  adminGateShown,
  impersonationBarShown,
} from "../../shared/demo-mode/stage-chrome.ts";
import { STAGE_PATH } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** a staff member acting as a customer: whoami's shape (REQ-341: the impersonator's language) */
const acting = (language?: string) => ({
  authenticated: true,
  impersonating: true,
  impersonator: { id: "s1", ...(language ? { language } : {}) },
});

describe("REQ-855 (m6) the presenter's chrome speaks the presenter's language", () => {
  test("REQ-855 m6: on a customer page whose language is es, an en impersonator's chrome is en", () => {
    expect(presenterChromeLang({ who: acting("en"), live: "es" })).toBe("en");
    expect(presenterChromeLang({ who: acting("es"), live: "en" })).toBe("es");
  });

  test("REQ-855 m6: the presenter's own page (not impersonating — /admin, where Demo is pressed) keeps its live language (REQ-829)", () => {
    const own = {
      authenticated: true,
      impersonating: false,
      impersonator: null,
    };
    expect(presenterChromeLang({ who: own, live: "en", cookie: "es" })).toBe(
      "en",
    );
    expect(presenterChromeLang({ who: own, live: "es", query: "en" })).toBe(
      "es",
    );
  });

  test("REQ-855 m5: an explicit ?lang= on the page (the presenter's EN | ES switch) beats the profile", () => {
    expect(presenterChromeLang({ who: acting("es"), live: "es", query: "en" }))
      .toBe("en");
    expect(presenterChromeLang({ who: acting("en"), live: "en", query: "es" }))
      .toBe("es");
    // junk is ignored
    expect(presenterChromeLang({ who: acting("en"), live: "es", query: "xx" }))
      .toBe("en");
  });

  test("REQ-855 m6: an impersonator with no language → the pm_lang cookie, then en — never the customer page's language", () => {
    expect(presenterChromeLang({ who: acting(), live: "es" })).toBe("en");
    expect(presenterChromeLang({ who: acting(), live: "es", cookie: "en" }))
      .toBe("en");
    expect(presenterChromeLang({ who: acting(), live: "en", cookie: "es" }))
      .toBe("es");
  });

  test("REQ-855: whoami not known yet (or failed) → the live language", () => {
    expect(presenterChromeLang({ who: undefined, live: "es" })).toBe("es");
    expect(presenterChromeLang({ who: null, live: "en" })).toBe("en");
  });
});

describe("REQ-855 (m5) one notice: the red bar is not drawn beside the presenter's pill nor over /admin's gate", () => {
  const plain = { impersonating: true, superAdmin: false, presenting: false };

  test("REQ-855 m5: while this staff presents the demo, no bar on any page", () => {
    for (
      const p of ["/welcome", "/dashboard", "/quotes/1", "/admin", STAGE_PATH]
    ) {
      expect(impersonationBarShown({ ...plain, path: p, presenting: true }))
        .toBe(false);
    }
  });

  test("REQ-855 m5: a plain impersonation keeps its bar on the customer's pages (REQ-181 / REQ-723)", () => {
    for (const p of ["/welcome", "/dashboard", "/quotes/1", "/", "/demo"]) {
      expect(impersonationBarShown({ ...plain, path: p })).toBe(true);
    }
  });

  test("REQ-855 m5: never on the stage (REQ-537), never without an impersonation", () => {
    expect(impersonationBarShown({ ...plain, path: STAGE_PATH })).toBe(false);
    expect(impersonationBarShown({ ...plain, path: `${STAGE_PATH}/` })).toBe(
      false,
    );
    expect(
      impersonationBarShown({
        ...plain,
        path: "/dashboard",
        impersonating: false,
      }),
    ).toBe(false);
  });

  test("REQ-855 m5: not over /admin's guide gate (an impersonated non-super-admin), which has its own exits; a super admin's console keeps it", () => {
    expect(impersonationBarShown({ ...plain, path: "/admin" })).toBe(false);
    expect(impersonationBarShown({ ...plain, path: "/admin/" })).toBe(false);
    expect(impersonationBarShown({ ...plain, path: "/admin/users" })).toBe(
      false,
    );
    expect(
      impersonationBarShown({ ...plain, path: "/admin", superAdmin: true }),
    ).toBe(true);
    expect(impersonationBarShown({ ...plain, path: "/administrator" })).toBe(
      true,
    );
  });

  test("REQ-855 m5: adminGateShown is the /admin middleware's rule — an impersonated non-super-admin on /admin*", () => {
    const acting = { impersonating: true, superAdmin: false };
    expect(adminGateShown({ ...acting, path: "/admin" })).toBe(true);
    expect(adminGateShown({ ...acting, path: "/admin/users" })).toBe(true);
    expect(adminGateShown({ ...acting, path: "/welcome" })).toBe(false);
    expect(adminGateShown({ ...acting, path: "/admin", superAdmin: true }))
      .toBe(false);
    expect(adminGateShown({ path: "/admin", impersonating: false })).toBe(
      false,
    );
  });
});

describe("REQ-855 wiring", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");

  test("REQ-855 m6/rc-17: placePresenter's hop carries the presenter's language, not the page's langSignal", () => {
    const place = overlay.slice(
      overlay.indexOf("async function placePresenter("),
      overlay.indexOf(
        "// REQ-393 — where this page's mouse is, for the stage placePresenter",
      ),
    );
    expect(place).toMatch(
      /globalThis\.location\.assign\(stageHref\(presenterLangFor\(who\)\)\)/,
    );
    expect(place).not.toMatch(/stageHref\(langSignal\.value\)/);
    expect(overlay).toMatch(/presenterChromeLang\(\{/);
  });

  test("REQ-855 m6: the presenter pill and Opening… translate with the presenter's t; the customer's pill keeps demoChromeT", () => {
    const presenter = overlay.slice(
      overlay.indexOf('if (demo.role === "presenter") {'),
      overlay.indexOf("yieldsRef.current = !(compact && open)"),
    );
    expect(presenter.length).toBeGreaterThan(100);
    for (const k of ["title", "presenting", "rejoin", "opening"]) {
      expect(presenter).toContain(`pt("demoMode.${k}"`);
    }
    // never the page's (customer's) t in the presenter's branch
    expect(presenter).not.toMatch(/[^p]t\("demoMode\./);
    const opening = overlay.slice(
      overlay.indexOf("if (!demo) {\n    if (!opening) return null;"),
      overlay.indexOf('if (demo.role === "presenter") {'),
    );
    expect(opening.length).toBeGreaterThan(50);
    expect(opening).not.toMatch(/[^p]t\("demoMode\./);
    // the viewer's pill: the chrome t, as before (REQ-494 / REQ-544)
    expect(overlay).toMatch(
      /import \{ demoChromeT as t \} from "\.\.\/lib\/demo-chrome-t\.ts"/,
    );
    expect(overlay).toContain('t("demoMode.guiding", { name: names })');
  });

  test("REQ-855 m5: the presenter pill (impersonating) carries End / Leave and the presenter's EN | ES switch (the same page with ?lang=, persisted)", () => {
    const presenter = overlay.slice(
      overlay.indexOf('if (demo.role === "presenter") {'),
      overlay.indexOf("yieldsRef.current = !(compact && open)"),
    );
    expect(presenter).toMatch(/<EndDemo\b[^>]*\bt=\{pt\}/);
    expect(presenter).toMatch(/stageLeaveShown\(demo\.presenters\.length\)/);
    expect(presenter).toMatch(/data-cy="demo-leave"/);
    expect(presenter).toMatch(/langToggleHref\(/);
    expect(presenter).toMatch(/persistLang\(/);
    expect(presenter).toMatch(/data-cy="demo-lang"/);
    // only where the red bar used to be: not on /admin's guide gate, whose card has both
    expect(presenter).toMatch(/!adminGateShown\(\{/);
    // the way out hands the account back in the presenter's language
    expect(overlay).toMatch(/endedHref\(\{ by: "you" \}, /);
  });

  test("REQ-855 m5: the bar asks /active on mount (once whoami says impersonating) and follows the overlay's presenting event", () => {
    const banner = read("front-end/islands/ImpersonationBanner.tsx");
    const mount = banner.slice(0, banner.indexOf("async function stop("));
    expect(mount).toMatch(/demoModeClient\.active\(/);
    expect(mount).toMatch(/impersonationBarShown\(/);
    expect(mount).toMatch(/DEMO_PRESENTING_EVENT/);
    expect(read("front-end/clients/demo-mode.ts")).toMatch(
      /export const DEMO_PRESENTING_EVENT = "pm:demo-presenting";/,
    );
    expect(overlay).toMatch(/new CustomEvent\(DEMO_PRESENTING_EVENT/);
  });

  test("REQ-855 m5/rc-17: /admin's guide gate has the EN | ES switch, and its Return lands in the gate's language", () => {
    const gate = read("front-end/components/AdminGuideGate.tsx");
    expect(gate).toMatch(/<PublicLangToggle\b/);
    expect(gate).toMatch(/langToggleHref\(url, "en"\)/);
    expect(gate).toMatch(/langToggleHref\(url, "es"\)/);
    expect(read("front-end/routes/admin/_middleware.ts")).toMatch(
      /h\(AdminGuideGate, \{ gate, url: ctx\.req\.url \}\)/,
    );
    expect(read("front-end/islands/AdminGateReturn.tsx")).toMatch(
      /returnToOwnAccount\(demoId, lang\)/,
    );
    expect(read("front-end/lib/return-to-account.ts")).toMatch(
      /location\.href = withLang\(ADMIN_PATH, lang\)/,
    );
  });

  test("REQ-855: en and es carry the switch's label", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.yourLanguage"]).toBe("Your language");
    expect(es["demoMode.yourLanguage"]).toBe("Tu idioma");
  });
});
