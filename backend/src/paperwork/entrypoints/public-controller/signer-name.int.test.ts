/**
 * REQ-470 — demo-loop cycle 3, issue m61 ("One-letter legal name ('x') signs
 * a binding agreement"). The accept endpoint took `name` as optional with no
 * shape rule, so "x" (or nothing) became the legal signer. Now a missing or
 * too-short name is 400 `invalid_name` and the quote stays unsigned; a real
 * name ("Ann", "Tom K.") still signs.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone = "+15125557470"): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function sentQuote(sid: string): Promise<string> {
  const q = await fetch(`${base()}/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify({ summary: "Job", lineItems: [] }),
  }).then((r) => r.json());
  const owner = (await new SessionStore().get(sid))!;
  await new QuoteStore().update(q.id, owner.userId, { status: "sent" });
  return q.id as string;
}

async function accept(
  id: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base()}/quotes/${id}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("REQ-470 m61: a one-letter, blank or missing signer name is 400 invalid_name and the quote stays unsigned; a real name signs", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const id = await sentQuote(sid);
    const quote = async () => await new QuoteStore().get(id);

    for (const bad of [{ name: "x" }, { name: "  " }, { name: "ab" }, {}]) {
      const r = await accept(id, { ...bad, signature: "data:image/png;x" });
      assertEquals(r.status, 400, `${JSON.stringify(bad)} → ${r.status}`);
      assertEquals(r.body.reason, "invalid_name", JSON.stringify(r.body));
      assertEquals((await quote()).status, "sent", "nothing was signed");
      assertEquals((await quote()).acceptedName, undefined);
    }

    const ok = await accept(id, { name: "  Tom   K. " });
    assertEquals(ok.status, 200, JSON.stringify(ok.body));
    assertEquals((await quote()).status, "accepted");
    assertEquals((await quote()).acceptedName, "Tom K.");

    const id2 = await sentQuote(sid);
    const ann = await accept(id2, { name: "Ann" });
    assertEquals(ann.status, 200, JSON.stringify(ann.body));
  } finally {
    await server.stop();
    await resetKv();
  }
});
