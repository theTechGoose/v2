import { assert, assertEquals } from "#std/assert";
import { SuggestPrices } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";

// REQ-017 — NW-08 / NW-09 / NW-12 (p7, p21): "Help me price it" shows
// Competitive / Market / Premium with the client's definitions, prices for
// the contractor's ZIP, and says that prices include labor and materials.

function fresh() {
  const llm = new StubLLMClient();
  return { llm, flow: new SuggestPrices(llm) };
}

const MODEL_JSON = JSON.stringify({
  options: [
    { tier: "competitive", label: "Basic", priceCents: 300000, rationale: "Straightforward interior repaint" },
    { tier: "market", label: "Standard", priceCents: 450000, rationale: "Typical Austin professional price" },
    { tier: "premium", label: "Premium", priceCents: 600000, rationale: "Tight schedule, tall ceilings" },
  ],
});

Deno.test("REQ-017 suggest-prices: tiers are competitive / market / premium with FIXED localized labels (model labels ignored) and a materials basis", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({ text: MODEL_JSON }));
  const res = await flow.run({ userId: "u-1", raw: "Paint 2000 sq ft interior, two coats", lang: "en" });
  assertEquals(res.options.map((o) => o.tier), ["competitive", "market", "premium"]);
  assertEquals(res.options.map((o) => o.label), ["Competitive", "Market", "Premium"]);
  assertEquals(res.options.map((o) => o.priceCents), [300000, 450000, 600000]);
  assertEquals(res.basis, "labor_and_materials");

  const esRes = await new SuggestPrices(llm).run({ userId: "u-1", raw: "Pintar interior", lang: "es" });
  assertEquals(esRes.options.map((o) => o.label), ["Competitivo", "De mercado", "Premium"]);
});

Deno.test("REQ-017 suggest-prices: the prompt states labor AND materials and the request carries the contractor's location", async () => {
  const { llm, flow } = fresh();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return { text: MODEL_JSON };
  });
  await flow.run({
    userId: "u-1",
    raw: "Paint 2000 sq ft interior, two coats",
    lang: "en",
    address: { city: "Austin", state: "TX", postal: "78701" },
  });
  assert(seen, "llm was called");
  assert(/labor AND materials/i.test(seen!.systemPrompt), "system prompt states the basis");
  assert(/competitive < market < premium/.test(seen!.systemPrompt), "system prompt orders the tiers");
  const user = seen!.messages.find((m) => m.role === "user")?.content ?? "";
  assert(user.includes("Austin, TX 78701"), `user content carries the location: ${user}`);
});

Deno.test("REQ-017 suggest-prices: no address → no location line in the request", async () => {
  const { llm, flow } = fresh();
  let user = "";
  llm.setHandler((req) => {
    user = req.messages.find((m) => m.role === "user")?.content ?? "";
    return { text: MODEL_JSON };
  });
  await flow.run({ userId: "u-1", raw: "Paint 2000 sq ft interior", lang: "en" });
  assert(!/location/i.test(user), `no location line: ${user}`);
});

Deno.test("REQ-017 suggest-prices: LLM failure → fallback tiers with the new ids, labels, rationales and basis", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await flow.run({ userId: "u-1", raw: "Paint 2000 sq ft interior", lang: "en" });
  assertEquals(res.options.map((o) => o.tier), ["competitive", "market", "premium"]);
  assertEquals(res.options.map((o) => o.label), ["Competitive", "Market", "Premium"]);
  assertEquals(res.options[0].rationale, "Straightforward job, priced to win the work");
  assertEquals(res.options[1].rationale, "Typical professional price in your area");
  assertEquals(res.options[2].rationale, "For urgency, difficult access, or extra complexity");
  assertEquals(res.basis, "labor_and_materials");
  for (const o of res.options) assert(!/basic|minimal|cheap/i.test(o.rationale), o.rationale);
});

Deno.test("REQ-017 suggest-prices: the pricing call asks for the stronger model (gpt-4o by default, SUGGEST_PRICES_MODEL overrides)", async () => {
  const { llm, flow } = fresh();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return { text: MODEL_JSON };
  });
  await flow.run({ userId: "u-1", raw: "Paint 2000 sq ft interior", lang: "en" });
  assertEquals(seen?.model, "gpt-4o");
});

// ── REQ-260 — demo issue M24 ────────────────────────────────────────────
// "Suggested prices far too low for a full bathroom gut ($1,450 / $1,750 /
// $2,100)". The pricing model only ever saw the confirmed 3–4 terse bullets
// (prices dropped), never the contractor's message — so it priced "a typical
// small residential job" under a $2,800 plumbing sub the contractor named.

const GUT_RAW =
  "Full gut of the hall bathroom for the Ramirez family in Austin. Demo to studs, cut the slab and reroute the drain " +
  "for a curbless shower — my plumber quoted $2,800 for rough-in and finish. New frameless glass enclosure, 72\" double " +
  "vanity with quartz top, floor-to-ceiling porcelain tile, heated floor, two new circuits, permit included.";
const GUT_SCOPE = [
  "Demolish bathroom to studs",
  "Reroute drain for curbless shower",
  "Install tile, vanity and glass",
  "Electrical and permit work",
].join("\n");

const LOW_JSON = JSON.stringify({
  options: [
    { tier: "competitive", priceCents: 145000, rationale: "Typical Austin bathroom remodel pricing" },
    { tier: "market", priceCents: 175000, rationale: "Typical Austin bathroom remodel pricing" },
    { tier: "premium", priceCents: 210000, rationale: "Typical Austin bathroom remodel pricing" },
  ],
});
const GUT_JSON = JSON.stringify({
  options: [
    { tier: "competitive", priceCents: 2400000, rationale: "Full gut with stated plumbing sub" },
    { tier: "market", priceCents: 2950000, rationale: "Typical Austin full bathroom gut" },
    { tier: "premium", priceCents: 3600000, rationale: "Slab work and custom glass" },
  ],
});

Deno.test("REQ-260 M24 suggest-prices: the model sees the contractor's ORIGINAL message (costs, sizes) AND the confirmed scope", async () => {
  const { llm, flow } = fresh();
  let user = "";
  llm.setHandler((req) => {
    user = req.messages.find((m) => m.role === "user")?.content ?? "";
    return { text: GUT_JSON };
  });
  await flow.run({ userId: "u-1", raw: GUT_RAW, scope: GUT_SCOPE, lang: "en" });
  assert(user.includes("$2,800"), `the stated plumbing cost reaches the model: ${user}`);
  assert(user.includes("72\" double vanity"), `the original details reach the model: ${user}`);
  assert(user.includes("Reroute drain for curbless shower"), `the confirmed scope reaches the model: ${user}`);
});

Deno.test("REQ-260 M24 suggest-prices: the prompt treats stated costs as a floor and never defaults to a 'typical small' job", async () => {
  const { llm, flow } = fresh();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return { text: GUT_JSON };
  });
  await flow.run({ userId: "u-1", raw: GUT_RAW, scope: GUT_SCOPE, lang: "en" });
  const sys = seen!.systemPrompt;
  assert(!/typical small residential job/i.test(sys), "no 'typical small residential job' default");
  assert(/FLOOR/.test(sys), "stated costs are a floor");
  assert(/original message/i.test(sys), "the prompt names the original message as the source of truth");
});

Deno.test("REQ-260 M24 suggest-prices: one-shot JSON call — responseFormat 'json' so no chat tools ride along", async () => {
  const { llm, flow } = fresh();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return { text: GUT_JSON };
  });
  await flow.run({ userId: "u-1", raw: GUT_RAW, scope: GUT_SCOPE, lang: "en" });
  assertEquals(seen?.responseFormat, "json");
});

Deno.test("REQ-260 M24 suggest-prices: tiers under a cost the contractor stated are re-asked once, naming the floor", async () => {
  const { llm, flow } = fresh();
  const users: string[] = [];
  llm.setHandler((req) => {
    users.push(req.messages.filter((m) => m.role === "user").at(-1)?.content ?? "");
    return { text: users.length === 1 ? LOW_JSON : GUT_JSON };
  });
  const res = await flow.run({ userId: "u-1", raw: GUT_RAW, scope: GUT_SCOPE, lang: "en" });
  assertEquals(users.length, 2, "re-asked once");
  assert(/\$2,800/.test(users[1]) && /FLOOR/.test(users[1]), `the retry names the stated cost as a floor: ${users[1]}`);
  assertEquals(res.options.map((o) => o.priceCents), [2400000, 2950000, 3600000]);
});

Deno.test("REQ-260 M24 suggest-prices: a model that stays under the stated cost never ships tiers below it", async () => {
  const { llm, flow } = fresh();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return { text: LOW_JSON };
  });
  const res = await flow.run({ userId: "u-1", raw: GUT_RAW, scope: GUT_SCOPE, lang: "en" });
  assert(calls <= 2, `at most one retry (${calls})`);
  const cents = res.options.map((o) => o.priceCents);
  for (const c of cents) assert(c > 280000, `every tier is above the $2,800 the contractor stated: ${cents}`);
  assert(cents[0] < cents[1] && cents[1] < cents[2], `still ascending: ${cents}`);
});

Deno.test("REQ-260 M24 suggest-prices: the generic fallback tiers are lifted above a stated cost too", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await flow.run({ userId: "u-1", raw: GUT_RAW, scope: GUT_SCOPE, lang: "en" });
  const cents = res.options.map((o) => o.priceCents);
  for (const c of cents) assert(c > 280000, `fallback above the stated cost: ${cents}`);
  assert(cents[0] < cents[1] && cents[1] < cents[2], `still ascending: ${cents}`);
});

Deno.test("REQ-260 M24 suggest-prices: no stated cost → the model's tiers pass through untouched, no retry", async () => {
  const { llm, flow } = fresh();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return { text: MODEL_JSON };
  });
  const res = await flow.run({ userId: "u-1", raw: "Paint 2000 sq ft interior, two coats", lang: "en" });
  assertEquals(calls, 1);
  assertEquals(res.options.map((o) => o.priceCents), [300000, 450000, 600000]);
});

// ── REQ-332 — demo cycle 1, m30 ─────────────────────────────────────────
// "Prices include labor and materials" was hard-coded for every result; the
// contractor's "they're buying the vanity themselves" never reached it.

const VANITY_RAW =
  "Replace the vanity and faucet in the hall bath, re-caulk the tub. They're buying the vanity themselves.";

Deno.test("REQ-332 suggest-prices: the basis follows the job — customer-supplied items → labor; materials as noted", async () => {
  const { llm, flow } = fresh();
  let user = "";
  llm.setHandler((req) => {
    user = req.messages.find((m) => m.role === "user")?.content ?? "";
    return { text: MODEL_JSON };
  });
  const res = await flow.run({ userId: "u-1", raw: VANITY_RAW, lang: "en" });
  assertEquals(res.basis, "labor_materials_as_noted");
  assert(/customer supplies/i.test(user), `the model is told the customer supplies some materials: ${user}`);
});

Deno.test("REQ-332 suggest-prices: a plain job keeps labor_and_materials and no customer-supplies line", async () => {
  const { llm, flow } = fresh();
  let user = "";
  llm.setHandler((req) => {
    user = req.messages.find((m) => m.role === "user")?.content ?? "";
    return { text: MODEL_JSON };
  });
  const res = await flow.run({ userId: "u-1", raw: "Paint 2000 sq ft interior, two coats", lang: "en" });
  assertEquals(res.basis, "labor_and_materials");
  assert(!/customer supplies/i.test(user), user);
});

Deno.test("REQ-332 suggest-prices: the fallback tiers carry the derived basis too", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await flow.run({ userId: "u-1", raw: VANITY_RAW, lang: "en" });
  assertEquals(res.basis, "labor_materials_as_noted");
});

// ── REQ-382 — demo cycle 2, M22 ─────────────────────────────────────────
// "Suggested prices far too low (regression)": a master-bath gut (slab drain
// move, heated floor) whose client supplies only the faucets came back
// Competitive $1,850 / Market $2,250 / Premium $2,750 against the $28k the
// contractor chose. The basis line said "price the labor and only the
// materials the contractor provides"; the model wrote integer cents; and
// nothing checked the tiers against the size of the job.

const M22_RAW =
  "Master bath gut for the Patel home: remove old tub/shower combo, walk-in curbless shower (cut the slab to move the drain), " +
  "recessed niche, frameless glass, porcelain tile 12x24 on walls, 60in double vanity, quartz top, 2 undermount sinks " +
  "(faucets supplied by client / grifos los pone la clienta), new exhaust fan and lights, 8x10 heated floor, permit.";
const M22_V1_SCOPE =
  "Remove old tub/shower combo\nInstall walk-in shower with curbless entry\nPorcelain tile 12x24 on walls";
const M22_LOW = JSON.stringify({
  options: [
    { tier: "competitive", price: 1850, rationale: "Typical bathroom update" },
    { tier: "market", price: 2250, rationale: "Typical bathroom update" },
    { tier: "premium", price: 2750, rationale: "Includes heated floor and expedited schedule" },
  ],
});
const M22_RIGHT = JSON.stringify({
  options: [
    { tier: "competitive", price: 24000, rationale: "Full gut, slab drain move" },
    { tier: "market", price: 28500, rationale: "Typical local master-bath gut" },
    { tier: "premium", price: 34000, rationale: "Custom glass and heated floor" },
  ],
});

Deno.test("REQ-382 M22 suggest-prices: a customer-supplied item is named and EVERYTHING else is priced — labor and materials", async () => {
  const { llm, flow } = fresh();
  let user = "";
  llm.setHandler((req) => {
    user = req.messages.find((m) => m.role === "user")?.content ?? "";
    return { text: M22_RIGHT };
  });
  const res = await flow.run({ userId: "u-1", raw: M22_RAW, scope: M22_V1_SCOPE, lang: "en" });
  assertEquals(res.basis, "labor_materials_as_noted");
  assert(user.includes("faucets supplied by client"), `the supplied item is named: ${user}`);
  assert(/price everything else/i.test(user) && /labor and materials/i.test(user), `everything else is priced in full: ${user}`);
  assert(!/only the materials the contractor provides/i.test(user), `no labor-only basis line: ${user}`);
});

Deno.test("REQ-382 M22 suggest-prices: the confirmed scope is a summary that never shrinks the job", async () => {
  const { llm, flow } = fresh();
  let user = "";
  llm.setHandler((req) => {
    user = req.messages.find((m) => m.role === "user")?.content ?? "";
    return { text: M22_RIGHT };
  });
  await flow.run({ userId: "u-1", raw: M22_RAW, scope: M22_V1_SCOPE, lang: "en" });
  assert(/never makes the job smaller/i.test(user), `scope is labelled a summary: ${user}`);
  assert(user.includes("8x10 heated floor"), `the full original message is sent: ${user}`);
});

Deno.test("REQ-382 M22 suggest-prices: the model returns whole DOLLARS and the code converts to cents", async () => {
  const { llm, flow } = fresh();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return { text: M22_RIGHT };
  });
  const res = await flow.run({ userId: "u-1", raw: M22_RAW, scope: M22_V1_SCOPE, lang: "en" });
  assertEquals(res.options.map((o) => o.priceCents), [2400000, 2850000, 3400000]);
  const sys = seen!.systemPrompt;
  assert(/"price": <int>/.test(sys), "the output schema asks for price");
  assert(!/priceCents/.test(sys), "the prompt never asks for cents");
  assert(/whole US dollars/i.test(sys), "the prompt states the unit");
});

Deno.test("REQ-382 M22 suggest-prices: tiers under the job's plausibility floor are re-asked once, naming the scope", async () => {
  const { llm, flow } = fresh();
  const users: string[] = [];
  llm.setHandler((req) => {
    users.push(req.messages.filter((m) => m.role === "user").at(-1)?.content ?? "");
    return { text: users.length === 1 ? M22_LOW : M22_RIGHT };
  });
  const res = await flow.run({ userId: "u-1", raw: M22_RAW, scope: M22_V1_SCOPE, lang: "en" });
  assertEquals(users.length, 2, "re-asked once");
  assert(/dollars/i.test(users[1]) && /gut|remodel/i.test(users[1]), `the retry names the unit and the job size: ${users[1]}`);
  assertEquals(res.options.map((o) => o.priceCents), [2400000, 2850000, 3400000]);
});

Deno.test("REQ-382 M22 suggest-prices: a model that stays implausibly low never ships tiers under the floor", async () => {
  const { llm, flow } = fresh();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return { text: M22_LOW };
  });
  const res = await flow.run({ userId: "u-1", raw: M22_RAW, scope: M22_V1_SCOPE, lang: "en" });
  assertEquals(calls, 2, "one retry");
  const cents = res.options.map((o) => o.priceCents);
  for (const c of cents) assert(c >= 800000, `every tier clears a master-bath gut floor: ${cents}`);
  assert(cents[0] < cents[1] && cents[1] < cents[2], `still ascending: ${cents}`);
});
