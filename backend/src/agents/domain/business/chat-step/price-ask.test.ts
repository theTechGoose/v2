/**
 * REQ-444 (demo-loop cycle 3, M21) — "The assistant ignores questions and
 * says changes are done when they are not". On Pick a price, pair 7 asked
 * "does this include the quartz slab material or just labor?? … ¿y el precio
 * incluye el permiso de plomería? add permit if not" and got only "Re-priced
 * with your note — Competitive $17,000 · Market $20,000 · Premium $24,000.":
 * every text typed on that step went to the pricing engine (REQ-392).
 *
 * The pure rules: `priceStepIntent` sends a question or a change to the job to
 * the chat model and keeps only a price correction for the pricing engine;
 * `priceStepContext` is what that model answers from — the job, the details
 * and the tiers on screen, and what the tiers include.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { priceStepContext, priceStepIntent } from "./mod.ts";

const DEMO_QUESTION =
  "does this include the quartz slab material or just labor?? also 48 sqft of quartz. ¿y el precio incluye el permiso de plomería? add permit if not";
const REQ392_FIX =
  "No that's wrong, it's the WHOLE gut job incl. heated floor, vanity, glass, drain move — more like $28k";

Deno.test("REQ-444 priceStepIntent: the demo's question (quartz? permit? add it if not) goes to the chat model — never to the re-pricer", () => {
  assertEquals(priceStepIntent(DEMO_QUESTION), {
    route: "ask",
    scopeChange: true,
    statedCents: null,
  });
});

Deno.test("REQ-444 priceStepIntent: a question — '?', '¿…?', an interrogative opener, 'is X included' — is answered", () => {
  for (
    const q of [
      "is the quartz slab included",
      "does this include haul away",
      "what does the market price cover",
      "why is premium so much higher",
      "¿incluye el material?",
      "cuánto cobro por el permiso",
      "the permit is in there, right?",
      "Is demo included in these?",
    ]
  ) {
    const r = priceStepIntent(q);
    assertEquals(r.route, "ask", q);
    assertEquals(r.scopeChange, false, q);
    assertEquals(r.statedCents, null, q);
  }
});

Deno.test("REQ-444 priceStepIntent: a change to the job — add / include / remove / missing, English and Spanish — goes to the chat model, which can change the details on screen", () => {
  for (
    const s of [
      "add a plumbing permit",
      "Add the dumpster",
      "include the haul away",
      "remove the vanity",
      "take out the backsplash",
      "you forgot the permit",
      "the permit is missing",
      "also add a 20 yard dumpster",
      "agrega el permiso de plomería",
      "añade la limpieza final",
      "falta el permiso",
      "quita el tocador",
      "it looks right, but add the permit",
    ]
  ) {
    const r = priceStepIntent(s);
    assertEquals(r.route, "ask", s);
    assertEquals(r.scopeChange, true, s);
  }
});

Deno.test("REQ-444 priceStepIntent: a price correction still re-prices (REQ-392's demo words) and keeps the price it names for the box", () => {
  assertEquals(priceStepIntent(REQ392_FIX), {
    route: "reprice",
    scopeChange: false,
    statedCents: 2_800_000,
  });
  assertEquals(
    priceStepIntent("it's the whole gut job, more like $28,000").route,
    "reprice",
  );
  assertEquals(
    priceStepIntent("too low, this is a full gut").route,
    "reprice",
  );
  assertEquals(priceStepIntent("no, my price is $4,500 total"), {
    route: "reprice",
    scopeChange: false,
    statedCents: 450_000,
  });
  assertEquals(priceStepIntent("es todo el trabajo, más bien $28k"), {
    route: "reprice",
    scopeChange: false,
    statedCents: 2_800_000,
  });
  // "incl." is a note on what is being priced, not an add.
  assertEquals(priceStepIntent(REQ392_FIX).scopeChange, false);
});

Deno.test("REQ-444 priceStepIntent: the price of an item being added never fills the price box; the job's price named before the add still does", () => {
  assertEquals(priceStepIntent("add the permit, it's $450"), {
    route: "ask",
    scopeChange: true,
    statedCents: null,
  });
  assertEquals(
    priceStepIntent("agrega el permiso, son $450").statedCents,
    null,
  );
  assertEquals(priceStepIntent("add $2k for the dumpster").statedCents, null);
  assertEquals(priceStepIntent("make it $21k and add the permit"), {
    route: "ask",
    scopeChange: true,
    statedCents: 2_100_000,
  });
});

Deno.test("REQ-444 priceStepIntent: a question that names the job's price is answered, and the price still goes in the box", () => {
  assertEquals(priceStepIntent("can you make it $18,500?"), {
    route: "ask",
    scopeChange: false,
    statedCents: 1_850_000,
  });
  // A price mentioned in a question is not a cue ("does $20k cover …").
  assertEquals(
    priceStepIntent("does $20k cover the permit?").statedCents,
    null,
  );
});

Deno.test("REQ-444 priceStepIntent: empty or junk is a plain correction (REQ-392 behaviour)", () => {
  assertEquals(priceStepIntent("").route, "reprice");
  assertEquals(priceStepIntent("   ").route, "reprice");
});

const TIERS = [
  {
    label: "Competitive",
    priceCents: 1_700_000,
    rationale: "Basic kitchen refresh",
  },
  {
    label: "Market",
    priceCents: 2_000_000,
    rationale: "Typical Austin kitchen remodel pricing",
  },
  { label: "Premium", priceCents: 2_400_000, rationale: "Top-tier finish" },
];
const SCOPE =
  "Demo existing kitchen\nInstall shaker cabinets (customer-supplied, labor only)\nInstall quartz countertop, 48 sq ft\nNew drain line thru slab to island (trench + patch)";

Deno.test("REQ-444 priceStepContext: the job as typed, the details on screen, the tiers on screen and what they include — what the model answers from", () => {
  const ctx = priceStepContext({
    job: "Kitchen gut for the Hendersons, IKEA shaker cabinets they buy",
    scope: SCOPE,
    lang: "en",
    options: TIERS,
    basis: "labor_materials_as_noted",
  });
  assertStringIncludes(ctx, "Pick a price");
  assertStringIncludes(ctx, "no quote");
  assertStringIncludes(ctx, "Kitchen gut for the Hendersons");
  assertStringIncludes(ctx, "Install quartz countertop, 48 sq ft");
  assertStringIncludes(ctx, "Competitive $17,000");
  assertStringIncludes(ctx, "Market $20,000");
  assertStringIncludes(ctx, "Premium $24,000");
  assertStringIncludes(ctx, "Typical Austin kitchen remodel pricing");
  assertStringIncludes(
    ctx,
    t("en", "suggestPrices.basis.laborMaterialsAsNoted"),
  );
  assertStringIncludes(ctx, "(en)", "the language the details are written in");
});

Deno.test("REQ-444 priceStepContext: a price the contractor named is said; no tiers on screen (I know my price) is said too", () => {
  const ctx = priceStepContext({
    job: "Fence repair, 40 ft",
    lang: "es",
    statedCents: 450_000,
  });
  assertStringIncludes(ctx, "Fence repair, 40 ft");
  assertStringIncludes(ctx, "$4,500");
  assert(!ctx.includes("Market $"), ctx);
  assertStringIncludes(ctx.toLowerCase(), "no suggested prices");
  assertStringIncludes(ctx, "(es)");
});
