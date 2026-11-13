/**
 * REQ-238 (demo M27) — on the booted app, over HTTP: "Change order for
 * Maria: add fridge cleaning $40" typed into a NEW assistant conversation
 * changes Maria's existing job and never creates a separate $40 quote.
 * (The stub LLM only echoes, so these turns run on the coordinator's own
 * reading of the request — the same path the real model's turn takes when
 * the sentence says who, what and how much.)
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9238;
const BASE = `http://localhost:${PORT}`;
const DEMO = "Change order for Maria: add fridge cleaning $40";

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

/** Signed in AND past the assistant's onboarding questions. */
async function signIn(
  phone = "+15125557238",
): Promise<{ sid: string; userId: string }> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  await new UserStore().update(v.userId, {
    name: "Pat Painter",
    email: "pat@test.dev",
    language: "en",
  });
  await new BusinessIdentityStore().upsert(v.userId, {
    businessName: "Pat LLC",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@pat" } },
  });
  await new BusinessAddressStore().upsert(v.userId, {
    state: "TX",
    postal: "78701",
  });
  return { sid: v.sessionId, userId: v.userId };
}

/** Every quote the account owns (the list route lives outside AgentsModule). */
async function quoteIds(userId: string): Promise<string[]> {
  return (await new QuoteStore().listByUser(userId)).map((q) => q.id);
}

function api(sid: string) {
  const headers = { "content-type": "application/json", "x-session-id": sid };
  return async <T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert(res.ok, `${method} ${path} → ${res.status}`);
    return await res.json() as T;
  };
}

/** Maria with a $350 quote, sent to her (demo pair 3's setup). */
async function mariaWithSentQuote(call: ReturnType<typeof api>) {
  const maria = await call<{ id: string }>("POST", "/customers", {
    name: "Maria Lopez",
  });
  const quote = await call<{ id: string }>("POST", "/quotes", {
    summary: "Deep clean — Maria",
    jobName: "Deep clean",
    customerId: maria.id,
    lineItems: [{
      description: "Deep clean",
      quantity: 1,
      unit: "ea",
      price: 35_000,
    }],
    estimatedTotal: 35_000,
  });
  await call("PUT", `/quotes/${quote.id}`, { status: "sent" });
  return { maria, quote };
}

Deno.test("REQ-238 M27 e2e: the demo's sentence in a new conversation puts +$40 on Maria's sent quote as a revision — still one quote", async () => {
  await withServer(async () => {
    const me = await signIn();
    const call = api(me.sid);
    const { quote } = await mariaWithSentQuote(call);

    const turn = await call<
      { newMessages: { role: string; kind: string; content: string }[] }
    >(
      "POST",
      "/agents/chat",
      { content: DEMO },
    );

    assertEquals(
      await quoteIds(me.userId),
      [quote.id],
      "no separate $40 quote",
    );
    const stored = await call<{
      estimatedTotal: number;
      pendingRevision?: {
        lineItems: { description: string; price: number }[];
        estimatedTotal: number;
      };
    }>("GET", `/quotes/${quote.id}`);
    assertEquals(
      stored.estimatedTotal,
      35_000,
      "the published version is untouched",
    );
    assertEquals(stored.pendingRevision?.estimatedTotal, 39_000);
    assertEquals(stored.pendingRevision?.lineItems.at(-1), {
      description: "Fridge cleaning",
      quantity: 1,
      unit: "ea",
      price: 4_000,
    } as never);
    assertEquals(turn.newMessages.some((m) => m.kind === "action_card"), false);
    assert(
      turn.newMessages.at(-1)!.content.includes("Publish revision"),
      turn.newMessages.at(-1)!.content,
    );
  });
});

Deno.test("REQ-238 M27 e2e: once Maria's job is invoiced, the same sentence makes a pending change order on her invoice", async () => {
  await withServer(async () => {
    const me = await signIn();
    const call = api(me.sid);
    const { quote } = await mariaWithSentQuote(call);
    const inv = await call<{ id: string; amount: number }>(
      "POST",
      "/invoices",
      {
        quoteId: quote.id,
        status: "sent",
      },
    );

    await call("POST", "/agents/chat", { content: DEMO });

    assertEquals(
      await quoteIds(me.userId),
      [quote.id],
      "no separate $40 quote",
    );
    const cos = await call<
      {
        status: string;
        description: string;
        deltaAmountCents: number;
        quoteId: string;
      }[]
    >(
      "GET",
      `/invoices/${inv.id}/change-orders`,
    );
    assertEquals(cos.length, 1);
    assertEquals(
      {
        status: cos[0].status,
        description: cos[0].description,
        delta: cos[0].deltaAmountCents,
        quoteId: cos[0].quoteId,
      },
      {
        status: "pending",
        description: "Fridge cleaning",
        delta: 4_000,
        quoteId: quote.id,
      },
    );
    // the invoice moves only when Maria approves at /co/:id
    assertEquals(
      (await call<{ amount: number }>("GET", `/invoices/${inv.id}`)).amount,
      35_000,
    );
  });
});

// REQ-377 (demo-loop cycle 2, B1): "Dana wants a tile backsplash too — change
// Q-001 to $19,750" on a sent $18,500 quote added a $125 line. Over HTTP, on
// the booted app: the new total is read and subtracted by the server.
Deno.test("REQ-377 B1 e2e: 'change Q-001 to $19,750' on a sent $18,500 quote adds Tile backsplash at $1,250 — new total $19,750", async () => {
  await withServer(async () => {
    const me = await signIn("+15125557377");
    const call = api(me.sid);
    const dana = await call<{ id: string }>("POST", "/customers", {
      name: "Dana Price",
    });
    const quote = await call<{ id: string; number: string }>(
      "POST",
      "/quotes",
      {
        summary: "Kitchen Remodel — Dana Price",
        jobName: "Kitchen Remodel",
        customerId: dana.id,
        lineItems: [
          {
            description: "Install new cabinets",
            quantity: 1,
            unit: "ea",
            price: 1_100_000,
          },
          {
            description: "Install quartz countertops",
            quantity: 1,
            unit: "ea",
            price: 750_000,
          },
        ],
        estimatedTotal: 1_850_000,
      },
    );
    assertEquals(quote.number, "Q-001");
    await call("PUT", `/quotes/${quote.id}`, { status: "sent" });

    const turn = await call<
      { newMessages: { role: string; content: string }[] }
    >("POST", "/agents/chat", {
      content: "Dana wants a tile backsplash too — change Q-001 to $19,750",
    });

    assertEquals(await quoteIds(me.userId), [quote.id], "still one quote");
    const stored = await call<{
      estimatedTotal: number;
      pendingRevision?: {
        lineItems: { description: string; price: number }[];
        estimatedTotal: number;
      };
    }>("GET", `/quotes/${quote.id}`);
    assertEquals(stored.estimatedTotal, 1_850_000);
    assertEquals(stored.pendingRevision?.estimatedTotal, 1_975_000);
    assertEquals(stored.pendingRevision?.lineItems.at(-1), {
      description: "Tile backsplash",
      quantity: 1,
      unit: "ea",
      price: 125_000,
    } as never);
    const reply = turn.newMessages.at(-1)!.content;
    assert(reply.includes("$1,250.00"), reply);
  });
});
