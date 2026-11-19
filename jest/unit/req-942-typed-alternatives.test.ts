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

/**
 * REQ-1019 (LOOP-007 cycle 2, q2-2) — "2 options: basic porcelain tile $8,400
 * or upgrade with niche + glass door $11,200". The real model put $8,400 on
 * the base line AND on the upgrade line (plus three $0 lines), and the
 * REQ-942 guard let the $16,800 draft through: it only knows the other option
 * by its two-word label prefix ("upgrade with") or its exact typed price, and
 * a line at the first option's price is never treated as another option.
 */
describe("REQ-1019 (LOOP-007 q2-2) firstAlternativeLines — the first option's price repeated", () => {
  const Q22 =
    "quote for maria gonzalez 843-555-0142 maria.g@example.com, 1418 oak hollow dr austin tx 78745. master bath redo, tear out old tub put in walk in shower w/ tile surround about 60 sqft wall tile + 35 sqft floor, new 48in vanity, 2 options: basic porcelain tile $8,400 or upgrade with niche + glass door $11,200. 30% deposit";
  const L = (description: string, amountCents: number) => ({
    description,
    amountCents,
  });
  const sum = (ls: { amountCents: number }[]) =>
    ls.reduce((n, l) => n + l.amountCents, 0);
  it("REQ-1019: reads the q2-2 message as two options", () => {
    expect(
      alts.typedAlternatives(Q22).map((a: { cents: number }) => a.cents),
    ).toEqual([840000, 1120000]);
  });
  it("REQ-1019: narrows [tear-out $0, base $8,400, 'Upgrade: tile niche and glass door' $8,400, vanity $0, cleanup $0] to $8,400", () => {
    const out = alts.firstAlternativeLines([
      L("Tear out old tub", 0),
      L(
        "Install walk-in shower with tile surround (60 sqft wall, 35 sqft floor) - basic porcelain tile",
        840000,
      ),
      L("Install new 48in vanity", 0),
      L("Upgrade: tile niche and glass door", 840000),
      L("Cleanup", 0),
    ], alts.typedAlternatives(Q22));
    expect(out).toBeDefined();
    expect(sum(out ?? [])).toBe(840000);
    expect(
      (out ?? []).some((l: { description: string }) =>
        /niche|glass door/i.test(l.description)
      ),
    ).toBe(false);
  });
  it("REQ-1019: narrows ['Basic porcelain tile option' $8,400, 'Upgrade option with niche + glass door' $8,400] to $8,400", () => {
    const out = alts.firstAlternativeLines([
      L("Tear out old tub", 0),
      L("Basic porcelain tile option", 840000),
      L("Upgrade option with niche + glass door", 840000),
      L("New 48in vanity", 0),
      L("Walk-in shower", 0),
    ], alts.typedAlternatives(Q22));
    expect(out).toBeDefined();
    expect(sum(out ?? [])).toBe(840000);
  });
});
