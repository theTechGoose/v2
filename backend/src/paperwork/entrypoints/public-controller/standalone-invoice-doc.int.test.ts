/**
 * REQ-487 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m58: a manual (standalone) invoice's public
 * page showed no Bill to / From blocks and no line-item table.
 *
 * Integration over HTTP, app booted: GET /invoices/:id/public for an invoice
 * with NO quote projects the invoice's OWN line items into
 * `jobDetails.lineItems` (the field /i draws its itemized table from — before
 * this, only a linked quote filled it) and the bill-to snapshot as
 * `customer`. A batch (visit) invoice keeps its visit grouping and gets no
 * second, flat table.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function login(phone = "+15125553187"): Promise<string> {
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
  return v.sessionId;
}

Deno.test("REQ-487 (demo m58, cycle 3): a standalone invoice's public projection carries its own line items and its bill-to party; a batch invoice keeps only its visits", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const lineItems = [
      {
        description: "Deep clean, 3 bedrooms",
        quantity: 1,
        unit: "job",
        price: 240_00,
      },
      { description: "Oven interior", quantity: 2, unit: "each", price: 30_00 },
    ];
    const inv = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        status: "sent",
        amount: 300_00,
        jobName: "Move-out clean",
        lineItems,
        billTo: { name: "Maria Lopez", email: "maria@example.com" },
      }),
    }).then((r) => r.json());
    assertEquals(typeof inv.id, "string", JSON.stringify(inv));

    const pub = await fetch(`${BASE}/invoices/${inv.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(pub.jobDetails?.jobName, "Move-out clean");
    assertEquals(
      (pub.jobDetails?.lineItems ?? []).map((
        li: { description: string; quantity: number; price: number },
      ) => [li.description, li.quantity, li.price]),
      [["Deep clean, 3 bedrooms", 1, 240_00], ["Oven interior", 2, 30_00]],
      "the standalone invoice's own line items are not projected into jobDetails.lineItems",
    );
    assertEquals(pub.customer?.name, "Maria Lopez", "bill-to party missing");
    assertEquals(
      pub.agreementTotal,
      undefined,
      "no agreement on a standalone bill",
    );

    // A batch (visit) invoice: the visits render; no duplicate flat table.
    const batch = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        status: "sent",
        amount: 90_00,
        lineItems: [
          {
            description: "Mow — 12 Elm St",
            quantity: 1,
            unit: "visit",
            price: 45_00,
            date: "2026-11-01",
            service: "Mow",
            address: "12 Elm St",
          },
          {
            description: "Mow — 12 Elm St",
            quantity: 1,
            unit: "visit",
            price: 45_00,
            date: "2026-11-08",
            service: "Mow",
            address: "12 Elm St",
          },
        ],
      }),
    }).then((r) => r.json());
    const pubBatch = await fetch(`${BASE}/invoices/${batch.id}/public`).then((
      r,
    ) => r.json());
    assertEquals(pubBatch.visits?.length, 1);
    assertEquals(pubBatch.jobDetails?.lineItems, undefined);
  } finally {
    await server.stop();
    await resetKv();
  }
});
