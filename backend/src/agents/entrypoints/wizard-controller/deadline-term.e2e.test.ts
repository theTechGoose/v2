import "#reflect-metadata";
import { assert, assertMatch } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-771 (demo-loop cycle 5v5, M7) on the booted app, the help-me-price
 * path the island drives: mint the thread, park the typed details on it
 * (POST /:id/draft {note}), create the quote, bind it, run the terms wizard
 * to the end. The customer's agreement (GET /quotes/:id/public) carries the
 * deadline the contractor typed — "Has to be done before Thanksgiving." —
 * as a term row; it used to name it nowhere.
 */
@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9771;
const BASE = `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(phone = "+15125557710"): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function post(path: string, body: unknown, sid: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...J, "x-session-id": sid },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  assert(res.ok, `${path} answered ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

Deno.test("REQ-771 M7 (cycle 5v5) e2e: the help-me-price run's agreement carries 'Deadline: Before Thanksgiving'", async () => {
  await withServer(async () => {
    const sid = await login();
    const conv = await post("/agents/conversations", {}, sid);
    const convId = conv.id ?? conv.conversation?.id;
    await post(`/agents/conversations/${convId}/draft`, {
      note:
        "Bathroom floor for Ana Diaz at 22 Oak St: install LVP no wait porcelain tile 12x24 on the floor, plus a recessed shower niche. Has to be done before Thanksgiving.",
    }, sid);
    const quote = await post("/quotes", {
      summary: "Install porcelain tile 12x24 (22 Oak St)",
      jobName: "Install porcelain tile 12x24 (22 Oak St)",
      lineItems: [{
        description: "Install porcelain tile 12x24",
        quantity: 1,
        unit: "ea",
        price: 240_000,
      }],
      estimatedTotal: 240_000,
      serviceAddress: "22 Oak St",
    }, sid);
    await post(
      `/agents/conversations/${convId}/draft`,
      { quoteId: quote.id },
      sid,
    );
    await post(
      `/agents/conversations/${convId}/transition-to-terms?docKind=quote`,
      {},
      sid,
    );
    await post("/agents/wizard/answer", {
      conversationId: convId,
      stepId: "customer",
      optionId: "create_new",
      customer: { create: { name: "Ana Diaz" } },
    }, sid);
    for (
      const [stepId, optionId] of [
        ["start_date", "asap"],
        ["wraps", "1_week"],
        ["payment_terms", "50_50"],
        ["warranty", "12_months"],
      ]
    ) {
      await post("/agents/wizard/answer", {
        conversationId: convId,
        stepId,
        optionId,
      }, sid);
    }
    const pub = await fetch(`${BASE}/quotes/${quote.id}/public`).then((r) =>
      r.json()
    );
    const row = (pub.terms ?? []).find((t: { stepId: string }) =>
      t.stepId === "deadline"
    );
    assert(
      row,
      `the agreement names no deadline: ${JSON.stringify(pub.terms)}`,
    );
    assertMatch(row.value, /^Before \d{4}-11-\d{2} \(Thanksgiving\)$/);
  });
});
