/**
 * REQ-701 (demo-loop cycle 5, issue M21) — on the booted app, over HTTP, with
 * the stub LLM (which only echoes "(stub) …"): the assistant answers "where
 * do I answer her?" from the questions clients sent.
 *
 * Pair 9: Linda asked "¿Pueden venir el sábado en la mañana? ¿Se llevan
 * también un colchón?" on Q-001 and signed. Rosa typed "Ya terminamos…
 * mándale la factura ahora… y Linda preguntó… ¿dónde le contesto?" in the
 * job's thread and got only "Linda Morales firmó — todavía no se ha facturado
 * nada. La factura de $525 (INV-001) …". Now the same message also gets
 * Linda's question, how to reach her, and where to answer it — with a link to
 * the quote's questions.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const QUESTION =
  "¿Pueden venir el sábado en la mañana? ¿Se llevan también un colchón?";

interface Msg {
  role: string;
  kind: string;
  content: string;
  payload?: Record<string, unknown>;
}
type ChatRes = {
  conversation: { id: string; quoteId?: string };
  newMessages: Msg[];
};

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  // SMS and email in dev mode: nothing leaves the box
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
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
async function signIn(phone: string): Promise<string> {
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
    name: "Rosa Delgado",
    email: "rosa@junkmonsters.test",
    language: "es",
  });
  await new BusinessIdentityStore().upsert(v.userId, {
    businessName: "Junk Monsters",
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "rosa@junkmonsters.test" },
    },
  });
  await new BusinessAddressStore().upsert(v.userId, {
    city: "Austin",
    state: "TX",
    postal: "78702",
  });
  return v.sessionId;
}

function api(sid?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sid) headers["x-session-id"] = sid;
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

const texts = (msgs: Msg[]) =>
  msgs.filter((m) => m.role === "assistant" && m.kind === "text")
    .map((m) => m.content).join("\n");

/** Pair 9: Rosa's Q-001 for Linda Morales — sent, asked about, signed. */
async function pair9(call: ReturnType<typeof api>) {
  const linda = await call<{ id: string }>("POST", "/customers", {
    name: "Linda Morales",
    email: "linda.morales@example.com",
  });
  const quote = await call<{ id: string; number?: string }>(
    "POST",
    "/quotes",
    {
      customerId: linda.id,
      summary: "Retiro de muebles",
      jobName: "Retiro de muebles",
      lineItems: [{
        description: "Retiro de muebles",
        quantity: 1,
        unit: "ea",
        price: 52_500,
      }],
      estimatedTotal: 52_500,
      estimatedCompletionDate: "2099-11-19",
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Payment upon completion",
      }],
    },
  );
  await call("PUT", `/quotes/${quote.id}`, { status: "sent" });
  await api()("POST", `/quotes/${quote.id}/inquiry`, {
    question: QUESTION,
    contactBack: "linda.morales@example.com",
    name: "Linda Morales",
    lang: "es",
  });
  const signed = await api()<{ ok: boolean }>(
    "POST",
    `/quotes/${quote.id}/accept`,
    { signature: "Linda Morales", name: "Linda Morales" },
  );
  assertEquals(signed.ok, true);
  return { linda, quote };
}

Deno.test("REQ-701 M21 e2e: pair 9's 'mándale la factura ahora… y Linda preguntó… ¿dónde le contesto?' gets the billing answer AND Linda's question with where to answer it", async () => {
  await withServer(async () => {
    const call = api(await signIn("+15125557711"));
    const { quote } = await pair9(call);
    const conv = await call<{ id: string }>("POST", "/agents/conversations", {
      quoteId: quote.id,
    });
    const res = await call<ChatRes>("POST", "/agents/chat", {
      conversationId: conv.id,
      content:
        "Ya terminamos… mándale la factura ahora… y Linda preguntó… ¿dónde le contesto?",
    });
    const text = texts(res.newMessages);
    assert(!text.includes("(stub)"), `the chat model answered: ${text}`);
    // the billing half, as before
    assertStringIncludes(text, "INV-001");
    // the question half — the demo's missing answer
    assertStringIncludes(text, QUESTION);
    assertStringIncludes(text, "linda.morales@example.com");
    assertStringIncludes(text, "Preguntas del cliente");
    const linked = res.newMessages.find((m) =>
      (m.payload?.inquiry as { quoteId?: string } | undefined)?.quoteId ===
        quote.id
    );
    assert(linked, "a reply links to the quote's questions");
  });
});

Deno.test("REQ-701 M21 e2e: '¿dónde le contesto a Linda?' alone is answered from her question, never by the chat model; once answered, nothing is waiting", async () => {
  await withServer(async () => {
    const call = api(await signIn("+15125557712"));
    const { quote } = await pair9(call);

    const res = await call<ChatRes>("POST", "/agents/chat", {
      content: "¿dónde le contesto a Linda?",
    });
    const text = texts(res.newMessages);
    assert(!text.includes("(stub)"), `the chat model answered: ${text}`);
    assertStringIncludes(text, "Linda Morales preguntó");
    assertStringIncludes(text, QUESTION);
    assert(!/INV-001/.test(text), text);

    const [row] = await call<{ id: string }[]>(
      "GET",
      `/quotes/${quote.id}/inquiries`,
    );
    const replied = await call<{ ok: boolean }>(
      "POST",
      `/quotes/${quote.id}/inquiries/${row.id}/reply`,
      { channel: "email", message: "Sí, el sábado a las 9." },
    );
    assertEquals(replied.ok, true);

    const again = await call<ChatRes>("POST", "/agents/chat", {
      conversationId: res.conversation.id,
      content: "¿dónde le contesto?",
    });
    const after = texts(again.newMessages);
    assertStringIncludes(
      after,
      "No hay preguntas de clientes esperando respuesta",
    );
  });
});

Deno.test("REQ-701 M21 e2e: 'how should I reply to him?' advice with no client question waiting is the chat model's to answer — no 'nothing waiting' line", async () => {
  await withServer(async () => {
    const call = api(await signIn("+15125557713"));
    for (
      const content of [
        "How should I reply to him? He's upset about the mess we left.",
        "¿cómo le contesto que no podemos el sábado?",
      ]
    ) {
      const res = await call<ChatRes>("POST", "/agents/chat", { content });
      const text = texts(res.newMessages);
      assertStringIncludes(
        text,
        "(stub)",
        `the chat model answers: ${content}`,
      );
      assert(
        !/No client question is waiting|No hay preguntas de clientes/.test(
          text,
        ),
        `a 'nothing waiting' line rode along: ${text}`,
      );
    }
  });
});

Deno.test("REQ-701 M21 e2e: '¿Cómo le respondo a Linda?' with her question waiting is answered from it, not by the chat model", async () => {
  await withServer(async () => {
    const call = api(await signIn("+15125557714"));
    await pair9(call);
    const res = await call<ChatRes>("POST", "/agents/chat", {
      content: "¿Cómo le respondo a Linda?",
    });
    const text = texts(res.newMessages);
    assert(!text.includes("(stub)"), `the chat model answered: ${text}`);
    assertStringIncludes(text, QUESTION);
  });
});
