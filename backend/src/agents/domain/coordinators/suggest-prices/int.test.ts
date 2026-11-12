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
