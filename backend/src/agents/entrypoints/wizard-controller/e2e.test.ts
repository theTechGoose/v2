import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";

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
      body: JSON.stringify({ conversationId: cid, stepId: "customer", optionId: "use_active" }),
    }).then((r) => r.json());

    assertEquals(result.wizardState.activeStepIdx, 1);
    assertEquals(result.newMessages.length, 2);
    assertEquals(result.newMessages[0].role, "user");
    assertEquals(result.newMessages[1].kind, "wizard");
    assertEquals((result.newMessages[1].payload as { stepId: string }).stepId, "start_date");
  });
});

Deno.test("agents wizard e2e: completing all 5 steps yields a continue_cta to send", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const cid = await setupTermsConv(port, sid);

    const sequence = [
      ["customer",         "use_active"],
      ["start_date",       "asap"],
      ["wraps",            "1_week"],
      ["payment_terms",    "50_50"],
      ["warranty",         "12_months"],
    ];

    let last;
    for (const [stepId, optionId] of sequence) {
      last = await fetch(`http://localhost:${port}/agents/wizard/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-session-id": sid },
        body: JSON.stringify({ conversationId: cid, stepId, optionId }),
      }).then((r) => r.json());
    }

    assertEquals(last.wizardState.activeStepIdx, 5);
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
      body: JSON.stringify({ conversationId: conv.id, stepId: "customer", optionId: "use_active" }),
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

// REQ-263 (demo ai-assistant-m2): the customer step's job address reaches the
// quote through the HTTP answer (the DTO must carry it, the controller pass it).
Deno.test("REQ-263 agents wizard e2e: the customer step's serviceAddress lands on the conversation's quote", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: "{}",
    }).then((r) => r.json());
    const userId: string = conv.userId;
    const quote = await new QuoteStore().create(userId, {
      summary: "Deep clean",
      lineItems: [],
      estimatedTotal: 35_000,
    });
    await new AgentConversationStore().update(conv.id, { quoteId: quote.id });
    await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/transition-to-terms`, {
      method: "POST", headers: { "x-session-id": sid },
    }).then(drain);
    const res = await fetch(`http://localhost:${port}/agents/wizard/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        conversationId: conv.id,
        stepId: "customer",
        optionId: "create_new",
        serviceAddress: "412 Oak St Austin",
        customer: { create: { name: "Maria Lopez", phoneNumber: "5125550199" } },
      }),
    });
    assertEquals(res.status, 200);
    await drain(res);
    const stored = await new QuoteStore().getOwned(quote.id, userId);
    assertEquals(stored.serviceAddress, "412 Oak St Austin");
  });
});

// REQ-531 (demo-loop cycle 3, p8-pair6-a): over HTTP, a Spanish contractor
// answering "Usar el cliente del chat" gets the customer's name on the
// transcript line, not the option label.
Deno.test("REQ-531 p8-pair6-a agents wizard e2e: use_active posts 'Cliente: <name>' for a Spanish contractor", async () => {
  await withServer(async (port) => {
    const phone = "+15125550177";
    const sid = await login(port, phone);
    const users = new UserStore();
    const me = (await users.findByPhone(phone))!;
    await users.update(me.id, { language: "es" });
    const maria = await new CustomerStore().create(me.id, { name: "Maria Lopez" });
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ customerId: maria.id }),
    }).then((r) => r.json());
    await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/transition-to-terms`, {
      method: "POST", headers: { "x-session-id": sid },
    }).then(drain);
    const result = await fetch(`http://localhost:${port}/agents/wizard/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ conversationId: conv.id, stepId: "customer", optionId: "use_active" }),
    }).then((r) => r.json());
    assertEquals(result.newMessages[0].content, "Cliente: Maria Lopez");
  });
});

// REQ-589 (demo-loop cycle 4, M15): over HTTP, the wizard lines a Spanish
// contractor was shown come back with their i18n keys, so the island
// re-renders them — and the thread-list preview — in English after a switch.
Deno.test("REQ-589 M15 agents wizard e2e: a reloaded Spanish wizard thread re-renders in English from its keys", async () => {
  const { localizeChatMessage, localizedPreview } = await import(
    "#quote-flow/chat-i18n.ts"
  );
  const { t } = await import("@core/i18n/mod.ts");
  const tr = (
    l: "en" | "es",
    k: string,
    v?: Record<string, string | number>,
  ) => t(l, k, v);
  await withServer(async (port) => {
    const phone = "+15125550178";
    const sid = await login(port, phone);
    const users = new UserStore();
    const me = (await users.findByPhone(phone))!;
    await users.update(me.id, { language: "es" });
    const carmen = await new CustomerStore().create(me.id, {
      name: "Carmen Ruiz",
    });
    const h = { "content-type": "application/json", "x-session-id": sid };
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ customerId: carmen.id }),
    }).then((r) => r.json());
    await fetch(
      `http://localhost:${port}/agents/conversations/${conv.id}/transition-to-terms`,
      {
        method: "POST",
        headers: { "x-session-id": sid },
      },
    ).then(drain);
    for (
      const [stepId, optionId] of [["customer", "use_active"], [
        "start_date",
        "next_week",
      ]]
    ) {
      await fetch(`http://localhost:${port}/agents/wizard/answer`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ conversationId: conv.id, stepId, optionId }),
      }).then(drain);
    }
    const detail = await fetch(
      `http://localhost:${port}/agents/conversations/${conv.id}`,
      {
        headers: { "x-session-id": sid },
      },
    ).then((r) => r.json());
    const shown = (detail.messages as {
      kind?: string;
      content: string;
      payload?: unknown;
    }[])
      .map((m) => localizeChatMessage(m, "en", tr));
    const texts = shown.map((m) => m.content);
    assertEquals(texts.includes("A little more info"), true, texts.join(" | "));
    assertEquals(texts.includes("Start: Next week"), true, texts.join(" | "));
    assertEquals(
      texts.includes(t("en", "termsWizard.wraps.question")),
      true,
      texts.join(" | "),
    );
    assertEquals(
      texts.some((x) => /Inicio|información|¿/.test(x)),
      false,
      texts.join(" | "),
    );

    const list = await fetch(`http://localhost:${port}/agents/conversations`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    const row = (list as { id: string; preview?: string }[]).find((c) =>
      c.id === conv.id
    )!;
    assertEquals(localizedPreview(row, "en", tr), "Start: Next week");
  });
});
