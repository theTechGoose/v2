import { assertEquals } from "#std/assert";
import { StartConversation } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("start-conversation integration: creates conversation in 'quote' phase with no bindings", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  const flow = new StartConversation(store);

  const conv = await flow.run({ userId: "u-1" });
  assertEquals(conv.userId, "u-1");
  assertEquals(conv.currentPhase, "quote");
  assertEquals(conv.customerId, undefined);
  assertEquals(conv.quoteId, undefined);

  const fetched = await store.get(conv.id);
  assertEquals(fetched.id, conv.id);
  await resetKv();
});

Deno.test("start-conversation integration: pre-binds customerId + quoteId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  const flow = new StartConversation(store);

  const conv = await flow.run({ userId: "u-1", customerId: "cust-1", quoteId: "q-1" });
  assertEquals(conv.customerId, "cust-1");
  assertEquals(conv.quoteId, "q-1");
  assertEquals(conv.currentPhase, "quote");                 // still starts in quote even with quoteId

  await resetKv();
});

Deno.test("start-conversation integration: appears in listByUser", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentConversationStore();
  const flow = new StartConversation(store);

  await flow.run({ userId: "u-1" });
  await flow.run({ userId: "u-1" });
  const list = await store.listByUser("u-1");
  assertEquals(list.length, 2);

  await resetKv();
});
