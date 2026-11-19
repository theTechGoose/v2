/**
 * REQ-942 (LOOP-007 cycle 1, q1-1) — the alternatives a contractor types for
 * the customer to pick from (shared/quote-flow/alternatives.ts), and a draft
 * narrowed to the first one so a quote never adds options together.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let alts: any;
beforeAll(() => {
  alts = require("../../shared/quote-flow/alternatives");
});

const TESTER =
  "quote for Linda Park, guest bath remodel, tile floor 60 sqft and tile walls. two options: option A basic subway tile $9,800, option B large format porcelain + niche + glass door $13,450. 30% deposit up front, rest when done.";

describe("REQ-942 typedAlternatives", () => {
  it("reads the tester's two options with their own prices", () => {
    const found = alts.typedAlternatives(TESTER);
    expect(
      found.map((a: { label: string; cents: number }) => [a.label, a.cents]),
    )
      .toEqual([["option A", 980000], ["option B", 1345000]]);
    expect(found[0].text).toContain("subway tile");
  });
  it("reads the Spanish 'opción A / opción B'", () => {
    const found = alts.typedAlternatives(
      "dos opciones: opción A azulejo subway básico $9,800, opción B porcelanato de formato grande $13,450.",
    );
    expect(found.map((a: { cents: number }) => a.cents)).toEqual([
      980000,
      1345000,
    ]);
  });
  it("reads unlabelled 'two options: … $X or … $Y'", () => {
    const found = alts.typedAlternatives(
      "deck stain, two options: oil based $1,200 or water based $950",
    );
    expect(found.map((a: { cents: number }) => a.cents)).toEqual([
      120000,
      95000,
    ]);
  });
  it("is undefined for one job with several priced lines", () => {
    expect(
      alts.typedAlternatives(
        "Kitchen remodel for the Hendersons. Demo cabinets $1,200, shaker cabinets installed $6,500, quartz $3,800.",
      ),
    ).toBeUndefined();
    expect(alts.typedAlternatives("fix the door or the faucet, $350"))
      .toBeUndefined();
  });
});

describe("REQ-942 firstAlternativeLines", () => {
  const found = () => alts.typedAlternatives(TESTER);
  it("keeps option A alone when the draft has a line per option", () => {
    const out = alts.firstAlternativeLines([
      { description: "Option A: subway tile", amountCents: 980000 },
      {
        description: "Option B: porcelain, niche, glass door",
        amountCents: 1345000,
      },
    ], found());
    expect(out).toEqual([
      { description: "Option A: subway tile", amountCents: 980000 },
    ]);
  });
  it("keeps shared lines that add up to option A", () => {
    const out = alts.firstAlternativeLines([
      { description: "Demo and prep", amountCents: 100000 },
      { description: "Option A tile", amountCents: 880000 },
      { description: "Option B tile", amountCents: 1245000 },
    ], found());
    expect(
      out.reduce(
        (n: number, l: { amountCents: number }) => n + l.amountCents,
        0,
      ),
    )
      .toBe(980000);
  });
  it("never one line summing both options", () => {
    const out = alts.firstAlternativeLines([
      { description: "Guest bath tile", amountCents: 2325000 },
    ], found());
    expect(out).toEqual([
      { description: "Guest bath tile", amountCents: 980000 },
    ]);
  });
  it("leaves a draft that already holds option A alone", () => {
    expect(alts.firstAlternativeLines([
      { description: "Guest bath, subway tile", amountCents: 980000 },
    ], found())).toBeUndefined();
  });
});
