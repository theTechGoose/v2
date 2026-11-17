/**
 * REQ-742 — demo-loop cycle 5 (run r37f88707), demo issue p18-6e
 * "Landing title and hero differ".
 *
 * Two copy sources said the same thing two ways on "/":
 *  - the es tab title read "Tú haces el trabajo. Nosotros el papeleo." while
 *    the hero headline read "… Nosotros manejamos el papeleo.";
 *  - the hero document card called the $1,950 line "Mano de obra (3 días)"
 *    (dict doc.q.l3) while the Quote showcase card, built by
 *    static/landing-scripts.js, hard-coded "Plomería e instalación"
 *    ("Plumbing & install labor" in en).
 * Now the title is built from the hero's sentence and the showcase reads the
 * labour label from the one landing dictionary.
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";
import { mockQuoteBoot } from "../../shared/quote-flow/landing-mock-quote";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const LANGS = ["en", "es"] as const;

/** The labour line's name: doc.q.l3 without its "(3 days)" count, which the
 *  showcase card prints in its own quantity column. */
const laborName = (lang: "en" | "es") =>
  LANDING_DICT[lang]["doc.q.l3"].replace(/\s*\([^)]*\)\s*$/, "");

/** Run static/landing-scripts.js against a stub DOM in `lang` and return the
 *  Quote showcase's rendered rows (#doc-lines). */
function showcaseRows(lang: "en" | "es"): string[][] {
  const els: Record<string, Record<string, unknown>> = {};
  /** A DOM element stub: real fields where the script reads them back, and a
   *  no-op function for any other method it calls. */
  const stubEl = (): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      innerHTML: "",
      textContent: "",
      style: {},
      dataset: {},
      children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
    };
    return new Proxy(base, {
      get: (o, k: string) => (k in o ? o[k] : () => undefined),
    });
  };
  const document: Record<string, unknown> = {
    documentElement: { getAttribute: () => lang, setAttribute() {} },
    getElementById: (id: string) => (els[id] ??= stubEl()),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => stubEl(),
    createTextNode: (s: string) => ({ textContent: s }),
    addEventListener() {},
    cookie: "",
    dispatchEvent: () => true,
  };
  const ctx: Record<string, unknown> = {
    document,
    location: { search: `?lang=${lang}` },
    localStorage: { getItem: () => null, setItem() {} },
    URLSearchParams,
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout() {},
    clearInterval() {},
    requestAnimationFrame: () => 0,
    __PM_LANDING_DICT: LANDING_DICT,
    __PM_MOCK_QUOTE: mockQuoteBoot(),
    __PM_OFFER: {},
    CustomEvent: class {
      constructor(public type: string, public init?: unknown) {}
    },
    dispatchEvent: () => true,
    addEventListener() {},
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInNewContext(read("front-end/static/landing-scripts.js"), ctx);
  const html = String(els["doc-lines"]?.innerHTML ?? "");
  return [...html.matchAll(/<div class="doc-line">(.*?)<\/div>/g)].map((m) =>
    [...m[1].matchAll(/<span class="[a-z]+">(.*?)<\/span>/g)].map((s) => s[1])
  );
}

describe("REQ-742 p18-6e (cycle 5): the landing tab title says what the hero says", () => {
  test.each(LANGS)(
    "%s: head.title is 'DocuMonster — ' + the hero's sentence",
    (lang) => {
      const d = LANDING_DICT[lang];
      expect(d["head.title"]).toBe(`DocuMonster — ${d["hero.h1Sr"]}`);
    },
  );

  test("es: the title reads 'Nosotros manejamos el papeleo'", () => {
    expect(LANDING_DICT.es["head.title"]).toContain(
      "Nosotros manejamos el papeleo.",
    );
  });

  test("routes/index.tsx SSRs the <title> from the landing dictionary, not a second copy in lang/*.json", () => {
    const src = read("front-end/routes/index.tsx");
    expect(src).not.toMatch(/landing\.head\.title/);
    expect(src).toMatch(/t\("head\.title"\)/);
  });

  test.each(LANGS)(
    "%s: lang/%s.json's landing.head.title (if kept) matches the dictionary",
    (lang) => {
      const json = JSON.parse(read(`lang/${lang}.json`));
      const v = json["landing.head.title"];
      if (v !== undefined) expect(v).toBe(LANDING_DICT[lang]["head.title"]);
    },
  );
});

describe("REQ-742 p18-6e (cycle 5): the $1,950 labour line has one name on the landing page", () => {
  test("static/landing-scripts.js no longer hard-codes a second labour label", () => {
    const src = read("front-end/static/landing-scripts.js");
    expect(src).not.toMatch(/Plomería e instalación|Plumbing & install labor/);
  });

  test.each(LANGS)(
    "%s: the Quote showcase's labour row is named from doc.q.l3",
    (lang) => {
      const rows = showcaseRows(lang);
      expect(rows.length).toBe(4);
      const labor = rows[3];
      expect(labor[0]).toBe(laborName(lang));
      expect(laborName(lang)).toBe(lang === "es" ? "Mano de obra" : "Labor");
      // The count stays in the quantity column, so it is not printed twice.
      expect(labor[1]).toBe(lang === "es" ? "3 días" : "3 days");
      expect(labor[3]).toBe(mockQuoteBoot().lines.labor.amount);
    },
  );
});
