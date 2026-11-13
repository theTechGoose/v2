/**
 * REQ-685 — demo-loop cycle 5, issue m42: "Change order Version 2 doesn't
 * say what changed."
 *
 * Integration over HTTP, app booted: the owner edits a pending change order
 * (PUT /invoices/:id/change-orders/:coId publishes Version 2 and files
 * Version 1); the customer's GET /change-orders/:id/public then carries
 * `changesFromPrevious` — the description and the signed delta, before →
 * after. Version 1 carries none.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

async function login(phone: string): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-685 m42: GET /change-orders/:id/public carries changesFromPrevious once the order is edited to Version 2 — none at Version 1", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125556850");
    const owner = (await new SessionStore().get(sid))!;
    const inv = await new InvoiceStore().create(owner.userId, {
      amount: 960_000,
      status: "sent",
      jobName: "Kitchen",
    } as never);
    const co = await new ChangeOrderStore().create(owner.userId, inv.id, {
      description: "Add shelving",
      deltaAmountCents: 160_000,
      originalAmountCents: 960_000,
    });

    const publicView = () =>
      fetch(`${BASE}/change-orders/${co.id}/public`).then((r) => r.json());
    const v1 = await publicView();
    assertEquals(v1.version, 1);
    assertEquals(v1.changesFromPrevious, undefined);

    const edit = await fetch(
      `${BASE}/invoices/${inv.id}/change-orders/${co.id}`,
      {
        method: "PUT",
        headers: { ...json, "x-session-id": sid },
        body: JSON.stringify({
          description: "Add pantry shelving",
          deltaAmountCents: 180_000,
        }),
      },
    );
    assertEquals(edit.status, 200);
    await edit.body?.cancel();

    const v2 = await publicView();
    assertEquals(v2.version, 2);
    assertEquals(v2.deltaAmountCents, 180_000);
    assertEquals(v2.changesFromPrevious, {
      description: { from: "Add shelving", to: "Add pantry shelving" },
      deltaAmountCents: { from: 160_000, to: 180_000 },
    });

    // an amount-only edit names only the amount
    await (await fetch(`${BASE}/invoices/${inv.id}/change-orders/${co.id}`, {
      method: "PUT",
      headers: { ...json, "x-session-id": sid },
      body: JSON.stringify({
        description: "Add pantry shelving",
        deltaAmountCents: 175_000,
      }),
    })).body?.cancel();
    const v3 = await publicView();
    assertEquals(v3.version, 3);
    assertEquals(v3.changesFromPrevious, {
      deltaAmountCents: { from: 180_000, to: 175_000 },
    });
  } finally {
    await server.stop();
    await resetKv();
  }
});
