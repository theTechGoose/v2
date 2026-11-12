/**
 * REQ-658 — demo-loop cycle 5 (run r37f88707), issues m51 "'Break down labor
 * vs materials' only re-prices" and M17 "Assistant reply fails with 200".
 *
 * On Pick a price, "break down labor vs materials please" had no '?' and no
 * question opener, so `priceStepIntent` sent it to the re-pricer, which only
 * re-rolled the three tiers (fleet-6 stdout:305). And the demo's message
 * ("how did you get 17,500? 85/hr + cost+15%, break down labor vs
 * materials... make it around 18k") lost its stated price to the '%'.
 *
 * Now breakdown / explain wording goes to the chat model ("ask"), the model's
 * context tells it to split the tiers into labor and materials with the
 * contractor's own rate and markup, and the stated price survives.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { asksForBreakdown, priceStepContext, priceStepIntent } from "./mod.ts";

const DEMO =
  "how did you get 17,500? 85/hr + cost+15%, break down labor vs materials... make it around 18k";

Deno.test("REQ-658 m51 priceStepIntent: 'break down labor vs materials please' is answered, never re-priced", () => {
  assertEquals(priceStepIntent("break down labor vs materials please"), {
    route: "ask",
    scopeChange: false,
    statedCents: null,
  });
});

Deno.test("REQ-658 m51 priceStepIntent: breakdown / explain wording, English and Spanish, goes to the chat model", () => {
  for (
    const s of [
      "break down labor vs materials please",
      "breakdown of the market price",
      "split labor and materials",
      "labor vs materials",
      "show me labor and materials separately",
      "explain the premium tier",
      "how did you get 17,500",
      "how'd you come up with that",
      "desglosa mano de obra y materiales",
      "dame el desglose",
      "mano de obra vs materiales",
    ]
  ) {
    assertEquals(priceStepIntent(s).route, "ask", s);
    assertEquals(asksForBreakdown(s), true, s);
  }
});

Deno.test("REQ-658 M17 priceStepIntent: the demo's message is answered AND its stated $18,000 goes in the box", () => {
  assertEquals(priceStepIntent(DEMO), {
    route: "ask",
    scopeChange: false,
    statedCents: 1_800_000,
  });
  assertEquals(asksForBreakdown(DEMO), true);
});

Deno.test("REQ-658 asksForBreakdown: a plain price correction or a scope add is not a breakdown", () => {
  for (
    const s of [
      "too low, this is a full gut",
      "more like $28k",
      "add the permit",
      "is the quartz slab included",
      "no, my price is $4,500 total",
    ]
  ) {
    assertEquals(asksForBreakdown(s), false, s);
  }
  assertEquals(priceStepIntent("too low, this is a full gut").route, "reprice");
});

Deno.test("REQ-658 m51 priceStepContext: a breakdown ask tells the model to split each tier into labor and materials with the contractor's own rate and markup", () => {
  const ctx = priceStepContext({
    job: "Kitchen gut",
    lang: "en",
    options: [
      { label: "Competitive", priceCents: 1_750_000 },
      { label: "Market", priceCents: 2_000_000 },
    ],
    breakdown: true,
  });
  const lower = ctx.toLowerCase();
  assertStringIncludes(lower, "labor");
  assertStringIncludes(lower, "materials");
  assertStringIncludes(lower, "hourly rate");
  assertStringIncludes(lower, "markup");
  assertStringIncludes(lower, "estimate");
  const plain = priceStepContext({
    job: "Kitchen gut",
    lang: "en",
    options: [{ label: "Market", priceCents: 2_000_000 }],
  });
  assert(!plain.toLowerCase().includes("hourly rate"), plain);
});
