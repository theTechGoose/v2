/**
 * REQ-272 (2026-11-11), Raphael: "fix every issue the demo found" — demo
 * issue i18n-formatting-m7: "Public invoice /i/ has no EN/ES switch; the
 * quote page has one".
 *
 * Root cause (RCA, fb6d4fa): REQ-048 gave only /q an EN | ES toggle and a
 * ?lang= input. /i resolved its language from pm_lang → the contractor's
 * comms language → Accept-Language, never read ?lang=, and rendered no
 * toggle. These cases pin the shared precedence and the /i wiring.
 */
import * as fs from "fs";
import * as path from "path";
import {
  langToggleHref,
  resolvePublicLang,
} from "../../shared/quote-flow/public-lang";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-272 resolvePublicLang — ?lang= is the visitor's explicit pick", () => {
  it("REQ-272 ?lang=en beats the pm_lang cookie, the doc language and the header", () => {
    expect(
      resolvePublicLang({
        query: "en",
        cookie: "pm_lang=es",
        docLang: "es",
        header: "es-MX,es;q=0.9",
      }),
    ).toBe("en");
  });

  it("REQ-272 ?lang=es beats an English cookie and doc language", () => {
    expect(
      resolvePublicLang({ query: "es", cookie: "pm_lang=en", docLang: "en" }),
    ).toBe("es");
  });

  it("REQ-272 no or junk ?lang= keeps the P-12 order (cookie → doc → header → en)", () => {
    expect(resolvePublicLang({ query: "fr", cookie: "pm_lang=en", docLang: "es" }))
      .toBe("en");
    expect(resolvePublicLang({ query: null, docLang: "es" })).toBe("es");
    expect(resolvePublicLang({ query: "", header: "es" })).toBe("es");
    expect(resolvePublicLang({})).toBe("en");
  });
});

describe("REQ-272 langToggleHref — the toggle links keep the page, swap the language", () => {
  it("REQ-272 sets ?lang= on the current path", () => {
    expect(langToggleHref("http://x.test/i/abc", "es")).toBe("/i/abc?lang=es");
  });

  it("REQ-272 replaces an existing ?lang= and keeps other params", () => {
    expect(langToggleHref("http://x.test/i/abc?lang=es&ref=sms", "en"))
      .toBe("/i/abc?lang=en&ref=sms");
  });
});

describe("REQ-272 /i/:id wiring", () => {
  const route = read("front-end/routes/i/[id].tsx");

  it("REQ-272 the route feeds the link's ?lang= into the language pick", () => {
    expect(route).toMatch(/searchParams\.get\("lang"\)/);
    expect(route).toMatch(/resolvePublicLang\(\{[\s\S]*query:/);
  });

  it("REQ-272 the route renders the EN | ES toggle island", () => {
    expect(route).toMatch(/import PublicLangToggle from "..\/..\/islands\/PublicLangToggle.tsx"/);
    expect(route).toMatch(/<PublicLangToggle\b/);
  });

  it("REQ-272 the toggle persists the pick (cookie + localStorage) like /q", () => {
    const island = read("front-end/islands/PublicLangToggle.tsx");
    expect(island).toMatch(/persistLang\(/);
    expect(island).toMatch(/data-public-lang=/);
    expect(island).toMatch(/aria-current=/);
  });
});
