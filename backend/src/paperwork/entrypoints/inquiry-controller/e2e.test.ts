/**
 * REQ-701 (demo-loop cycle 5, issue M21) — on the booted app, over HTTP.
 *
 * Pair 9: Linda asked "¿Pueden venir el sábado en la mañana? ¿Se llevan
 * también un colchón?" from her quote link; Rosa's notice opened the quote
 * panel, which had no question and no reply box. Now:
 *   POST /quotes/:id/inquiry                       (public) stores the question
 *   GET  /quotes/:id/inquiries                     (owner) reads them
 *   POST /quotes/:id/inquiries/:inquiryId/reply    (owner) answers one
 * and the customer's public projection never carries them.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const QUESTION =
  "¿Pueden venir el sábado en la mañana? ¿Se llevan también un colchón?";

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

async function login(phone: string, name: string): Promise<string> {
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
    name,
    email: "rosa@junkmonsters.test",
    language: "es",
  });
  await new BusinessIdentityStore().upsert(v.userId, {
    businessName: "Junk Monsters",
  });
  return v.sessionId;
}

function call(sid?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sid) headers["x-session-id"] = sid;
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = JSON.parse(text);
    } catch { /* not json */ }
    return {
      status: res.status,
      json: json as Record<string, unknown> & unknown[],
      text,
    };
  };
}

/** Rosa's sent quote for Linda Morales, and Linda's question on it. */
async function lindaAsks(rosa: ReturnType<typeof call>) {
  const linda = (await rosa("POST", "/customers", {
    name: "Linda Morales",
    email: "linda.morales@example.com",
    phoneNumber: "+15127730148",
  })).json as unknown as { id: string };
  const quote = (await rosa("POST", "/quotes", {
    customerId: linda.id,
    summary: "Retiro de muebles",
    jobName: "Retiro de muebles",
    lineItems: [{
      description: "Retiro",
      quantity: 1,
      unit: "ea",
      price: 52_500,
    }],
    estimatedTotal: 52_500,
  })).json as unknown as { id: string };
  await rosa("PUT", `/quotes/${quote.id}`, { status: "sent" });
  const asked = await call()("POST", `/quotes/${quote.id}/inquiry`, {
    question: QUESTION,
    contactBack: "linda.morales@example.com",
    name: "Linda Morales",
    lang: "es",
  });
  assertEquals(asked.status, 200, asked.text);
  return { linda, quote };
}

Deno.test("REQ-701 M21 e2e: the client's question is stored and the owner reads it on the quote — who, what, how to reach them, the page language", async () => {
  await withServer(async () => {
    const rosa = call(await login("+15125557701", "Rosa Delgado"));
    const { linda, quote } = await lindaAsks(rosa);

    const list = await rosa("GET", `/quotes/${quote.id}/inquiries`);
    assertEquals(list.status, 200, list.text);
    const rows = list.json as unknown as Record<string, unknown>[];
    assertEquals(rows.length, 1);
    assertEquals(rows[0].question, QUESTION);
    assertEquals(rows[0].contactBack, "linda.morales@example.com");
    assertEquals(rows[0].name, "Linda Morales");
    assertEquals(rows[0].lang, "es");
    assertEquals(rows[0].quoteId, quote.id);
    assertEquals(rows[0].customerId, linda.id);
    assertEquals(rows[0].answeredAt, undefined);

    // The customer's own page never carries the stored questions.
    const pub = await call()("GET", `/quotes/${quote.id}/public`);
    assertEquals(pub.status, 200);
    assert(
      !pub.text.includes("colchón"),
      "the public projection leaks a question",
    );
    assert(!("inquiries" in (pub.json as Record<string, unknown>)));
  });
});

Deno.test("REQ-701 M21 e2e: another account is refused; no session is refused", async () => {
  await withServer(async () => {
    const rosa = call(await login("+15125557702", "Rosa Delgado"));
    const { quote } = await lindaAsks(rosa);
    const other = call(await login("+15125557703", "Otro Contratista"));
    const theirs = await other("GET", `/quotes/${quote.id}/inquiries`);
    assertEquals(theirs.status, 403, theirs.text);
    const rows = (await rosa("GET", `/quotes/${quote.id}/inquiries`))
      .json as unknown as { id: string }[];
    const reply = await other(
      "POST",
      `/quotes/${quote.id}/inquiries/${rows[0].id}/reply`,
      { channel: "text", message: "hola" },
    );
    assertEquals(reply.status, 403, reply.text);
    const anon = await call()("GET", `/quotes/${quote.id}/inquiries`);
    assertEquals(anon.status, 401, anon.text);
  });
});

Deno.test("REQ-701 M21 e2e: the owner answers by email and by text; the question then reads answered; a bad body is a 400", async () => {
  await withServer(async () => {
    const rosa = call(await login("+15125557704", "Rosa Delgado"));
    const { quote } = await lindaAsks(rosa);
    const [row] = (await rosa("GET", `/quotes/${quote.id}/inquiries`))
      .json as unknown as { id: string }[];

    const bad = await rosa(
      "POST",
      `/quotes/${quote.id}/inquiries/${row.id}/reply`,
      { channel: "pigeon", message: "hola" },
    );
    assertEquals(bad.status, 400, bad.text);

    const mailed = await rosa(
      "POST",
      `/quotes/${quote.id}/inquiries/${row.id}/reply`,
      {
        channel: "email",
        message: "Sí, el sábado a las 9. El colchón son $40 más.",
      },
    );
    assertEquals(mailed.status, 200, mailed.text);
    assertEquals(mailed.json.ok, true, mailed.text);
    assertEquals(mailed.json.to, "linda.morales@example.com");

    const texted = await rosa(
      "POST",
      `/quotes/${quote.id}/inquiries/${row.id}/reply`,
      { channel: "text", message: "Te confirmo por aquí también." },
    );
    assertEquals(texted.json.ok, true, texted.text);
    assertEquals(texted.json.to, "+15127730148");

    const [after] = (await rosa("GET", `/quotes/${quote.id}/inquiries`))
      .json as unknown as {
        answeredAt?: string;
        answer?: { channel: string; to: string; message: string };
      }[];
    assertEquals(typeof after.answeredAt, "string");
    assertEquals(after.answer?.channel, "text");
    assertEquals(after.answer?.message, "Te confirmo por aquí también.");
  });
});
