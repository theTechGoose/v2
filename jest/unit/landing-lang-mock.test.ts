/**
 * REQ-345 — demo-loop cycle 1, demo issues m3 ("phone mock-up stays Spanish on
 * /?lang=en") and p15-6 ("landing hero mock in English on the Spanish page").
 *
 * (p15-6) The hero's `hs-phone` chat mock in front-end/routes/index.tsx was
 * literal English JSX with no data-i18n, so neither the SSR dictionary pick nor
 * the toggle's [data-i18n] repaint could translate it. Now every bubble is a
 * `hero.mock.*` key in front-end/lib/landing-dict.ts, en AND es.
 *
 * (m3) static/landing-scripts.js applyLang repainted [data-i18n] and rewrote
 * the URL but never told the PhoneChat island (which reads langSignal only).
 * Now it dispatches a `pm:lang` CustomEvent that lib/lang.ts turns into
 * langSignal (behaviour: front-end/lib/lang-event.test.ts; browser:
 * e2e/landing-lang-mock).
 */
import * as fs from "fs";
import * as path from "path";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const MOCK_KEYS = [
  "hero.mock.me1",
  "hero.mock.them1",
  "hero.mock.l1",
  "hero.mock.l2",
  "hero.mock.l3",
  "hero.mock.total",
  "hero.mock.cta",
  "hero.mock.me2",
  "hero.mock.input",
  "doc.q.client",
] as const;

describe("REQ-345 p15-6: the hero chat mock speaks the page's language", () => {
  const en = LANDING_DICT.en as Record<string, string>;
  const es = LANDING_DICT.es as Record<string, string>;

  test("every mock bubble has an en AND an es string", () => {
    for (const k of MOCK_KEYS) {
      expect(typeof en[k]).toBe("string");
      expect(en[k].length).toBeGreaterThan(0);
      expect(typeof es[k]).toBe("string");
      expect(es[k].length).toBeGreaterThan(0);
    }
  });

  test("the contractor's input bubble and the assistant's reply are Spanish on ES", () => {
    expect(en["hero.mock.me1"]).toMatch(
      /Kitchen remodel for the Hernández family/,
    );
    expect(es["hero.mock.me1"]).toMatch(/Hernández/);
    expect(es["hero.mock.me1"]).not.toBe(en["hero.mock.me1"]);
    expect(es["hero.mock.them1"]).not.toBe(en["hero.mock.them1"]);
    expect(es["hero.mock.cta"]).not.toBe(en["hero.mock.cta"]);
    expect(es["hero.mock.me2"]).not.toBe(en["hero.mock.me2"]);
    expect(es["hero.mock.input"]).not.toBe(en["hero.mock.input"]);
    expect(es["doc.q.client"]).not.toBe(en["doc.q.client"]);
  });

  test("routes/index.tsx renders the hs-phone block from the dictionary, not literal English", () => {
    const src = read("front-end/routes/index.tsx");
    const start = src.indexOf('class="hs-phone"');
    const end = src.indexOf('class="hs-chips"', start);
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, end > 0 ? end : undefined);
    for (
      const literal of [
        "Kitchen remodel for the Hernández family",
        "Got it. Pulling comps now",
        "Send to client",
        "Send it",
        "Type a message",
      ]
    ) {
      expect(block).not.toContain(literal);
    }
    for (const k of MOCK_KEYS.filter((k) => k.startsWith("hero.mock."))) {
      expect(block).toContain(`data-i18n="${k}"`);
    }
    expect(src).toContain('data-i18n="doc.q.client"');
    expect(src).not.toContain("R. Hernández · Apr 26</div>");
  });
});

describe("REQ-345 m3: the landing toggle reaches the islands", () => {
  test("applyLang dispatches a pm:lang CustomEvent on document", () => {
    const js = read("front-end/static/landing-scripts.js");
    const fn = js.slice(js.indexOf("function applyLang("));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(
      /document\.dispatchEvent\(\s*new CustomEvent\("pm:lang",\s*\{\s*detail:\s*lang\s*\}\)/,
    );
  });

  test("lib/lang.ts installs the pm:lang listener on document in the browser", () => {
    const ts = read("front-end/lib/lang.ts");
    expect(ts).toContain('export const LANG_EVENT = "pm:lang"');
    expect(ts).toMatch(/listenForLangEvents\(document\)/);
  });
});
