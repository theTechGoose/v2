import { assertEquals } from "#std/assert";
import { AgentMessageStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("agent-message-store smoke: append then listByConversation returns oldest-first", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentMessageStore();
  const a = await store.append({ conversationId: "c-1", role: "user",      kind: "text", content: "first"  });
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.append({ conversationId: "c-1", role: "assistant", kind: "text", content: "second" });
  const list = await store.listByConversation("c-1");
  assertEquals(list.length, 2);
  assertEquals(list[0].id, a.id);
  assertEquals(list[1].id, b.id);
  await resetKv();
});

Deno.test("agent-message-store smoke: per-conversation isolation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentMessageStore();
  await store.append({ conversationId: "c-1", role: "user", kind: "text", content: "a" });
  await store.append({ conversationId: "c-2", role: "user", kind: "text", content: "b" });
  assertEquals((await store.listByConversation("c-1")).length, 1);
  assertEquals((await store.listByConversation("c-2")).length, 1);
  await resetKv();
});

Deno.test("agent-message-store smoke: payload roundtrips intact", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentMessageStore();
  const payload = { actionType: "quote", quoteId: "q-1", lines: [{ label: "Demo", amountCents: 50_000 }] };
  await store.append({ conversationId: "c-1", role: "assistant", kind: "action_card", content: "Quote drafted", payload });
  const list = await store.listByConversation("c-1");
  assertEquals(list[0].payload, payload);
  await resetKv();
});

Deno.test("agent-message-store smoke: deleteByConversation removes all messages", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentMessageStore();
  await store.append({ conversationId: "c-1", role: "user", kind: "text", content: "1" });
  await store.append({ conversationId: "c-1", role: "user", kind: "text", content: "2" });
  await store.deleteByConversation("c-1");
  assertEquals((await store.listByConversation("c-1")).length, 0);
  await resetKv();
});

Deno.test("agent-message-store smoke: latestPreviewable returns the newest non-system non-divider", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentMessageStore();
  await store.append({ conversationId: "c-1", role: "user", kind: "text", content: "first user" });
  await new Promise((r) => setTimeout(r, 3));
  await store.append({ conversationId: "c-1", role: "assistant", kind: "text", content: "assistant reply" });
  await new Promise((r) => setTimeout(r, 3));
  await store.append({ conversationId: "c-1", role: "system", kind: "phase_divider", content: "Phase 2 — Terms" });
  const preview = await store.latestPreviewable("c-1");
  assertEquals(preview?.content, "assistant reply");
  await resetKv();
});

Deno.test("agent-message-store smoke: latestPreviewable returns null for empty conversation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AgentMessageStore();
  assertEquals(await store.latestPreviewable("c-1"), null);
  await resetKv();
});
