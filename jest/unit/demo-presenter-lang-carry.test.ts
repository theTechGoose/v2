/**
 * REQ-829 — demo-loop cycle dm2, issue m7: "Stage and /admin after End are Spanish although the
 * presenter used /admin in English (pm_lang=en cookie ignored)". The staff profile was es; the
 * English on /admin came from ?lang=en (REQ-592: page-scoped). The Demo button's hop to the stage,
 * the lock banner's Back to the demo, the /admin guide gate's Back to the demo, End's handover and
 * Leave all dropped the language, and the stage ranked the profile above everything. The
 * presenter's LIVE language now rides every hop as ?lang=, and the stage honors it first.
 */
import * as fs from "fs";
import * as path from "path";
import { presenterLang } from "../../front-end/lib/presenter-lang";
import {
  endedHref,
  readEndedNotice,
  stageHref,
  withLang,
} from "../../shared/demo-mode/ended";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-829 presenterLang ranks the carried ?lang= first, the cookie last", () => {
  const staffEs = { authenticated: true, impersonating: true, impersonator: { id: "s", language: "es" } };
  const cust = { id: "c", language: "es" };

  test("REQ-829 ?lang=en beats an es impersonator profile and an es cookie", () => {
    expect(presenterLang(staffEs, cust, { query: "en", cookie: "es" })).toBe("en");
  });
  test("REQ-829 no ?lang=: the impersonator's profile beats the cookie", () => {
    expect(presenterLang(staffEs, cust, { cookie: "en" })).toBe("es");
  });
  test("REQ-829 an impersonator without a language: the cookie, never the customer's", () => {
    expect(
      presenterLang({ authenticated: true, impersonating: true, impersonator: { id: "s" } }, cust, { cookie: "en" }),
    ).toBe("en");
  });
  test("REQ-829 a junk ?lang= is ignored", () => {
    expect(presenterLang(staffEs, cust, { query: "xx" })).toBe("es");
  });
});

describe("REQ-829 the demo's hops carry the language", () => {
  test("REQ-829 stageHref / withLang append ?lang= (or &lang=), and nothing for no language", () => {
    expect(stageHref("en")).toBe("/demo/stage?lang=en");
    expect(stageHref("es")).toBe("/demo/stage?lang=es");
    expect(stageHref(undefined)).toBe("/demo/stage");
    expect(withLang("/admin", "en")).toBe("/admin?lang=en");
    expect(withLang("/admin?demo=ended", "es")).toBe("/admin?demo=ended&lang=es");
  });

  test("REQ-829 endedHref(notice, lang) carries lang=, and readEndedNotice leaves it in the address", () => {
    const href = endedHref({ by: "you" }, "en");
    const url = new URL(href, "https://documonster.test");
    expect(url.pathname).toBe("/admin");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(readEndedNotice(url.search)).toEqual({ notice: { by: "you" }, rest: "?lang=en" });
    expect(endedHref({ by: "you" })).toBe("/admin?demo=ended&by=you");
  });

  // REQ-855 (dm3, m6) AMENDMENT — the PRESENTER's language: on /admin (the presenter's own session)
  // that is still the page's live language; on a customer's page (impersonating) it is whoami's
  // impersonator's, never the page's langSignal (hers) — presenterChromeLang
  test("REQ-829 the row Demo button's hop (DemoModeOverlay placePresenter) goes to stageHref(<the presenter's language>) — REQ-855", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toMatch(/location\.assign\(stageHref\(presenterLangFor\(who\)\)\)/);
    expect(src).toMatch(/presenterChromeLang\(\{ who, live: langSignal\.value, \.\.\.pageLangCarry\(\) \}\)/);
    expect(src).not.toMatch(/location\.assign\(STAGE_PATH\)/);
  });

  test("REQ-829 the lock banner's Back to the demo (AdminPage) goes to stageHref(langSignal.value)", () => {
    const src = read("front-end/islands/AdminPage.tsx");
    expect(src).toMatch(/location\.assign\(stageHref\(langSignal\.value\)\)/);
    expect(src).not.toMatch(/location\.assign\(STAGE_PATH\)/);
  });

  test("REQ-829 the /admin guide gate's Back to the demo links stageHref(lang)", () => {
    const src = read("front-end/components/AdminGuideGate.tsx");
    expect(src).toMatch(/href=\{stageHref\(lang\)\}/);
    expect(src).not.toMatch(/href="\/demo\/stage"/);
  });

  test("REQ-829 the gate's language reads the request's ?lang= and cookie", () => {
    const src = read("front-end/lib/admin-gate.ts");
    expect(src).toMatch(/presenterCarry\(req\)/);
  });

  test("REQ-829 the stage's End handover and Leave carry the stage's language back to /admin", () => {
    const src = read("front-end/islands/DemoStage.tsx");
    expect(src).toMatch(/location\.href = endedHref\(notice, langSignal\.value\)/);
    expect(src).toMatch(/location\.href = withLang\("\/admin", langSignal\.value\)/);
    expect(src).not.toMatch(/location\.href = "\/admin"/);
  });

  test("REQ-829 the /demo middleware hands the request to presenterLangForRequest (which reads ?lang= and pm_lang)", () => {
    const src = read("front-end/lib/presenter-lang.ts");
    expect(src).toMatch(/presenterCarry\(req\)/);
    expect(src).toMatch(/searchParams\.get\("lang"\)/);
    expect(src).toMatch(/langFromCookie/);
  });
});
