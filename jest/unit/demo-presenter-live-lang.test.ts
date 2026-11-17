/**
 * REQ-863 — demo-loop cycle dm4, issue p5: "Presenter's demo pill on his other pages opens in the
 * customer's language (ES) while the stage is EN". REQ-829 gives an es-profile presenter on
 * /admin?lang=en an English stage (the ?lang= rides every hop), but a FRESH second tab of his
 * (/dashboard, no ?lang=) ranked whoami's impersonator.language — his es PROFILE — so the pill read
 * "Modo demo · Guiando a Maria Lopez" and /admin's guide gate read Spanish while the stage was
 * English. The demo's live presenter language is now recorded per browser (the `pm_demo_lang`
 * cookie: written by the stage's ?lang=, the pill's EN | ES switch and the gate's) and ranked right
 * after an explicit ?lang= and before the profile, while impersonating.
 */
import * as fs from "fs";
import * as path from "path";
import {
  DEMO_LANG_COOKIE,
  demoLangCookie,
  demoLangFromCookie,
  presenterChromeLang,
  presenterLang,
} from "../../front-end/lib/presenter-lang-rank.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const acting = (language?: string) => ({
  authenticated: true,
  impersonating: true,
  impersonator: { id: "s1", ...(language ? { language } : {}) },
});

describe("REQ-863 (dm4 p5) the demo's live presenter language outranks the profile", () => {
  test("REQ-863 p5: an es-profile presenter whose stage is en gets an en pill on a fresh tab (no ?lang=)", () => {
    expect(presenterChromeLang({ who: acting("es"), live: "es", demo: "en" }))
      .toBe("en");
    expect(presenterChromeLang({ who: acting("en"), live: "en", demo: "es" }))
      .toBe("es");
  });

  test("REQ-863 p5: ranking — an explicit ?lang= first, then the demo's language, then the profile, then pm_lang, then en", () => {
    expect(presenterLang(acting("es"), undefined, { query: "es", demo: "en" }))
      .toBe("es");
    expect(presenterLang(acting("es"), undefined, { demo: "en", cookie: "es" }))
      .toBe("en");
    expect(presenterLang(acting("es"), undefined, { demo: "xx" })).toBe("es");
    expect(presenterLang(acting(), undefined, { demo: null, cookie: "es" }))
      .toBe("es");
    expect(presenterLang(acting(), undefined, {})).toBe("en");
  });

  test("REQ-863 p5: the demo's language counts only while impersonating — the presenter's own session keeps REQ-829's ranking", () => {
    const own = { authenticated: true, impersonating: false };
    expect(presenterLang(own, { language: "es" }, { demo: "en" })).toBe("es");
    expect(presenterChromeLang({ who: own, live: "es", demo: "en" })).toBe(
      "es",
    );
  });

  test("REQ-863 p5: the pm_demo_lang cookie reads and writes", () => {
    expect(DEMO_LANG_COOKIE).toBe("pm_demo_lang");
    expect(demoLangFromCookie("pm_session=s; pm_demo_lang=en")).toBe("en");
    expect(demoLangFromCookie("pm_demo_lang=es, pm_lang=en")).toBe("es");
    expect(demoLangFromCookie("pm_lang=en")).toBeNull();
    expect(demoLangFromCookie("pm_demo_lang=xx")).toBeNull();
    expect(demoLangFromCookie(undefined)).toBeNull();
    const c = demoLangCookie("en");
    expect(c).toMatch(/^pm_demo_lang=en;/);
    expect(c).toMatch(/path=\//i);
    expect(c).toMatch(/samesite=lax/i);
  });
});

describe("REQ-863 (dm4 p5) wiring: who writes the demo's language and who reads it", () => {
  test("REQ-863 p5: the browser carry (pageLangCarry) and the request carry (presenterCarry) read pm_demo_lang", () => {
    const rank = read("front-end/lib/presenter-lang-rank.ts");
    expect(rank).toMatch(
      /export function pageLangCarry[\s\S]*?demo:\s*demoLangFromCookie\(document\.cookie\)/,
    );
    expect(read("front-end/lib/presenter-lang.ts")).toMatch(
      /demo:\s*demoLangFromCookie\(req\.headers\.get\("cookie"\)\)/,
    );
  });

  test("REQ-863 p5: the stage (/demo middleware) and /admin's guide gate record an explicit ?lang= as the demo's language", () => {
    expect(read("front-end/routes/demo/_middleware.ts")).toMatch(
      /recordDemoLang\(/,
    );
    expect(read("front-end/routes/admin/_middleware.ts")).toMatch(
      /recordDemoLang\(/,
    );
  });

  test("REQ-863 p5: the presenter pill's EN | ES switch records the demo's language too", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(
      /onClick=\{\(\) => \{\s*persistLang\(l\);\s*persistDemoLang\(l\);/,
    );
  });
});
