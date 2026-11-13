/**
 * REQ-367 (demo-loop cycle 1, issue m10) — GET /clients answers the same card whatever the
 * viewer's language. The relative time and the jobs line used to be worded HERE, in the request's
 * language (`lastWhenRel = relativeTime(lastWhen, now, lang)`, `jobsSub = t(lang, …)`), and the
 * page dropped them into its live-language template — after an EN/ES switch the card read
 * "New customer — added hace un momento." until the list was fetched again. The card now carries
 * raw data (`lastWhen`, a `jobsSub` kind) and the client words it in whatever language is live.
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

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}
const PORT = 9367;
const J = { "content-type": "application/json" };

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(PORT);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(port: number, phone = "+15125553670"): Promise<string> {
  await (await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-367 GET /clients: a customer's card is the same for the account in English and in Spanish — raw data, no worded time", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const H = { ...J, "x-session-id": sid };
    const setLanguage = async (language: "en" | "es") => {
      const r = await fetch(`http://localhost:${port}/me`, {
        method: "PUT",
        headers: H,
        body: JSON.stringify({ language }),
      });
      assert(r.ok, `PUT /me language=${language}: ${r.status}`);
      await r.body?.cancel();
    };
    const card = async () =>
      (await fetch(`http://localhost:${port}/clients`, { headers: H }).then((
        r,
      ) => r.json())).items[0];

    await setLanguage("en");
    const created = await fetch(`http://localhost:${port}/customers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "Ana Recién", email: "ana@example.com" }),
    });
    assert(created.ok, `POST /customers: ${created.status}`);
    await created.body?.cancel();

    const inEnglish = await card();
    await setLanguage("es");
    const inSpanish = await card();

    assertEquals(
      inSpanish,
      inEnglish,
      "the card does not depend on the viewer's language",
    );
    assertEquals(
      "lastWhenRel" in inEnglish,
      false,
      `no worded relative time on the card (${inEnglish.lastWhenRel})`,
    );
    assert(
      typeof inEnglish.lastWhen === "string" &&
        !Number.isNaN(Date.parse(inEnglish.lastWhen)),
      `lastWhen is the raw timestamp (${inEnglish.lastWhen})`,
    );
    assertEquals(
      inEnglish.jobsSub,
      "none",
      "jobsSub is a kind the client words",
    );
  });
});
