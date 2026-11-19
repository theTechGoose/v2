/**
 * REQ-1107 (LOOP-007 cycle 3, q3-31 + q3-104) — "Spanish /quotes 'Consejo del
 * monstruo' tip text is in English". An owner whose account language is EN
 * opens /quotes?lang=es: the page (and the tip's heading) is Spanish, but
 * GET /analytics/quotes/insight built its sentence from the account language
 * only (uiLangOf), so the tip body was the English static fallback.
 *
 * Through the real HTTP stack: what the insight endpoint answers a Spanish page
 * on an English account must never be a finished English sentence — either the
 * text follows the page's ?lang=es, or there is no finished text at all and the
 * page builds the sentence from `kind` (+ `avg`) in its own language.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { t } from "@core/i18n/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 20000 + Math.floor(Math.random() * 20000);

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

async function enOwner(base: string, phone = "+15125551107"): Promise<string> {
  await (await fetch(`${base}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  const sid = v.sessionId as string;
  const me = await fetch(`${base}/me`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify({ language: "en", name: "Dana Tip" }),
  });
  assertEquals(me.status, 200, `PUT /me language=en (${await me.text()})`);
  return sid;
}

const EN_FALLBACK = t("en", "quotesInsight.staticFallback");
const ES_FALLBACK = t("es", "quotesInsight.staticFallback");

Deno.test("REQ-1107 (LOOP-007 q3, q3-31): GET /analytics/quotes/insight?lang=es for an EN account never answers the English 48-hour sentence", async () => {
  await withServer(async (base) => {
    const sid = await enOwner(base);
    const r = await fetch(`${base}/analytics/quotes/insight?lang=es`, {
      headers: { "x-session-id": sid },
    });
    assertEquals(r.status, 200);
    const body = await r.json() as { text?: string; kind?: string };
    assertEquals(body.kind, "static_fallback", "a new account gets the static fallback kind");
    assert(
      body.text !== EN_FALLBACK,
      `the Spanish page's insight is the English sentence: ${JSON.stringify(body)}`,
    );
    assert(
      body.text === undefined || body.text === ES_FALLBACK,
      `text, when sent, is the Spanish 48-hour sentence (got ${JSON.stringify(body.text)})`,
    );
  });
});

Deno.test("REQ-1107 (LOOP-007 q3, q3-31): GET /analytics/quotes/insight for an EN account with no ?lang stays English", async () => {
  await withServer(async (base) => {
    const sid = await enOwner(base, "+15125551108");
    const r = await fetch(`${base}/analytics/quotes/insight`, {
      headers: { "x-session-id": sid },
    });
    assertEquals(r.status, 200);
    const body = await r.json() as { text?: string; kind?: string };
    assertEquals(body.kind, "static_fallback");
    assert(body.text === undefined || body.text === EN_FALLBACK, JSON.stringify(body));
  });
});
