/**
 * REQ-396 (demo-loop cycle 2, issue M13): the open /q page re-reads its
 * projection every 10 s so a signature or a published revision reaches it.
 * That re-read is the page polling, not the customer opening the link: with
 * `?refresh=1` the GET serves the same payload but records no open and does
 * not flip sent → viewed. A plain GET (the page's first load) still does.
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
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone = "+15125557396"): Promise<string> {
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

Deno.test("REQ-396 M13: GET /quotes/:id/public?refresh=1 serves the payload but records no open and leaves 'sent'; the plain GET still records", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const q = await fetch(`${base()}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Deck", lineItems: [] }),
    }).then((r) => r.json());
    const owner = (await new SessionStore().get(sid))!;
    await new QuoteStore().update(q.id, owner.userId, { status: "sent" });
    const views = () => new ViewStore().listByPaperwork("quote", q.id);

    const polled = await fetch(`${base()}/quotes/${q.id}/public?refresh=1`);
    assertEquals(polled.status, 200);
    const body = await polled.json();
    assertEquals(body.id, q.id);
    assertEquals(body.status, "sent", "a poll is not the customer opening it");
    assertEquals((await views()).length, 0, "a poll records no open");
    assertEquals((await new QuoteStore().get(q.id)).status, "sent");

    const opened = await fetch(`${base()}/quotes/${q.id}/public`);
    assertEquals((await opened.json()).status, "viewed");
    assertEquals((await views()).length, 1, "the first load still records");
  } finally {
    await server.stop();
    await resetKv();
  }
});
