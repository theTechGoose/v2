/**
 * REQ-651 (demo-loop cycle 5, B1) — a price stated in words must not come
 * out too LOW.
 *
 * Pair 8: on a $12,000 cedar-fence draft ("150 ft of 6 ft cedar privacy
 * fence with one gate") the contractor typed "too high. I get $55 a foot,
 * gate is $450. break it out please". gpt-4o-mini re-drafted the fence line
 * at amountCents 8250 — 55 × 150 as dollars passed as cents — and the quote
 * was saved at $532.50 (fleet-7 stdout:318). Neither guard looked down:
 * revisionJump only flagged a total over 3× the old one, and the floor took
 * the RATE "$55 a foot" as one of the contractor's own prices (5,500 +
 * 45,000 is within 15% of 53,250).
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import {
  fixRateSlips,
  type PricedLine,
  priceJumpAsk,
  revisionJump,
  settleCreateQuote,
  settleQuotePrice,
} from "./mod.ts";

/** Pair 8's message (fleet-7 stdout:304). */
const PAIR8_TEXT =
  "too high. I get $55 a foot, gate is $450. break it out please";
/** The draft on file: one $12,000 line (fleet-7 stdout:302). */
const PAIR8_DRAFT = {
  summary: "Cedar privacy fence installation",
  lineItems: [{
    description:
      "Cedar privacy fence installation (150 ft, 6 ft high) with one gate",
    price: 1_200_000,
    quantity: 1,
  }],
};
/** The model's re-draft (fleet-7 stdout:318): fence $82.50, gate $450. */
const PAIR8_LINES: PricedLine[] = [
  {
    description: "Cedar privacy fence installation (150 ft, 6 ft high)",
    amountCents: 8_250,
  },
  { description: "Cedar gate installation", amountCents: 45_000 },
];
const sum = (ls: readonly PricedLine[]) =>
  ls.reduce((s, l) => s + l.amountCents, 0);
const noReask = () => Promise.resolve(undefined);

Deno.test("REQ-651 B1 fixRateSlips: '$55 a foot' on a 150 ft line saved at $82.50 is the ×100 slip — the line becomes $8,250", () => {
  assertEquals(fixRateSlips(PAIR8_LINES, PAIR8_TEXT), [
    {
      description: "Cedar privacy fence installation (150 ft, 6 ft high)",
      amountCents: 825_000,
    },
    { description: "Cedar gate installation", amountCents: 45_000 },
  ]);
});

Deno.test("REQ-651 B1 fixRateSlips: a ×10 slip, a quantity typed in the message and a sq ft rate are fixed too", () => {
  // ×10, the quantity in the line
  assertEquals(
    fixRateSlips(
      [{ description: "Fence (150 ft)", amountCents: 82_500 }],
      "$55 a foot",
    )?.[0].amountCents,
    825_000,
  );
  // the quantity typed in the message, the line names none
  assertEquals(
    fixRateSlips(
      [{ description: "Cedar fence", amountCents: 8_250 }],
      "150 ft of cedar fence at $55 per foot",
    )?.[0].amountCents,
    825_000,
  );
  // a sq ft rate on a sq ft line — never the "6 ft" of a height
  assertEquals(
    fixRateSlips(
      [{ description: "Tile floor, 64 sqft", amountCents: 1_600 }],
      "$25 per sq ft",
    )?.[0].amountCents,
    160_000,
  );
});

Deno.test("REQ-651 B1 fixRateSlips: a line already at rate × qty, a line that is no slip of it, or no rate typed — nothing changes", () => {
  // right already
  assertEquals(
    fixRateSlips(
      [{ description: "Fence (150 ft)", amountCents: 825_000 }],
      "$55 a foot",
    ),
    undefined,
  );
  // $9,000 for 150 ft at $55 — the contractor's own extras; not a slip
  assertEquals(
    fixRateSlips(
      [{ description: "Fence (150 ft)", amountCents: 900_000 }],
      "$55 a foot",
    ),
    undefined,
  );
  // no rate typed
  assertEquals(fixRateSlips(PAIR8_LINES, "gate is $450"), undefined);
  // an hourly rate never prices a length
  assertEquals(
    fixRateSlips(
      [{ description: "Fence (150 ft)", amountCents: 8_250 }],
      "$55 an hour",
    ),
    undefined,
  );
});

Deno.test("REQ-651 B1 revisionJump: a revision that drops the total under a third with prices nobody typed is a jump (down)", () => {
  const before: PricedLine[] = [{
    description: PAIR8_DRAFT.lineItems[0].description,
    amountCents: 1_200_000,
  }];
  const jump = revisionJump(before, PAIR8_LINES, PAIR8_TEXT);
  assert(jump, "a $12,000 → $532.50 revision must be caught");
  assertEquals([jump.fromCents, jump.toCents], [1_200_000, 53_250]);
  assertEquals(jump.unpriced.map((l) => l.amountCents), [8_250]);
  // the drop the contractor typed, or a line removed, is no jump
  assertEquals(
    revisionJump(
      before,
      [{ description: "Fence", amountCents: 300_000 }],
      "make it $3,000",
    ),
    undefined,
  );
  assertEquals(
    revisionJump(
      [...before, { description: "Deck", amountCents: 4_000_000 }],
      before,
      "drop the deck",
    ),
    undefined,
  );
});

Deno.test("REQ-651 B1 priceJumpAsk: a drop says the total would fall, never 'more than 3 times' — English and Spanish", () => {
  const jump = revisionJump(
    [{ description: "Fence", amountCents: 1_200_000 }],
    PAIR8_LINES,
    PAIR8_TEXT,
  )!;
  const en = priceJumpAsk("en", jump);
  assertStringIncludes(en, "$12,000");
  assertStringIncludes(en, "$532.50");
  assertStringIncludes(en, "less than a third");
  assert(!en.includes("more than 3 times"), en);
  const es = priceJumpAsk("es", jump);
  assertStringIncludes(es, "menos de un tercio");
  assert(!es.includes("más del triple"), es);
});

Deno.test("REQ-651 B1 settleQuotePrice: a typed RATE is not the contractor's price — a first draft under the floor is still re-asked", async () => {
  const notes: string[] = [];
  const out = await settleQuotePrice({
    // no quantity anywhere: nothing for rate × qty to fix
    lines: [
      { description: "Cedar privacy fence", amountCents: 8_250 },
      { description: "Cedar gate installation", amountCents: 45_000 },
    ],
    userText: "I get $55 a foot, gate is $450",
    floor: { cents: 325_000, jobSize: "150 ft of fence" },
    reask: (note) => {
      notes.push(note);
      return Promise.resolve(undefined);
    },
  });
  assertEquals(notes.length, 1, "the floor must judge the model's $82.50");
  assertEquals(out.kind, "lines");
});

for (const variant of ["same job", "a different summary"] as const) {
  Deno.test(`REQ-651 B1 settleCreateQuote: pair 8's re-draft (${variant}) is saved at $8,250 + $450 = $8,700 — never $532.50`, async () => {
    const out = await settleCreateQuote({
      payload: {
        summary: variant === "same job"
          ? PAIR8_DRAFT.summary
          : "Cedar fence and gate — Johnson",
        lineItems: PAIR8_LINES,
      },
      userText: PAIR8_TEXT,
      draft: variant === "same job"
        ? PAIR8_DRAFT
        : { ...PAIR8_DRAFT, summary: "Fence" },
      lang: "en",
      reask: noReask,
    });
    assertEquals(out.kind, "save", JSON.stringify(out));
    if (out.kind !== "save") return;
    assertEquals(out.payload.lineItems.map((l) => l.amountCents), [
      825_000,
      45_000,
    ]);
    assertEquals(sum(out.payload.lineItems), 870_000);
  });
}
