/**
 * REQ-026 — 5.1 NW-05: honest scope bullets from the contractor's raw text.
 *
 * "The AI must never echo the user's raw input back as the suggested
 * description. (Screenshot: all three 'I Need To' options just repeat
 * 'I need to replace a toile for $500'.) We are the ones professionalizing
 * the quotes."
 *
 * Both LLM fallbacks (generate-job-options, polish-job-details) used to
 * bullet the raw sentence verbatim. This pins the pure helper they now share:
 * shared/quote-flow/scope-from-raw.ts `scopeBulletsFromRaw(raw, lang)` →
 * `{ bullets, degraded }` — intent prefix gone ("I need to", "Necesito"),
 * price clause gone ("for $500", "por $900"), question tail gone ("what
 * should I charge?"), one bullet per line / ";" / ".", first letter
 * capitalized, no trailing period, deduped; `degraded: true` when nothing
 * scope-like survives.
 */
type Lang = "en" | "es";
type Mod = {
  scopeBulletsFromRaw: (
    raw: string,
    lang: Lang,
  ) => { bullets: string[]; degraded: boolean };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod: Mod = require("../../shared/quote-flow/scope-from-raw");

const CASES: Array<{
  name: string;
  raw: string;
  lang: Lang;
  bullets: string[];
  degraded: boolean;
}> = [
  {
    name: "EN intent prefix + price clause",
    raw: "I need to replace a toile for $500",
    lang: "en",
    bullets: ["Replace a toile"],
    degraded: false,
  },
  {
    name: "ES intent prefix + price clause",
    raw: "Necesito cambiar 12 tablas del deck por $900",
    lang: "es",
    bullets: ["Cambiar 12 tablas del deck"],
    degraded: false,
  },
  {
    name: "third-person intent + question tail",
    raw: "Customer wants a 10x10 slab, what should I charge?",
    lang: "en",
    bullets: ["10x10 slab"],
    degraded: false,
  },
  {
    name: "three lines split on ; and newline",
    raw: "paint fence; haul debris\nclean up",
    lang: "en",
    bullets: ["Paint fence", "Haul debris", "Clean up"],
    degraded: false,
  },
  {
    name: "nothing scope-like left",
    raw: "ok",
    lang: "en",
    bullets: [],
    degraded: true,
  },
];

describe("REQ-026 NW-05 scopeBulletsFromRaw", () => {
  it.each(CASES)("REQ-026 $name → $bullets", ({ raw, lang, bullets, degraded }) => {
    expect(mod.scopeBulletsFromRaw(raw, lang)).toEqual({ bullets, degraded });
  });

  it.each(CASES)(
    "REQ-026 invariants ($name): never the raw sentence, never a $ amount, never an intent opener",
    ({ raw, lang }) => {
      const { bullets } = mod.scopeBulletsFromRaw(raw, lang);
      for (const b of bullets) {
        expect(b === raw.trim()).toBe(false);
        expect(b.includes("$")).toBe(false);
        expect(/^(I|we|necesito|quiero)\b/i.test(b)).toBe(false);
        expect(/[.;]$/.test(b)).toBe(false);
        expect(b[0]).toBe(b[0].toUpperCase());
      }
    },
  );

  it("REQ-026 dedupes repeated lines and ignores empties", () => {
    expect(
      mod.scopeBulletsFromRaw("Paint fence.\n\npaint fence;  \nHaul debris.", "en"),
    ).toEqual({ bullets: ["Paint fence", "Haul debris"], degraded: false });
  });
});
