import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9072;

async function drain(res: Response) { await res.body?.cancel(); }

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(PORT); } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function setupTermsConv(port: number, sid: string): Promise<string> {
  const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: "{}",
  }).then((r) => r.json());
  await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/transition-to-terms`, {
    method: "POST", headers: { "x-session-id": sid },
  }).then(drain);
  return conv.id;
}

Deno.test("agents wizard e2e: full happy path — answer step 0, get step 1 back", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const cid = await setupTermsConv(port, sid);

    const result = await fetch(`http://localhost:${port}/agents/wizard/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ conversationId: cid, stepId: "config", optionId: "standard_residential" }),
    }).then((r) => r.json());

    assertEquals(result.wizardState.activeStepIdx, 1);
    assertEquals(result.newMessages.length, 2);
    assertEquals(result.newMessages[0].role, "user");
    assertEquals(result.newMessages[0].content, "Config: Standard residential");
    assertEquals(result.newMessages[1].kind, "wizard");
    assertEquals((result.newMessages[1].payload as { stepId: string }).stepId, "customer");
  });
});

Deno.test("agents wizard e2e: completing all 10 steps yields a continue_cta to send", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const cid = await setupTermsConv(port, sid);

    const sequence = [
      ["config",          "standard_residential"],
      ["customer",         "use_active"],
      ["start_date",       "asap"],
      ["wraps",            "1_week"],
      ["payment_terms",    "50_50"],
      ["warranty",         "12_months"],
      ["termination",      "14"],
      ["dispute",          "mediation"],
      ["governing_state",  "use_business_state"],
      ["state_notices",    "yes"],
    ];

    let last;
    for (const [stepId, optionId] of sequence) {
      last = await fetch(`http://localhost:${port}/agents/wizard/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-session-id": sid },
        body: JSON.stringify({ conversationId: cid, stepId, optionId }),
      }).then((r) => r.json());
    }

    assertEquals(last.wizardState.activeStepIdx, 10);
    assertEquals(last.newMessages[last.newMessages.length - 1].kind, "continue_cta");
  });
});

Deno.test("agents wizard e2e: out-of-order step is rejected", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const cid = await setupTermsConv(port, sid);
    const res = await fetch(`http://localhost:${port}/agents/wizard/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ conversationId: cid, stepId: "warranty", optionId: "12_months" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("agents wizard e2e: posting before transition (still in 'quote') is rejected", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    const res = await fetch(`http://localhost:${port}/agents/wizard/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ conversationId: conv.id, stepId: "config", optionId: "standard_residential" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("agents wizard e2e: custom option requires customValue", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const cid = await setupTermsConv(port, sid);
    // Move past 'config'
    await fetch(`http://localhost:${port}/agents/wizard/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ conversationId: cid, stepId: "config", optionId: "standard_residential" }),
    }).then(drain);

    // 'customer.create_new' is isCustom — without customValue should fail
    const res = await fetch(`http://localhost:${port}/agents/wizard/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ conversationId: cid, stepId: "customer", optionId: "create_new" }),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});
