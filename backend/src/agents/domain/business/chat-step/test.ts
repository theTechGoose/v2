/**
 * REQ-392 (demo-loop cycle 2, M7) — the pure rules behind a message typed in
 * the compact "Tell the assistant…" box on a guided step: what the pricing and
 * job-options engines read on a correction, the line the chat model reads on a
 * wizard question / the Ready-to-send review, the tools it may call there, and
 * the server's own reply on the two pre-quote steps.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import {
  isFallbackPricing,
  jobOptionsStepReply,
  priceStepReply,
  stepContextLine,
  stepJobOptionsRaw,
  stepLangs,
  stepScopeText,
  stepTools,
} from "./mod.ts";

const DEMO_FIX =
  "No that's wrong, it's the WHOLE gut job incl. heated floor, vanity, glass, drain move — more like $28k";

Deno.test("REQ-392 stepScopeText: the correction rides beside the confirmed bullets and wins where they disagree", () => {
  const s = stepScopeText(
    "Remove the tub\nCurbless shower\nTile 12x24",
    DEMO_FIX,
  );
  assertStringIncludes(s, "Remove the tub\nCurbless shower\nTile 12x24");
  assertStringIncludes(s, DEMO_FIX);
  assertStringIncludes(s.toLowerCase(), "overrides");
  // No confirmed bullets (the known-price flow): the correction alone.
  assertStringIncludes(stepScopeText(undefined, DEMO_FIX), DEMO_FIX);
});

Deno.test("REQ-392 stepJobOptionsRaw: the job, the version on screen and the correction, in that order", () => {
  const raw = stepJobOptionsRaw(
    "Master bath remodel for the Gutierrez family",
    "Remove the tub\nCurbless shower",
    "add the heated floor and the permit",
  );
  const job = raw.indexOf("Master bath remodel");
  const shown = raw.indexOf("Remove the tub");
  const fix = raw.indexOf("add the heated floor");
  assert(job >= 0 && shown > job && fix > shown, raw);
  // Nothing on screen yet: job + correction.
  const bare = stepJobOptionsRaw("Fence repair", undefined, "it's 60 ft");
  assertStringIncludes(bare, "Fence repair");
  assertStringIncludes(bare, "it's 60 ft");
});

Deno.test("REQ-392 stepContextLine: a wizard question is named; the review is a change to the quote; the pre-quote steps add nothing", () => {
  const wiz = stepContextLine({ id: "wizard", wizardStepId: "customer" }, {
    question: "Who is this for?",
  });
  assertStringIncludes(wiz ?? "", "Who is this for?");
  const review = stepContextLine({ id: "review" }) ?? "";
  assertStringIncludes(review, "Ready to send");
  assertStringIncludes(review, "update_job_details");
  assertStringIncludes(review, "revise_quote");
  assertEquals(stepContextLine({ id: "price" }), undefined);
  assertEquals(stepContextLine(undefined), undefined);
});

Deno.test("REQ-392 stepTools: the review may revise a line; every other turn keeps the tools it had", () => {
  const terms = ["change_order", "update_job_details"] as const;
  assertEquals(stepTools(terms, { id: "review" }), [
    "change_order",
    "update_job_details",
    "revise_quote",
  ]);
  assertEquals(stepTools(terms, { id: "wizard", wizardStepId: "customer" }), [
    "change_order",
    "update_job_details",
  ]);
  assertEquals(stepTools(terms, undefined), [
    "change_order",
    "update_job_details",
  ]);
  // never twice
  assertEquals(
    stepTools(["revise_quote", "update_job_details"], { id: "review" }),
    ["revise_quote", "update_job_details"],
  );
});

Deno.test("REQ-392 priceStepReply: re-priced tiers, and the price the contractor named put in the box", () => {
  const options = [
    { label: "Competitive", priceCents: 2_450_000, rationale: "" },
    { label: "Market", priceCents: 2_800_000, rationale: "" },
    { label: "Premium", priceCents: 3_200_000, rationale: "" },
  ];
  const both = priceStepReply("en", {
    tiers: true,
    options,
    statedCents: 2_800_000,
  });
  assertStringIncludes(both, "Competitive $24,500");
  assertStringIncludes(both, "Market $28,000");
  assertStringIncludes(both, "Premium $32,000");
  assertStringIncludes(both, "$28,000 in the price box");
  const es = priceStepReply("es", { tiers: true, options });
  assertStringIncludes(es, "Recalculé");
  // The known-price screen has no tiers: the named price, or an ask for one.
  assertStringIncludes(
    priceStepReply("en", { tiers: false, statedCents: 450_000 }),
    "$4,500 in the price box",
  );
  assertStringIncludes(
    priceStepReply("en", { tiers: false }),
    "Type your price",
  );
});

/** The pricing engine's own generic tiers (its answer when the model can't
 *  be reached or answers junk), in one language. */
const GENERIC = (lang: "en" | "es") =>
  (["competitive", "market", "premium"] as const).map((tier, i) => ({
    tier,
    label: tier,
    priceCents: [50_000, 85_000, 120_000][i],
    rationale: t(lang, `suggestPrices.fallback.${tier}Rationale`),
  }));

Deno.test("REQ-392 isFallbackPricing: the engine's generic tiers (either language, lifted or not) are recognised; the model's own are not", () => {
  assert(isFallbackPricing(GENERIC("en")));
  assert(isFallbackPricing(GENERIC("es")));
  assert(
    isFallbackPricing(
      GENERIC("en").map((o) => ({ ...o, priceCents: o.priceCents * 12 })),
    ),
    "a floor lift keeps them generic",
  );
  assert(
    !isFallbackPricing([
      { ...GENERIC("en")[0], rationale: "Gut + floor" },
      ...GENERIC("en").slice(1),
    ]),
  );
  assert(!isFallbackPricing([]));
});

Deno.test("REQ-392 priceStepReply: when the correction couldn't be re-priced it says so — no 'Re-priced' over generic tiers — and still fills the named price", () => {
  const named = priceStepReply("en", {
    tiers: true,
    options: GENERIC("en"),
    statedCents: 2_800_000,
  });
  assertStringIncludes(named, "couldn't re-price");
  assertStringIncludes(named, "$28,000 in the price box");
  assert(!named.includes("Re-priced"), named);
  assert(!named.includes("$500"), named);
  const bare = priceStepReply("en", { tiers: true, options: GENERIC("en") });
  assertStringIncludes(bare, "couldn't re-price");
  assertStringIncludes(bare, "tell me your price");
  assertStringIncludes(
    priceStepReply("es", { tiers: true, options: GENERIC("es") }),
    "No pude recalcular",
  );
});

Deno.test("REQ-392 jobOptionsStepReply: rewritten versions, said honestly when the writer was unavailable", () => {
  assertStringIncludes(jobOptionsStepReply("en", false), "Rewrote");
  assertStringIncludes(jobOptionsStepReply("en", true), "couldn't");
  assertStringIncludes(jobOptionsStepReply("es", false), "Reescribí");
});

Deno.test("REQ-392 stepLangs: the app language first, then the comms languages, then any language the correction asks for", () => {
  assertEquals(stepLangs("en", ["en"], "make it shorter"), ["en"]);
  assertEquals(stepLangs("en", ["en"], "write it in Spanish and English"), [
    "en",
    "es",
  ]);
  assertEquals(stepLangs("es", ["en"], ""), ["es", "en"]);
});
