/**
 * REQ-369 (demo-loop cycle 1, demo issue m2) — on the booted app, over HTTP:
 * the conversation list (GET /agents/conversations) and the chat header
 * (`deriveChatHeader` over GET /agents/conversations/:id, what AsstChat
 * renders) name the same status for the thread at every step, including the
 * one the demo caught: the customer signs on the public page
 * (POST /quotes/:id/accept) and the header said "Quote accepted" while the
 * list kept "Quote sent".
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { deriveChatHeader, draftOwesDetails } from "#quote-flow/chat-header.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9369;
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

async function login(phone = "+15125550369"): Promise<string> {
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

Deno.test("REQ-369 e2e: GET /agents/conversations and the chat header name one status at every step — drafted, locked, gathering, picking job details, ready to send, out for signature, signed on the public page", async () => {
  await withServer(async () => {
    const sid = await login();
    const auth = { ...J, "x-session-id": sid };
    const post = async (path: string, body: unknown, authed = true) => {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: authed ? auth : J,
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => undefined);
      assert(res.ok, `${path} answered ${res.status}: ${JSON.stringify(json)}`);
      return json;
    };
    const get = (path: string) =>
      fetch(`${BASE}${path}`, { headers: { "x-session-id": sid } }).then((
        r,
      ) => r.json());

    const quote = await post("/quotes", {
      summary: "Interior repaint",
      jobName: "Interior repaint",
      lineItems: [{
        description: "Repaint",
        quantity: 1,
        unit: "ea",
        price: 320_000,
      }],
      estimatedTotal: 320_000,
    });
    // The paperwork senders refuse an unnamed contractor — name the account.
    const kv = await getKv();
    const userKey = ["user", quote.userId];
    const user = (await kv.get<Record<string, unknown>>(userKey)).value!;
    await kv.set(userKey, { ...user, name: "Test Contractor" });

    const created = await post("/agents/conversations", { quoteId: quote.id });
    const convId: string = created.id ?? created.conversation?.id;

    async function bothSay(want: string, step: string) {
      const rows = await get("/agents/conversations?limit=50");
      const row = (rows as { id: string; threadStatus?: string }[]).find((
        r,
      ) => r.id === convId);
      const detail = await get(`/agents/conversations/${convId}`);
      const header = deriveChatHeader({
        customerName: detail.customer?.name,
        quote: detail.quote,
        messages: detail.messages ?? [],
        detailsPending: draftOwesDetails(detail.draft),
      }).status;
      assertEquals(
        { step, list: row?.threadStatus, header },
        { step, list: want, header: want },
        `${step}: the list and the header must both say "${want}"`,
      );
    }

    await bothSay("drafted", "a drafted quote");

    await post(`/agents/conversations/${convId}/lock-quote`, {
      quoteId: quote.id,
    });
    await bothSay("locked", "after Lock it in");

    await post(`/agents/conversations/${convId}/transition-to-terms`, {});
    await bothSay("gathering", "the terms wizard asking");

    // The price flow parks the raw job details: the pick is owed at the end.
    await post(`/agents/conversations/${convId}/draft`, {
      draft: { polishRaw: "Repaint 3 bedrooms, walls and trim" },
    });
    for (const step of TERMS_WIZARD_V1.steps) {
      await post(
        "/agents/wizard/answer",
        step.id === "customer"
          ? {
            conversationId: convId,
            stepId: "customer",
            optionId: "create_new",
            customer: {
              create: { name: "John Miller", email: "john@example.com" },
            },
          }
          : {
            conversationId: convId,
            stepId: step.id,
            optionId: step.options.find((o) => !o.isCustom)!.id,
          },
      );
    }
    await bothSay(
      "pickingDetails",
      "the wizard done, the job still being picked",
    );

    await post(`/agents/conversations/${convId}/draft`, { draft: null });
    await bothSay("readyToSend", "the job description picked");

    // REQ-385 (cycle 2, m6): the pencil re-opens the job-details picker —
    // the parked draft has the picker open, no polishRaw.
    await post(`/agents/conversations/${convId}/draft`, {
      draft: { jobOptionsOpen: true, pickerMode: "polish" },
    });
    await bothSay("pickingDetails", "the job details being rewritten");
    await post(`/agents/conversations/${convId}/draft`, { draft: null });
    await bothSay("readyToSend", "the picker closed again");

    await post(`/agents/conversations/${convId}/send-quote`, {
      quoteId: quote.id,
      channel: "email",
    });
    await bothSay("sent", "emailed to the customer");

    // The customer signs on the public page — no session, no agents call.
    await post(`/quotes/${quote.id}/accept`, {
      name: "John Miller",
      signature: "John Miller",
    }, false);
    await bothSay("accepted", "signed on the public page");
  });
});
