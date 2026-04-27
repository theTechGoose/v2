import { assertEquals, assertThrows } from "#std/assert";
import {
  isInQuotePhase,
  isInTermsPhase,
  shouldTransitionToTerms,
  transitionPhase,
} from "./mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";

const stub = (over: Partial<AgentConversation> = {}): AgentConversation => ({
  id: "c-1",
  userId: "u-1",
  currentPhase: "quote",
  createdAt: "2026-04-26T00:00:00.000Z",
  updatedAt: "2026-04-26T00:00:00.000Z",
  ...over,
});

Deno.test("shouldTransitionToTerms: false when no quoteId", () => {
  assertEquals(shouldTransitionToTerms(stub()), false);
});

Deno.test("shouldTransitionToTerms: true once quoteId is set in quote phase", () => {
  assertEquals(shouldTransitionToTerms(stub({ quoteId: "q-1" })), true);
});

Deno.test("shouldTransitionToTerms: false when already in terms phase", () => {
  assertEquals(shouldTransitionToTerms(stub({ currentPhase: "terms", quoteId: "q-1" })), false);
});

Deno.test("isInQuotePhase / isInTermsPhase: mutually exclusive", () => {
  assertEquals(isInQuotePhase(stub()), true);
  assertEquals(isInTermsPhase(stub()), false);
  assertEquals(isInQuotePhase(stub({ currentPhase: "terms" })), false);
  assertEquals(isInTermsPhase(stub({ currentPhase: "terms" })), true);
});

Deno.test("transitionPhase: quote → terms returns new conversation with bumped updatedAt", () => {
  const before = stub({ updatedAt: "2026-01-01T00:00:00.000Z" });
  const after = transitionPhase(before, "terms");
  assertEquals(after.currentPhase, "terms");
  assertEquals(after.id, before.id);
  if (after.updatedAt <= before.updatedAt) throw new Error("updatedAt should advance");
});

Deno.test("transitionPhase: same-phase is a no-op (returns same object)", () => {
  const c = stub({ currentPhase: "terms" });
  assertEquals(transitionPhase(c, "terms"), c);
});

Deno.test("transitionPhase: terms → quote throws (no backward transitions)", () => {
  assertThrows(
    () => transitionPhase(stub({ currentPhase: "terms" }), "quote"),
    Error,
    "invalid phase transition",
  );
});
