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
