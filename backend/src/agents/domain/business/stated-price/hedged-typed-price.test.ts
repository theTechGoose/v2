/**
 * REQ-1097 (LOOP-007 cycle 3, q3-22) — a hedged typed price ("materials
 * around 600 labor 1400") is never billed twice.
 *
 * Q-003 (r0c106d7f fleet-1 stdout:51): the model drafted deck $2,000 (600 +
 * 1,400 folded) + gutters $175. `labelledAmounts` could not read "materials
 * around 600" (hedge word between label and number), so REQ-1023's
 * `missedTypedPrices` saw only "labor 1400", reported it missed, re-asked,
 * and the model added a separate "Labor for deck refinishing $1,400": the
 * draft saved at $3,575 instead of $2,175.
 */
import { assert, assertEquals } from "#std/assert";
import { labelledAmounts } from "#quote-flow/money-amounts.ts";
import {
  missedTypedPrices,
  type PricedLine,
  settleCreateQuote,
} from "./mod.ts";

/** The tester's exact message. */
const Q3_22_MSG =
  "ok so maria lopez again, she also wants the back deck done. its about 14x20, sand it down, replace like 6 boards maybe 8, then 2 coats of semi transparent stain. materials around 600 labor 1400. also she asked about the gutters - clean them 175. give her a good/better: good = deck only, better = deck + gutters";

/** The model's first draft: deck carries materials + labor. */
const DRAFT: PricedLine[] = [
  {
    description:
      "Deck refinishing (sand down, replace 6-8 boards, 2 coats of semi-transparent stain)",
    amountCents: 200_000,
  },
  { description: "Gutter cleaning", amountCents: 17_500 },
];

const labelled = (s: string) =>
  labelledAmounts(s).map((a) => [a.label, a.cents]);

Deno.test("REQ-1097 q3-22 labelledAmounts: 'materials around 600 labor 1400' reads materials 60000 and labor 140000 (the unlabelled 175 stays unlabelled)", () => {
  const got = labelled(Q3_22_MSG);
  assert(
    got.some(([l, c]) => l === "materials" && c === 60_000),
    `materials 60000 — got ${JSON.stringify(got)}`,
  );
  assert(
    got.some(([l, c]) => l === "labor" && c === 140_000),
    `labor 140000 — got ${JSON.stringify(got)}`,
  );
  assert(
    !got.some(([l, c]) => l && c === 17_500),
    `175 has no label — got ${JSON.stringify(got)}`,
  );
});

Deno.test("REQ-1097 q3-22 missedTypedPrices: deck $2,000 (600 + 1,400 folded) + gutters $175 misses nothing", () => {
  assertEquals(
    missedTypedPrices(DRAFT, Q3_22_MSG).map((a) => [a.label, a.cents]),
    [],
  );
});

Deno.test("REQ-1097 q3-22 missedTypedPrices: 'materials ~600 labor 1400' folded into $2,000 misses nothing", () => {
  const msg = Q3_22_MSG.replace("materials around 600", "materials ~600");
  assertEquals(
    missedTypedPrices(DRAFT, msg).map((a) => [a.label, a.cents]),
    [],
  );
});

Deno.test("REQ-1097 q3-22 missedTypedPrices: Spanish 'materiales unos 600 mano de obra 1400' folded into $2,000 misses nothing", () => {
  const msg =
    "terraza de 14x20, lijar, cambiar 6 tablas, 2 manos de tinte. materiales unos 600 mano de obra 1400. y limpiar las canaletas 175";
  assertEquals(
    missedTypedPrices(DRAFT, msg).map((a) => [a.label, a.cents]),
    [],
  );
});

Deno.test("REQ-1097 q3-22 settleCreateQuote: the $2,175 first draft is kept as written — no re-ask, no extra $1,400 labor line", async () => {
  let asked = 0;
  const notes: string[] = [];
  const out = await settleCreateQuote({
    payload: { summary: "Deck refinishing — Maria Lopez", lineItems: DRAFT },
    userText: Q3_22_MSG,
    lang: "en",
    reask: (turns) => {
      asked++;
      notes.push(turns[turns.length - 1].content);
      return Promise.resolve([
        ...DRAFT,
        { description: "Labor for deck refinishing", amountCents: 140_000 },
      ]);
    },
  });
  assertEquals(
    asked,
    0,
    `the model is never re-asked about labor — re-ask: ${notes.join(" | ")}`,
  );
  if (out.kind === "save") {
    const total = out.payload.lineItems.reduce((s, l) => s + l.amountCents, 0);
    assertEquals(total, 217_500, JSON.stringify(out.payload.lineItems));
  } else {
    assertEquals(out.kind, "keep");
  }
});
