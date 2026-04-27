import { assertEquals, assertRejects } from "#std/assert";
import { AgentConversationStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";

Deno.test("agent-conversation-store smoke: create then get returns the conversation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  const c = await store.create({ userId: "u-1" });
  const fetched = await store.get(c.id);
  assertEquals(fetched.userId, "u-1");
  assertEquals(fetched.currentPhase, "quote");
  await resetKv();
});

Deno.test("agent-conversation-store smoke: tryGet returns null for missing id", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  assertEquals(await store.tryGet("nope"), null);
  await resetKv();
});

Deno.test("agent-conversation-store smoke: get throws NotFoundError on missing id", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  await assertRejects(() => store.get("nope"), NotFoundError);
  await resetKv();
});

Deno.test("agent-conversation-store smoke: listByUser returns newest-first, scoped to user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  const a1 = await store.create({ userId: "u-1" });
  await new Promise((r) => setTimeout(r, 5));
  const a2 = await store.create({ userId: "u-1" });
  await new Promise((r) => setTimeout(r, 5));
  const b1 = await store.create({ userId: "u-2" });

  const byA = await store.listByUser("u-1");
  assertEquals(byA.length, 2);
  assertEquals(byA[0].id, a2.id);                              // newest first
  assertEquals(byA[1].id, a1.id);

  const byB = await store.listByUser("u-2");
  assertEquals(byB.length, 1);
  assertEquals(byB[0].id, b1.id);
  await resetKv();
});

Deno.test("agent-conversation-store smoke: update merges fields and bumps updatedAt", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  const c = await store.create({ userId: "u-1" });
  await new Promise((r) => setTimeout(r, 10));
  const u = await store.update(c.id, { customerId: "cust-1", quoteId: "q-1", currentPhase: "terms" });
  assertEquals(u.customerId, "cust-1");
  assertEquals(u.quoteId, "q-1");
  assertEquals(u.currentPhase, "terms");
  if (u.updatedAt <= c.updatedAt) throw new Error("updatedAt should advance");
  await resetKv();
});

Deno.test("agent-conversation-store smoke: delete removes record + index + wizard state", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  const c = await store.create({ userId: "u-1" });
  await store.putWizardState(c.id, { specId: "contract-terms-v1", activeStepIdx: 3, answers: [] });
  await store.delete(c.id);

  assertEquals(await store.tryGet(c.id), null);
  assertEquals((await store.listByUser("u-1")).length, 0);
  assertEquals(await store.getWizardState(c.id), null);
  await resetKv();
});

Deno.test("agent-conversation-store smoke: wizard state put + get roundtrip", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  const c = await store.create({ userId: "u-1" });
  const state = { specId: "contract-terms-v1" as const, activeStepIdx: 5, answers: [
    { stepId: "config", optionId: "standard_residential", answeredAt: "2026-04-26T00:00:00.000Z" },
  ]};
  await store.putWizardState(c.id, state);
  const fetched = await store.getWizardState(c.id);
  assertEquals(fetched?.activeStepIdx, 5);
  assertEquals(fetched?.answers.length, 1);
  await resetKv();
});

Deno.test("agent-conversation-store smoke: per-user listByUser isolation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  await store.create({ userId: "u-1" });
  await store.create({ userId: "u-2" });
  await store.create({ userId: "u-2" });

  assertEquals((await store.listByUser("u-1")).length, 1);
  assertEquals((await store.listByUser("u-2")).length, 2);
  await resetKv();
});

Deno.test("agent-conversation-store smoke: limit caps the listByUser result", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  for (let i = 0; i < 5; i++) {
    await store.create({ userId: "u-1" });
    await new Promise((r) => setTimeout(r, 2));
  }
  const limited = await store.listByUser("u-1", { limit: 2 });
  assertEquals(limited.length, 2);
  await resetKv();
});
