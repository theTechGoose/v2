/**
 * REQ-717 (demo-loop cycle 5, issue p11) — a change-order decision's amount
 * reads like every other amount in the app: "+$1,600", never "+$1600.00".
 *
 * The customer approves / declines on the public /co link (no session); the
 * public controller emits the decision on the EventBus, NotifyOnEvent writes
 * the owner's feed row, and GET /notifications renders it. The amount must be
 * grouped with a thousands comma, end to end over HTTP.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule, CommunicationModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function login(phone = "+15125557717"): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function seedOrder(userId: string, deltaAmountCents: number) {
  const inv = await new InvoiceStore().create(userId, {
    amount: 960_000,
    status: "sent",
    jobName: "Kitchen",
  } as never);
  const co = await new ChangeOrderStore().create(userId, inv.id, {
    description: "Add pantry shelving",
    deltaAmountCents,
    originalAmountCents: 960_000,
  });
  return co.id;
}

async function post(path: string, body: unknown = {}) {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  await res.body?.cancel();
  return res.status;
}

Deno.test("REQ-717 p11: the owner's feed shows a change-order decision's amount with a thousands comma (+$1,600 approved, −$1,250.50 declined)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const auth = { ...JSON_HEADERS, "x-session-id": sid };
    const me = await fetch(`${base()}/me`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "en", name: "Rosa" }),
    });
    await me.body?.cancel();

    const up = await seedOrder(owner.userId, 160_000);
    assertEquals(
      await post(`/change-orders/${up}/approve`, { name: "Ana" }),
      200,
    );
    const down = await seedOrder(owner.userId, -125_050);
    assertEquals(await post(`/change-orders/${down}/decline`), 200);

    const list = await fetch(`${base()}/notifications?limit=10`, {
      headers: auth,
    }).then((r) => r.json());
    const titles: string[] = (Array.isArray(list) ? list : list.items ?? [])
      .map((n: { title: string }) => n.title);
    assert(
      titles.some((t) => t.includes("approved your change order (+$1,600)")),
      `approved row groups thousands: ${JSON.stringify(titles)}`,
    );
    assert(
      titles.some((t) => t.includes("declined your change order (−$1,250.50)")),
      `declined row groups thousands: ${JSON.stringify(titles)}`,
    );
    assert(
      !titles.some((t) => /\$\d{4}/.test(t)),
      `no ungrouped amount: ${JSON.stringify(titles)}`,
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
