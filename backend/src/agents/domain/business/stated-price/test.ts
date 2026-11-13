/**
 * REQ-445 (demo-loop cycle 3, B2 + M20) — the price the contractor states for
 * the WHOLE job, and the checks a chat-drafted quote gets against it.
 *
 * B2: on Priya's $2,585 master-bath draft she typed "no no eso está muy
 * bajo!! $2,585 for a whole master bath?? … make it around $18,000 and add the
 * shower bench and mold remediation allowance". Nothing read the $18,000 (two
 * dollar amounts → REQ-377's reader gave up), so gpt-4o-mini's answer was
 * saved as it came: the shower line at $18,000, every other line ×10, a
 * $5,000 bench and a $30,000 mold allowance — $71,050.
 *
 * M20: her first message ended "Precio? tú dime, yo pienso como 18 mil" and
 * the draft was $2,585 — no reader knew a spoken "18 mil", and the bathroom
 * remodel floor (REQ-382) only ran on the help-me-price tiers.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import {
  foldZeroLines,
  missesTarget,
  moneyAmounts,
  type PricedLine,
  priceJumpAsk,
  revisesSameJob,
  revisionJump,
  scaleLinesToTotal,
  settleCreateQuote,
  settleQuotePrice,
  statedTotalCents,
} from "./mod.ts";

/** The demo's correction, as pair 7's customer typed it (fleet-6 l.135). */
const DEMO_FIX =
  "no no eso está muy bajo!! $2,585 for a whole master bath?? make it around $18,000 and add the shower bench and mold remediation allowance";
/** …and as the report quotes it, with the elision. */
const DEMO_FIX_ELIDED =
  "no no eso está muy bajo!! $2,585 for a whole master bath?? … make it around $18,000 and add the shower bench and mold remediation allowance";
/** The demo's all-Spanish master-bath job, typed straight into a new chat
 *  (fleet-6 l.136/220: tub out, 60" frameless walk-in, 55 + 90 sq ft of tile,
 *  double vanity, fan, GFCI, paint, drywall, bench, maybe mold, after New
 *  Year) — ending with the price she had in mind. */
const DEMO_JOB_ES =
  "Remodelación del baño principal para la señora Okafor: quitar la tina, ducha walk-in de 60 pulgadas con vidrio frameless y una banca, " +
  "piso de azulejo 55 pies cuadrados, azulejo en las paredes de la ducha 90 pies cuadrados, instalar doble lavabo, extractor nuevo, " +
  "mover el contacto GFCI, pintar y reparar el drywall, puede haber moho detrás de la tina. Empezamos después de Año Nuevo. " +
  "Precio? tú dime, yo pienso como 18 mil";

/** The demo's first draft — TOTAL $2,585.00 (fleet-6 l.220). */
const FIRST_DRAFT: PricedLine[] = [
  { description: "Tub removal", amountCents: 20_000 },
  {
    description: "Install walk-in shower with frameless glass",
    amountCents: 60_000,
  },
  { description: "Floor tile (55 sqft)", amountCents: 16_500 },
  { description: "Wall tile (90 sqft)", amountCents: 27_000 },
  { description: "Double vanity install", amountCents: 50_000 },
  { description: "Exhaust fan install", amountCents: 25_000 },
  { description: "Move GFCI outlet", amountCents: 10_000 },
  { description: "Interior painting", amountCents: 30_000 },
  { description: "Drywall repair", amountCents: 20_000 },
];
/** The demo model's answer to DEMO_FIX: shower $18,000, the rest ×10
 *  (drywall kept), + bench $5,000 + mold allowance $30,000 = $71,050. */
const DEMO_X10: PricedLine[] = [
  { description: "Tub removal", amountCents: 200_000 },
  {
    description: "Install walk-in shower with frameless glass",
    amountCents: 1_800_000,
  },
  { description: "Floor tile (55 sqft)", amountCents: 165_000 },
  { description: "Wall tile (90 sqft)", amountCents: 270_000 },
  { description: "Double vanity install", amountCents: 500_000 },
  { description: "Exhaust fan install", amountCents: 250_000 },
  { description: "Move GFCI outlet", amountCents: 100_000 },
  { description: "Interior painting", amountCents: 300_000 },
  { description: "Drywall repair", amountCents: 20_000 },
  { description: "Shower bench installation", amountCents: 500_000 },
  { description: "Mold remediation allowance", amountCents: 3_000_000 },
];

const sum = (ls: readonly PricedLine[]) =>
  ls.reduce((s, l) => s + l.amountCents, 0);

Deno.test("REQ-445 fixtures: the demo's first draft is $2,585 and the model's ×10 answer is $71,050", () => {
  assertEquals(sum(FIRST_DRAFT), 258_500);
  assertEquals(sum(DEMO_X10), 7_105_000);
});

// ---------------------------------------------------------------------------
// statedTotalCents — the price for the WHOLE job
// ---------------------------------------------------------------------------

Deno.test("REQ-445 B2 statedTotalCents: the demo's 'make it around $18,000…' is the job's $18,000 — the $2,585 quoted back is not", () => {
  assertEquals(statedTotalCents(DEMO_FIX), 1_800_000);
  assertEquals(
    statedTotalCents(DEMO_FIX, { currentTotalCents: 258_500 }),
    1_800_000,
  );
  assertEquals(statedTotalCents(DEMO_FIX_ELIDED), 1_800_000);
  assertEquals(statedTotalCents("make it around $18,000"), 1_800_000);
  // both amounts are typed amounts; only one is the total
  assertEquals(moneyAmounts(DEMO_FIX).map((a) => a.cents), [
    258_500,
    1_800_000,
  ]);
});

Deno.test("REQ-445 M20 statedTotalCents: '…Precio? tú dime, yo pienso como 18 mil' is $18,000 — a spoken Spanish 'mil' with no $ sign", () => {
  assertEquals(statedTotalCents(DEMO_JOB_ES), 1_800_000);
  assertEquals(moneyAmounts(DEMO_JOB_ES).map((a) => a.cents), [1_800_000]);
});

Deno.test("REQ-445 statedTotalCents: '18k', '18 thousand', '18 grand', '$18 mil', '$18.5k', a bare amount and Spanish cues are the whole job's price", () => {
  const cases: [string, number][] = [
    ["make it 18k", 1_800_000],
    ["too low, more like 18 thousand", 1_800_000],
    ["I was thinking about 18 grand", 1_800_000],
    ["it should be around $18 mil", 1_800_000],
    ["more like $18.5k", 1_850_000],
    ["no, $18,000.", 1_800_000],
    ["creo que unos 18 mil dólares", 1_800_000],
    ["que sea 18 mil", 1_800_000],
    ["eso está muy bajo, ponle 18 mil", 1_800_000],
    ["Master bath remodel, $18,000 total", 1_800_000],
    ["Total: $18,000", 1_800_000],
    ["make the total $18,000", 1_800_000],
    ["~$18k", 1_800_000],
    // a correction of a correction: the last one stands
    ["make it $18k. actually make it $19k", 1_900_000],
  ];
  for (const [text, cents] of cases) {
    assertEquals(statedTotalCents(text), cents, text);
  }
});

Deno.test("REQ-445 statedTotalCents: an amount scoped to one thing or a unit ('for the bench', 'per sq ft') is not the job's total — 'por todo' / 'in total' still are", () => {
  for (
    const text of [
      "I need $500 for materials",
      "make it $1,500 for the bench",
      "make it $40 per sq ft",
      "make it $18/sqft",
      "cóbrale como 18 mil de material",
    ]
  ) {
    assertEquals(statedTotalCents(text), undefined, text);
  }
  assertEquals(statedTotalCents("yo pienso como 18 mil por todo"), 1_800_000);
  assertEquals(statedTotalCents("more like $18k in total"), 1_800_000);
  assertEquals(statedTotalCents("make it $18k on the quote"), 1_800_000);
});

Deno.test("REQ-445 statedTotalCents: a line's price, a cost, a deposit, a bound or a thickness is never the job's total", () => {
  const notTotals = [
    "the shower should be around $4,000",
    "add the shower bench $1,500",
    "the tile, make it $4k",
    "my plumber quoted $2,800",
    "half deposit, $9,000 down",
    "6 mil vapor barrier under the slab",
    "install a 12k btu mini split",
    "$2,585 for a whole master bath??",
    "tile 120 sqft at $8/sqft, $960 total, plus vanity $1,200",
    "keep it under $18k",
    "Kitchen remodel for the Hendersons. Demo cabinets $1,200, shaker cabinets installed $6,500, quartz $3,800, electrical $600.",
    "make it 700 sq ft",
    "",
  ];
  for (const text of notTotals) {
    assertEquals(statedTotalCents(text), undefined, text);
  }
  // a thickness or a BTU rating is not money at all
  assertEquals(moneyAmounts("6 mil vapor barrier under the slab"), []);
  assertEquals(moneyAmounts("install a 12k btu mini split"), []);
  // on a draft, "add X. make it $Y" under the current total prices the
  // added work — it is not a new, smaller total for the job
  assertEquals(
    statedTotalCents("add a shower bench. make it $1,500", {
      currentTotalCents: 258_500,
    }),
    undefined,
  );
  // the current total, quoted back with a cue, is not a new price
  assertEquals(
    statedTotalCents("it's $2,585??", { currentTotalCents: 258_500 }),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// missesTarget / scaleLinesToTotal
// ---------------------------------------------------------------------------

Deno.test("REQ-445 missesTarget: more than ±15% away from the stated total", () => {
  assert(missesTarget(7_105_000, 1_800_000), "$71,050 vs $18,000");
  assert(missesTarget(258_500, 1_800_000), "$2,585 vs $18,000");
  assert(!missesTarget(1_820_000, 1_800_000), "$18,200 is about $18,000");
  assert(!missesTarget(2_070_000, 1_800_000), "exactly +15% is within");
  assert(!missesTarget(1_530_000, 1_800_000), "exactly −15% is within");
  assert(missesTarget(2_070_100, 1_800_000), "just over +15%");
});

Deno.test("REQ-445 B2 scaleLinesToTotal: the demo's $71,050 lines spread over $18,000 — the exact total, whole dollars, every line kept in order", () => {
  const scaled = scaleLinesToTotal(DEMO_X10, 1_800_000);
  assertEquals(sum(scaled), 1_800_000);
  assertEquals(
    scaled.map((l) => l.description),
    DEMO_X10.map((l) => l.description),
  );
  for (const l of scaled) {
    assert(l.amountCents > 0, `${l.description} ${l.amountCents}`);
    assertEquals(l.amountCents % 100, 0, `${l.description} whole dollars`);
    assert(l.amountCents < 1_800_000, `${l.description} is not the total`);
  }
  // the input is not mutated
  assertEquals(sum(DEMO_X10), 7_105_000);
  // nothing to scale from: the lines come back as they were
  assertEquals(
    scaleLinesToTotal([{ description: "x", amountCents: 0 }], 50_000),
    [{ description: "x", amountCents: 0 }],
  );
});

// ---------------------------------------------------------------------------
// revisionJump — the sanity gate on a revision with no stated total
// ---------------------------------------------------------------------------

const BENCH = {
  description: "Shower bench installation",
  amountCents: 500_000,
};
const MOLD = {
  description: "Mold remediation allowance",
  amountCents: 3_000_000,
};

Deno.test("REQ-445 B2 revisionJump: the bench + mold allowance the model priced more than triple $2,585 with prices nobody typed", () => {
  const jump = revisionJump(
    FIRST_DRAFT,
    [...FIRST_DRAFT, BENCH, MOLD],
    "add the shower bench and mold remediation allowance",
  );
  assert(jump, "a jump");
  assertEquals(jump.fromCents, 258_500);
  assertEquals(jump.toCents, 3_758_500);
  assertEquals(jump.unpriced.map((l) => l.description).sort(), [
    "Mold remediation allowance",
    "Shower bench installation",
  ]);
});

Deno.test("REQ-445 B2 revisionJump: the demo's ×10 lines are flagged; an unchanged line and a price the contractor typed are not", () => {
  const jump = revisionJump(FIRST_DRAFT, DEMO_X10, DEMO_FIX);
  assert(jump, "a jump");
  const flagged = jump.unpriced.map((l) => l.description);
  assert(flagged.includes("Mold remediation allowance"), flagged.join());
  assert(flagged.includes("Tub removal"), flagged.join());
  assert(!flagged.includes("Drywall repair"), "unchanged line");
  assert(
    !flagged.includes("Install walk-in shower with frameless glass"),
    "its $18,000 was typed",
  );
});

Deno.test("REQ-445 revisionJump: a priced addition, the new total typed, or under 3× is no jump", () => {
  // the contractor priced what was added
  assertEquals(
    revisionJump(
      FIRST_DRAFT,
      [...FIRST_DRAFT, MOLD],
      "add a mold remediation allowance, $30,000",
    ),
    undefined,
  );
  // the contractor typed the new total
  assertEquals(
    revisionJump(
      FIRST_DRAFT,
      [...FIRST_DRAFT, BENCH, MOLD],
      "add both, new total about $37,500",
    ),
    undefined,
  );
  // +$5,000 on $2,585 is under 3×
  assertEquals(
    revisionJump(FIRST_DRAFT, [...FIRST_DRAFT, BENCH], "add the bench"),
    undefined,
  );
  // nothing to measure from
  assertEquals(revisionJump([], DEMO_X10, "add stuff"), undefined);
});

Deno.test("REQ-445 revisesSameJob: the same summary or a line kept is a revision; a fresh job for someone else is not", () => {
  assert(revisesSameJob(
    { summary: "Main bathroom remodel — Okafor", lines: FIRST_DRAFT },
    { summary: "Main bathroom remodel — Okafor", lines: DEMO_X10 },
  ));
  assert(revisesSameJob(
    { summary: "Main bathroom remodel — Okafor", lines: FIRST_DRAFT },
    { summary: "Master bath remodel", lines: DEMO_X10 },
  ));
  assert(
    !revisesSameJob(
      {
        summary: "Faucet repair — Park",
        lines: [{ description: "Faucet repair", amountCents: 15_000 }],
      },
      {
        summary: "Kitchen remodel — Mendez",
        lines: [{ description: "Kitchen remodel", amountCents: 2_500_000 }],
      },
    ),
  );
});

// ---------------------------------------------------------------------------
// settleQuotePrice — re-ask once, then the code's own fix (or ask the user)
// ---------------------------------------------------------------------------

const REASKED_18K: PricedLine[] = [
  { description: "Tub removal", amountCents: 80_000 },
  {
    description: "Install walk-in shower with frameless glass",
    amountCents: 830_000,
  },
  { description: "Floor tile (55 sqft)", amountCents: 110_000 },
  { description: "Wall tile (90 sqft)", amountCents: 180_000 },
  { description: "Double vanity install", amountCents: 150_000 },
  { description: "Exhaust fan install", amountCents: 45_000 },
  { description: "Move GFCI outlet", amountCents: 25_000 },
  { description: "Interior painting", amountCents: 70_000 },
  { description: "Drywall repair", amountCents: 60_000 },
  { description: "Shower bench installation", amountCents: 120_000 },
  { description: "Mold remediation allowance", amountCents: 150_000 },
]; // $18,200

function reasker(answers: (readonly PricedLine[] | undefined)[]) {
  const notes: string[] = [];
  return {
    notes,
    reask: (note: string) => {
      notes.push(note);
      return Promise.resolve(answers.shift());
    },
  };
}

Deno.test("REQ-445 B2 settleQuotePrice: lines that miss the stated total are re-asked once, naming both totals; a re-ask near it is kept as written", async () => {
  assertEquals(sum(REASKED_18K), 1_820_000);
  const r = reasker([REASKED_18K]);
  const out = await settleQuotePrice({
    lines: DEMO_X10,
    before: FIRST_DRAFT,
    userText: DEMO_FIX,
    targetCents: 1_800_000,
    reask: r.reask,
  });
  assertEquals(out, { kind: "lines", how: "reasked", lineItems: REASKED_18K });
  assertEquals(r.notes.length, 1);
  assertStringIncludes(r.notes[0], "$71,050");
  assertStringIncludes(r.notes[0], "$18,000");
  assertStringIncludes(r.notes[0], "1800000");
});

Deno.test("REQ-445 B2 settleQuotePrice: a re-ask that still misses (or fails) is scaled to the stated total in code", async () => {
  const stillWrong = reasker([DEMO_X10]);
  const a = await settleQuotePrice({
    lines: DEMO_X10,
    before: FIRST_DRAFT,
    userText: DEMO_FIX,
    targetCents: 1_800_000,
    reask: stillWrong.reask,
  });
  assertEquals(a.kind, "lines");
  if (a.kind !== "lines") return;
  assertEquals(a.how, "scaled");
  assertEquals(sum(a.lineItems), 1_800_000);
  assertEquals(a.lineItems.length, 11);

  const failed = await settleQuotePrice({
    lines: DEMO_X10,
    before: FIRST_DRAFT,
    userText: DEMO_FIX,
    targetCents: 1_800_000,
    reask: () => Promise.reject(new Error("model down")),
  });
  assertEquals(failed.kind, "lines");
  if (failed.kind !== "lines") return;
  assertEquals(sum(failed.lineItems), 1_800_000);
});

Deno.test("REQ-445 M20 settleQuotePrice: a first draft that ignores the stated '18 mil' ends at $18,000", async () => {
  const r = reasker([FIRST_DRAFT]);
  const out = await settleQuotePrice({
    lines: FIRST_DRAFT,
    userText: DEMO_JOB_ES,
    targetCents: 1_800_000,
    reask: r.reask,
  });
  assertEquals(out.kind, "lines");
  if (out.kind !== "lines") return;
  assertEquals(sum(out.lineItems), 1_800_000);
  assertEquals(r.notes.length, 1);
});

Deno.test("REQ-445 B2 settleQuotePrice: with no stated total, a revision that more than triples with unpriced lines asks the contractor — no re-ask, nothing saved", async () => {
  const r = reasker([]);
  const out = await settleQuotePrice({
    lines: [...FIRST_DRAFT, BENCH, MOLD],
    before: FIRST_DRAFT,
    userText: "add the shower bench and mold remediation allowance",
    reask: r.reask,
  });
  assertEquals(out.kind, "ask");
  assertEquals(r.notes.length, 0);
});

Deno.test("REQ-445 M20 settleQuotePrice: a first draft under the job's floor is re-asked once naming the job size; still under → lifted to the floor", async () => {
  const floor = {
    cents: 1_000_000,
    jobSize: "a bathroom gut / remodel with 11 scope items",
  };
  const better = REASKED_18K;
  const ok = reasker([better]);
  const kept = await settleQuotePrice({
    lines: FIRST_DRAFT,
    userText: "Remodelación del baño principal…",
    floor,
    reask: ok.reask,
  });
  assertEquals(kept, { kind: "lines", how: "reasked", lineItems: better });
  assertStringIncludes(ok.notes[0], "$2,585");
  assertStringIncludes(ok.notes[0], "$10,000");
  assertStringIncludes(ok.notes[0], "bathroom");

  const low = reasker([FIRST_DRAFT]);
  const lifted = await settleQuotePrice({
    lines: FIRST_DRAFT,
    userText: "Remodelación del baño principal…",
    floor,
    reask: low.reask,
  });
  assertEquals(lifted.kind, "lines");
  if (lifted.kind !== "lines") return;
  assertEquals(lifted.how, "lifted");
  assertEquals(sum(lifted.lineItems), 1_000_000);
});

Deno.test("REQ-445 settleQuotePrice: the floor never overrides prices the contractor typed — a total or itemized lines", async () => {
  const r = reasker([]);
  const kitchen = await settleQuotePrice({
    lines: [
      { description: "Demo cabinets", amountCents: 120_000 },
      { description: "Shaker cabinets installed", amountCents: 650_000 },
      { description: "Quartz", amountCents: 380_000 },
      { description: "Electrical", amountCents: 60_000 },
    ],
    userText:
      "Kitchen remodel for the Hendersons. Demo cabinets $1,200, shaker cabinets installed $6,500, quartz $3,800, electrical $600.",
    floor: {
      cents: 1_250_000,
      jobSize: "a kitchen gut / remodel with 4 scope items",
    },
    reask: r.reask,
  });
  assertEquals(kitchen, { kind: "keep" });
  const bath = await settleQuotePrice({
    lines: [{
      description: "Bathroom remodel (labor only)",
      amountCents: 300_000,
    }],
    userText: "Bathroom remodel, labor only, customer buys everything, $3,000",
    floor: { cents: 325_000, jobSize: "a bathroom gut / remodel" },
    reask: r.reask,
  });
  assertEquals(bath, { kind: "keep" });
  assertEquals(r.notes.length, 0);
});

Deno.test("REQ-445 settleQuotePrice: a price that is fine is kept and the model is never asked again", async () => {
  const r = reasker([]);
  const cases = [
    // the stated total, honoured
    {
      lines: REASKED_18K,
      before: FIRST_DRAFT,
      userText: DEMO_FIX,
      targetCents: 1_800_000,
    },
    // a small revision
    {
      lines: [...FIRST_DRAFT, BENCH],
      before: FIRST_DRAFT,
      userText: "add the bench",
    },
    // a first draft over its floor
    {
      lines: REASKED_18K,
      userText: "x",
      floor: { cents: 1_000_000, jobSize: "a bathroom gut / remodel" },
    },
    // a small job: no floor
    {
      lines: [{ description: "Faucet replacement", amountCents: 25_000 }],
      userText: "replace the faucet",
      floor: { cents: 0, jobSize: "" },
    },
    // no price at all is REQ-302's to refuse, not this check's
    {
      lines: [{ description: "x", amountCents: 0 }],
      userText: "price abc",
      targetCents: 50_000,
    },
  ];
  for (const c of cases) {
    assertEquals(await settleQuotePrice({ ...c, reask: r.reask }), {
      kind: "keep",
    });
  }
  assertEquals(r.notes.length, 0);
});

Deno.test("REQ-445 B2 priceJumpAsk: names both totals and the unpriced lines (largest first, at most three) — English and Spanish", () => {
  const jump = revisionJump(FIRST_DRAFT, DEMO_X10, DEMO_FIX)!;
  const en = priceJumpAsk("en", jump);
  assertStringIncludes(en, "$2,585");
  assertStringIncludes(en, "$71,050");
  assertStringIncludes(en, "Mold remediation allowance ($30,000)");
  assertStringIncludes(en, "more");
  assert(!en.includes("Move GFCI outlet"), "only the three largest are named");
  const es = priceJumpAsk("es", jump);
  assertStringIncludes(es, "$71,050");
  assertStringIncludes(es, "Mold remediation allowance ($30,000)");
  assertStringIncludes(es, "más");
  assert(es !== en);
});

// ---------------------------------------------------------------------------
// REQ-575 (demo-loop cycle 4, M3 + M13): one money reader for both sides
// ---------------------------------------------------------------------------

Deno.test("REQ-575 the stated-price money reader IS the shared one — the client's price picker and the suggest-prices floor read 'k' / 'mil' the same way", async () => {
  const shared = await import("#quote-flow/money-amounts.ts");
  assertEquals(moneyAmounts, shared.moneyAmounts);
  // pair 7's spoken Spanish total and her stated costs
  assertEquals(
    moneyAmounts("Ponle precio, no sé, como 18 mil?").map((a) => a.cents),
    [1_800_000],
  );
  assertEquals(
    moneyAmounts(
      "my crew is 3 guys x 3 weeks x $65/hr = ~$23k labor alone, cabinets are $9.5k",
    ).map((a) => [a.cents, a.rate]),
    [[6_500, true], [2_300_000, false], [950_000, false]],
  );
});

// ---------------------------------------------------------------------------
// REQ-578 (demo-loop cycle 4, m34) — no $0.00 line on a stated-price draft.
// Pair 5 typed "Bathroom vanity swap for Derek Chen … $2,400 — actually make
// it $2,250"; gpt-4o-mini split the job into three steps and put the whole
// $2,250 on one of them: "Remove old vanity $0.00 / Install 36in vanity
// $2,250.00 / Install faucet $0.00". The total matched, so nothing touched
// the lines, and the client read two lines of free work.
// ---------------------------------------------------------------------------

const M34_TEXT =
  "Bathroom vanity swap for Derek Chen, remove the old vanity, install a 36in vanity and the faucet, $2,400 — actually make it $2,250";
const M34_LINES: PricedLine[] = [
  { description: "Remove old vanity", amountCents: 0 },
  { description: "Install 36in vanity", amountCents: 225_000 },
  { description: "Install faucet", amountCents: 0 },
];

Deno.test("REQ-578 m34 statedTotalCents: the demo's '$2,400 — actually make it $2,250' is two amounts — no stated total is read (the fold must not depend on it)", () => {
  assertEquals(statedTotalCents(M34_TEXT), undefined);
});

Deno.test("REQ-578 m34 foldZeroLines: the $0 steps fold into the priced line's description, total unchanged", () => {
  assertEquals(foldZeroLines(M34_LINES, "en"), [
    {
      description:
        "Install 36in vanity (incl. remove old vanity, install faucet)",
      amountCents: 225_000,
    },
  ]);
});

Deno.test("REQ-578 m34 foldZeroLines: Spanish wording", () => {
  assertEquals(
    foldZeroLines([
      { description: "Quitar el lavabo viejo", amountCents: 0 },
      { description: "Instalar lavabo de 36 pulgadas", amountCents: 225_000 },
    ], "es"),
    [{
      description:
        "Instalar lavabo de 36 pulgadas (incluye quitar el lavabo viejo)",
      amountCents: 225_000,
    }],
  );
});

Deno.test("REQ-578 m34 foldZeroLines: into the LARGEST priced line; other priced lines and their order stay", () => {
  assertEquals(
    foldZeroLines([
      { description: "Demo", amountCents: 50_000 },
      { description: "Haul-away", amountCents: 0 },
      { description: "Cabinets installed", amountCents: 650_000 },
    ], "en"),
    [
      { description: "Demo", amountCents: 50_000 },
      {
        description: "Cabinets installed (incl. haul-away)",
        amountCents: 650_000,
      },
    ],
  );
});

Deno.test("REQ-578 m34 foldZeroLines: all priced, or nothing priced, comes back unchanged", () => {
  const priced = [
    { description: "A", amountCents: 100 },
    { description: "B", amountCents: 200 },
  ];
  assertEquals(foldZeroLines(priced, "en"), priced);
  const none = [{ description: "Panel swap", amountCents: 0 }];
  assertEquals(foldZeroLines(none, "en"), none);
});

Deno.test("REQ-578 m34 settleCreateQuote: the demo's stated-price draft is saved with no $0.00 line", async () => {
  const out = await settleCreateQuote({
    payload: {
      summary: "Bathroom vanity swap — Derek Chen",
      lineItems: M34_LINES,
    },
    userText: M34_TEXT,
    statedCents: 225_000,
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "save");
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems, [{
    description:
      "Install 36in vanity (incl. remove old vanity, install faucet)",
    amountCents: 225_000,
  }]);
  assertEquals(out.payload.summary, "Bathroom vanity swap — Derek Chen");
});

Deno.test("REQ-578 m34 settleCreateQuote: a $0 lines-scaled-to-the-stated-total draft is folded too", async () => {
  const out = await settleCreateQuote({
    payload: {
      summary: "Vanity swap",
      lineItems: [
        { description: "Remove old vanity", amountCents: 0 },
        { description: "Install 36in vanity", amountCents: 100_000 },
      ],
    },
    userText: M34_TEXT,
    statedCents: 225_000,
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "save");
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems, [{
    description: "Install 36in vanity (incl. remove old vanity)",
    amountCents: 225_000,
  }]);
});

Deno.test("REQ-578 m34 settleCreateQuote: the demo's draft with NO stated total read — its lines add up to the $2,250 typed — is saved with no $0.00 line", async () => {
  const out = await settleCreateQuote({
    payload: { summary: "Vanity swap", lineItems: M34_LINES },
    userText: M34_TEXT,
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "save");
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems.map((l) => l.amountCents), [225_000]);
  assertEquals(
    out.payload.lineItems[0].description,
    "Install 36in vanity (incl. remove old vanity, install faucet)",
  );
});

Deno.test("REQ-578 m34 settleCreateQuote: with no price from the contractor a $0 included line stays (REQ-267)", async () => {
  const out = await settleCreateQuote({
    payload: {
      summary: "Interior repaint",
      lineItems: [
        { description: "Interior walls — 2 coats", amountCents: 180_000 },
        { description: "Paint supplied by Castro Painting", amountCents: 0 },
      ],
    },
    userText: "I'll supply the paint myself",
    draft: {
      summary: "Interior repaint",
      lineItems: [
        { description: "Interior walls — 2 coats", price: 180_000 },
        { description: "Paint (materials)", price: 30_000 },
      ],
    },
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "keep");
});

// ---------------------------------------------------------------------------
// REQ-666 (demo-loop cycle 5, m48) — one typed price is never split evenly
// ---------------------------------------------------------------------------

/** Pair 6's message, as the contractor typed it (fleet-5 stdout:230). */
const M48_TEXT =
  "Cotización para Carmen Núñez: reparar puerta de la cocina y cambiar llave del fregadero, $350";
/** The demo model's answer: the one $350 spread 50/50 (fleet-5 stdout:231). */
const M48_LINES: PricedLine[] = [
  { description: "Reparación de puerta de cocina", amountCents: 17_500 },
  { description: "Cambio de llave del fregadero", amountCents: 17_500 },
];

Deno.test("REQ-666 m48 statedTotalCents: the demo's Carmen sentence is not read as a stated total — the fix must not depend on it", () => {
  assertEquals(statedTotalCents(M48_TEXT), undefined);
  assertEquals(moneyAmounts(M48_TEXT).map((a) => a.cents), [35_000]);
});

Deno.test("REQ-666 m48 settleCreateQuote: the demo's one typed $350 split $175 + $175 is saved as ONE $350 line naming both jobs", async () => {
  const out = await settleCreateQuote({
    payload: {
      summary: "Reparación de puerta — Carmen Núñez",
      lineItems: M48_LINES,
    },
    userText: M48_TEXT,
    lang: "es",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "save");
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems, [{
    description:
      "Reparación de puerta de cocina (incluye cambio de llave del fregadero)",
    amountCents: 35_000,
  }]);
  assertEquals(out.payload.summary, "Reparación de puerta — Carmen Núñez");
});

Deno.test("REQ-666 m48 settleCreateQuote: an uneven split of a single typed '$350 total' is folded too — into the largest line (English)", async () => {
  const out = await settleCreateQuote({
    payload: {
      summary: "Door repair",
      lineItems: [
        { description: "Install faucet", amountCents: 10_000 },
        { description: "Repair kitchen door", amountCents: 25_000 },
      ],
    },
    userText: "Fix the kitchen door and swap the faucet, $350 total",
    statedCents: 35_000,
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "save");
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems, [{
    description: "Repair kitchen door (incl. install faucet)",
    amountCents: 35_000,
  }]);
});

Deno.test("REQ-666 m48 settleCreateQuote: prices the contractor typed per line, a model estimate with no typed price, and a revision of the draft are kept as the model wrote them", async () => {
  // per-line prices typed
  const itemized = await settleCreateQuote({
    payload: {
      summary: "Plumbing repair — Delgado",
      lineItems: [
        { description: "Leak fix under sink", amountCents: 25_000 },
        { description: "New shutoff valve", amountCents: 6_500 },
      ],
    },
    userText:
      "qte for delgado - plumbg leak fix undr sink 250 + new shutoff valve 65",
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(itemized.kind, "keep");
  // no price typed: the model's own estimate per line
  const estimated = await settleCreateQuote({
    payload: { summary: "Door + faucet", lineItems: M48_LINES },
    userText: "reparar puerta de la cocina y cambiar llave del fregadero",
    lang: "es",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(estimated.kind, "keep");
  // a typed amount the lines do not add up to (one line's price)
  const oneLine = await settleCreateQuote({
    payload: {
      summary: "Door + faucet",
      lineItems: [
        { description: "Repair kitchen door", amountCents: 35_000 },
        { description: "Swap faucet", amountCents: 15_000 },
      ],
    },
    userText: "Fix the kitchen door $350 and swap the faucet",
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(oneLine.kind, "keep");
  // a revision of the draft on file, "make it $350": spread over its lines
  const revision = await settleCreateQuote({
    payload: { summary: "Door + faucet", lineItems: M48_LINES },
    userText: "make it $350",
    statedCents: 35_000,
    draft: {
      summary: "Door + faucet",
      lineItems: [
        { description: "Reparación de puerta de cocina", price: 20_000 },
        { description: "Cambio de llave del fregadero", price: 20_000 },
      ],
    },
    lang: "es",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(revision.kind, "keep");
});

// REQ-657 (demo-loop cycle 5, M13) — a folded $0 line does not repeat the host.
// Pair 1 typed "Quote for Linda Johnson, paint living room 15x18, walls and
// ceiling, 2 coats, $1,450 total" (fleet-0 stdout l.226); gpt-4o-mini sent a
// priced line and a $0 near-copy of it, and REQ-578's fold wrote the detail
// twice: "Living room painting (270 sqft, 2 coats, paint supplied by
// contractor) (incl. walls and ceiling painting (270 sqft, 2 coats, paint
// supplied by contractor))".
const M13_TEXT =
  "Quote for Linda Johnson, paint living room 15x18, walls and ceiling, 2 coats, $1,450 total";
const M13_LINES: PricedLine[] = [
  {
    description:
      "Living room painting (270 sqft, 2 coats, paint supplied by contractor)",
    amountCents: 145_000,
  },
  {
    description:
      "Walls and ceiling painting (270 sqft, 2 coats, paint supplied by contractor)",
    amountCents: 0,
  },
];

Deno.test("REQ-657 M13 foldZeroLines: the demo's $0 line folds without repeating the detail the host already carries", () => {
  assertEquals(statedTotalCents(M13_TEXT), 145_000);
  assertEquals(foldZeroLines(M13_LINES, "en"), [{
    description:
      "Living room painting (270 sqft, 2 coats, paint supplied by contractor) (incl. walls and ceiling painting)",
    amountCents: 145_000,
  }]);
});

Deno.test("REQ-657 M13 foldZeroLines: a $0 line that only restates the host is dropped, not folded", () => {
  assertEquals(
    foldZeroLines([
      {
        description: "Living room painting (270 sqft, 2 coats)",
        amountCents: 145_000,
      },
      { description: "Painting of the living room (2 coats)", amountCents: 0 },
      { description: "Patch nail holes", amountCents: 0 },
    ], "en"),
    [{
      description:
        "Living room painting (270 sqft, 2 coats) (incl. patch nail holes)",
      amountCents: 145_000,
    }],
  );
  assertEquals(
    foldZeroLines([
      { description: "Pintura de sala (2 manos)", amountCents: 145_000 },
      { description: "Pintura de la sala", amountCents: 0 },
    ], "es"),
    [{ description: "Pintura de sala (2 manos)", amountCents: 145_000 }],
  );
});

Deno.test("REQ-657 M13 foldZeroLines: a parenthetical with detail the host lacks is kept", () => {
  assertEquals(
    foldZeroLines([
      { description: "Living room painting (2 coats)", amountCents: 145_000 },
      { description: "Ceiling painting (flat white)", amountCents: 0 },
    ], "en"),
    [{
      description:
        "Living room painting (2 coats) (incl. ceiling painting (flat white))",
      amountCents: 145_000,
    }],
  );
});

Deno.test("REQ-657 M13 settleCreateQuote: the demo's $1,450-total draft is saved as one line with no repeated detail", async () => {
  const out = await settleCreateQuote({
    payload: {
      summary: "Living room painting — Linda Johnson",
      lineItems: M13_LINES,
    },
    userText: M13_TEXT,
    statedCents: statedTotalCents(M13_TEXT),
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "save");
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems, [{
    description:
      "Living room painting (270 sqft, 2 coats, paint supplied by contractor) (incl. walls and ceiling painting)",
    amountCents: 145_000,
  }]);
});

// ---------------------------------------------------------------------------
// REQ-762 (demo-loop cycle 5v2, m48 re-verified) — one typed price repeated on
// every job is one line too
// ---------------------------------------------------------------------------

/** The verifier's try 2 on the merged demo-fixes, as typed. */
const M48V2_TEXT =
  "Cotización para Rosa Delgado: cambiar el calentador de agua y reparar la llave de la regadera, $900";
/** What the model drafted: the one $900 on BOTH jobs, $1,800 in all. */
const M48V2_LINES: PricedLine[] = [
  { description: "Cambio de calentador de agua", amountCents: 90_000 },
  { description: "Reparación de llave de regadera", amountCents: 90_000 },
];

Deno.test("REQ-762 m48 settleCreateQuote: the verifier's one typed $900 put on both jobs ($900 + $900 = $1,800) is saved as ONE $900 line naming both", async () => {
  const out = await settleCreateQuote({
    payload: {
      summary: "Calentador y regadera — Rosa Delgado",
      lineItems: M48V2_LINES,
    },
    userText: M48V2_TEXT,
    lang: "es",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "save");
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems, [{
    description:
      "Cambio de calentador de agua (incluye reparación de llave de regadera)",
    amountCents: 90_000,
  }]);
});

Deno.test("REQ-762 m48 settleCreateQuote: the typed price repeated on three jobs beside a $0 line is one line at that price (English)", async () => {
  const out = await settleCreateQuote({
    payload: {
      summary: "Plumbing — Delgado",
      lineItems: [
        { description: "Replace water heater", amountCents: 90_000 },
        { description: "Fix shower faucet", amountCents: 90_000 },
        { description: "Haul away old heater", amountCents: 0 },
        { description: "Check shutoff valves", amountCents: 90_000 },
      ],
    },
    userText:
      "Quote for Rosa Delgado: replace the water heater, fix the shower faucet and check the shutoffs, $900",
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(out.kind, "save");
  if (out.kind !== "save") return;
  assertEquals(out.payload.lineItems.length, 1);
  assertEquals(out.payload.lineItems[0].amountCents, 90_000);
  assertEquals(
    out.payload.lineItems[0].description,
    "Replace water heater (incl. fix shower faucet, haul away old heater, check shutoff valves)",
  );
});

Deno.test("REQ-762 m48 settleCreateQuote: one job at the typed price beside a job the model priced itself, and a draft revision repeating a price, are kept", async () => {
  const partial = await settleCreateQuote({
    payload: {
      summary: "Heater + faucet",
      lineItems: [
        { description: "Replace water heater", amountCents: 90_000 },
        { description: "Fix shower faucet", amountCents: 15_000 },
      ],
    },
    userText: "Replace the water heater $900 and fix the shower faucet",
    lang: "en",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(partial.kind, "keep");
  const revision = await settleCreateQuote({
    payload: { summary: "Heater + faucet", lineItems: M48V2_LINES },
    userText: "la llave de la regadera también $900",
    draft: {
      summary: "Heater + faucet",
      lineItems: [
        { description: "Cambio de calentador de agua", price: 90_000 },
        { description: "Reparación de llave de regadera", price: 20_000 },
      ],
    },
    lang: "es",
    reask: () => Promise.resolve(undefined),
  });
  assertEquals(revision.kind, "keep");
});
