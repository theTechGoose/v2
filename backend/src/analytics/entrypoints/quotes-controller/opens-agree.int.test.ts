/**
 * REQ-955 — LOOP-007 cycle 1, q1-30 [minor/BUG_CONTRADICTION] "Quote card
 * contradicts itself on opens". The card's count comes from GET /quotes
 * (BuildQuoteCards: views of this quote merged to ≤1 per hour); its timeline
 * comes from GET /quotes/:id/opens. The two halves of one card must tell the
 * same story: as many timeline rows as the count says.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 20000 + Math.floor(Math.random() * 20000);

async function drain(res: Response) {
  await res.body?.cancel();
}

async function withServer(fn: (base: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(`http://localhost:${PORT}`);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(base: string, phone = "+15125559551"): Promise<string> {
  await drain(
    await fetch(`${base}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function sentQuote(base: string, sid: string): Promise<string> {
  const auth = { "content-type": "application/json", "x-session-id": sid };
  const q = await fetch(`${base}/quotes`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ summary: "Bathroom remodel", lineItems: [] }),
  }).then((r) => r.json());
  await drain(
    await fetch(`${base}/quotes/${q.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        status: "sent",
        sentAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    }),
  );
  return q.id;
}

async function bothHalves(base: string, sid: string, id: string) {
  const cards = await fetch(`${base}/quotes`, {
    headers: { "x-session-id": sid },
  }).then((r) => r.json()) as Array<{ id: string; opens: number }>;
  const card = cards.find((c) => c.id === id)!;
  const out = await fetch(`${base}/quotes/${id}/opens`, {
    headers: { "x-session-id": sid },
  }).then((r) => r.json()) as { opens: unknown[] };
  return { count: card.opens, rows: out.opens.length };
}

Deno.test("REQ-955 (LOOP-007 q1-30): one customer open — GET /quotes and GET /quotes/:id/opens both say 1", async () => {
  await withServer(async (base) => {
    const sid = await login(base);
    const id = await sentQuote(base, sid);
    // the customer opens /q/<id> once (no session = not the owner)
    await drain(await fetch(`${base}/quotes/${id}/public`));
    const { count, rows } = await bothHalves(base, sid, id);
    assertEquals(count, 1, "the card's count");
    assertEquals(rows, count, "the timeline has as many rows as the count");
  });
});

Deno.test("REQ-955 (LOOP-007 q1-30): a customer who loads /q twice within the hour — the card's count and its timeline still agree", async () => {
  await withServer(async (base) => {
    const sid = await login(base);
    const id = await sentQuote(base, sid);
    // one visit = the SSR read + a reload a moment later; the card merges
    // these to one open per hour, so the timeline must not list two
    await drain(await fetch(`${base}/quotes/${id}/public`));
    await drain(await fetch(`${base}/quotes/${id}/public`));
    const { count, rows } = await bothHalves(base, sid, id);
    assertEquals(count, 1, "the card's count (≤1 per hour)");
    assertEquals(
      rows,
      count,
      `the card says ${count} open but its timeline lists ${rows}`,
    );
  });
});
