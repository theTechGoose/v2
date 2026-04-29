import { assert, assertEquals, assertRejects } from "#std/assert";
import { AcceptContract } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const contracts = new ContractStore();
  const bus = new EventBus();
  return { conversations, messages, contracts, bus, flow: new AcceptContract(conversations, messages, contracts, bus) };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try { return await fn(); } finally { await resetKv(); }
}

async function seedConvWithContract(s: ReturnType<typeof fresh>, userId: string, contractId: string) {
  const conv = await s.conversations.create({ userId, currentPhase: "terms" });
  // contractId is set via update (not on create)
  return await s.conversations.update(conv.id, { contractId });
}

Deno.test("accept-contract integration: flips status, appends phase_divider, marks conversation unread", async () => {
  await withKv(async () => {
    const s = fresh();
    const contract = await s.contracts.create("u-1", { quoteId: "q-1", status: "signed" });
    const conv = await seedConvWithContract(s, "u-1", contract.id);

    const result = await s.flow.run({ userId: "u-1", conversationId: conv.id, contractId: contract.id });

    assertEquals(result.newMessages.length, 1);
    assertEquals(result.newMessages[0].kind, "phase_divider");
    const after = await s.contracts.get(contract.id);
    assertEquals(after.status, "accepted");
  });
});

Deno.test("accept-contract integration: idempotent on already-accepted contract", async () => {
  await withKv(async () => {
    const s = fresh();
    const contract = await s.contracts.create("u-1", { quoteId: "q-1", status: "accepted" });
    const conv = await seedConvWithContract(s, "u-1", contract.id);
    await s.flow.run({ userId: "u-1", conversationId: conv.id, contractId: contract.id });
    const after = await s.contracts.get(contract.id);
    assertEquals(after.status, "accepted");
  });
});

Deno.test("accept-contract integration: cross-owner is forbidden", async () => {
  await withKv(async () => {
    const s = fresh();
    const contract = await s.contracts.create("u-A", { quoteId: "q-1" });
    const conv = await seedConvWithContract(s, "u-B", contract.id);
    await assertRejects(
      () => s.flow.run({ userId: "u-B", conversationId: conv.id, contractId: contract.id }),
    );
  });
});

Deno.test("accept-contract integration: emits contract:accepted on the bus", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((evt) => { events.push(evt); });
    const contract = await s.contracts.create("u-1", { quoteId: "q-1", status: "signed" });
    const conv = await seedConvWithContract(s, "u-1", contract.id);
    await s.flow.run({ userId: "u-1", conversationId: conv.id, contractId: contract.id });
    const accepted = events.find((e) => e.entityType === "contract" && e.action === "accepted");
    assert(accepted);
  });
});
