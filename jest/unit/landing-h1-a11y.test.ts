/**
 * REQ-349 — Raphael, 2026-11-12: "fix every issue the demo found, loop until there are none."
 * Demo issue p15-2 (demo-loop cycle 1, run r20a1d9c2, pair 1 and pair 9): the landing headline
 * reads oddly to screen readers — its accessible name was "We handle the quotes. contracts." /
 * "…las cotizaciones. los contratos.", because the four rotor words are live <h1> text and both
 * the entering and the leaving word are visible during the crossfade.
 *
 * The fix: the <h1> has ONE stable accessible name — a visually-hidden span carrying the full
 * sentence from the one landing dictionary (`hero.h1Sr`, en + es, swapped by the language
 * toggle like every data-i18n node) — and the visible pieces (the two lines and the rotor) are
 * aria-hidden.
 */
import * as fs from "fs";
import * as path from "path";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";
import {
  buildRotorPhrase,
  ES_ROTOR,
} from "../../shared/quote-flow/landing-rotor";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const papeleo = ES_ROTOR.find((e) => e.word === "papeleo")!;

describe("REQ-349 p15-2: the landing <h1> has one stable accessible name", () => {
  it("REQ-349 the dictionary carries the full headline sentence in English and Spanish", () => {
    const en = LANDING_DICT.en;
    const es = LANDING_DICT.es;
    expect(en["hero.h1Sr"]).toBe(
      `${en["hero.h1a"]} ${en["hero.h1b"]} paperwork.`,
    );
    expect(en["hero.h1Sr"]).toBe("You do the work. We handle the paperwork.");
    expect(es["hero.h1Sr"]).toBe(
      `${es["hero.h1a"]} ${es["hero.h1b"]} ${buildRotorPhrase(papeleo)}`,
    );
    expect(es["hero.h1Sr"]).toBe(
      "Tú haces el trabajo. Nosotros manejamos el papeleo.",
    );
  });

  const h1 = (() => {
    const src = read("front-end/routes/index.tsx");
    const m = src.match(/<h1>[\s\S]*?<\/h1>/);
    return m ? m[0] : "";
  })();

  it("REQ-349 the <h1> holds a visually-hidden span with the dictionary sentence", () => {
    expect(h1).toMatch(
      /<span\s+class="sr-only"\s+data-i18n="hero\.h1Sr"\s*>\s*\{t\("hero\.h1Sr"\)\}\s*<\/span>/,
    );
  });

  it("REQ-349 the rotor and the visible headline lines are hidden from assistive tech", () => {
    expect(h1).toMatch(/<span\s+class="rotor"\s+aria-hidden="true"/);
    expect(h1).toMatch(/<span\s+data-i18n="hero\.h1a"\s+aria-hidden="true"/);
    expect(h1).toMatch(/<span\s+data-i18n="hero\.h1b"\s+aria-hidden="true"/);
  });

  it("REQ-349 landing.css defines the visually-hidden utility (clipped, not display:none)", () => {
    const css = read("front-end/static/landing.css");
    const rule = css.match(/\.sr-only\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*absolute/);
    expect(rule![1]).toMatch(/clip/);
    expect(rule![1]).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
});
