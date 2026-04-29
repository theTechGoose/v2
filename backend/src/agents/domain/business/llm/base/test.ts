import { assertEquals } from "#std/assert";
import type { LLMRequest, LLMResponse } from "./mod.ts";
import { LLM_CLIENT } from "./mod.ts";

Deno.test("llm base: token is a stable string", () => {
  assertEquals(LLM_CLIENT, "LLM_CLIENT");
});

Deno.test("llm base: LLMRequest shape compiles", () => {
  const req: LLMRequest = {
    systemPrompt: "you are a helper",
    messages: [{ role: "user", content: "hi" }],
    userId: "u-1",
  };
  assertEquals(req.userId, "u-1");
});

Deno.test("llm base: LLMResponse shape compiles (text-only and action variants)", () => {
  const text: LLMResponse = { text: "ok" };
  const withAction: LLMResponse = {
    text: "drafting",
    action: { type: "create_quote", payload: { summary: "x", lineItems: [] } },
  };
  assertEquals(text.text, "ok");
  assertEquals(withAction.action?.type, "create_quote");
});
