/**
 * REQ-802 — the customer card's Delete action rides DELETE /customers/:id
 * (REQ-039's soft delete): the customer answers 404 afterwards and leaves the
 * list; another account cannot delete it.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule] })
class TestApp {}
const PORT = 9802;
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
async function login(port: number, phone: string): Promise<string> {
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

Deno.test("REQ-802 DELETE /customers/:id — the customer answers 404 and leaves the list; another account is refused", async () => {
  await withServer(async (port) => {
    const base = `http://localhost:${port}`;
    const sid = await login(port, "+15125558021");
    const other = await login(port, "+15125558022");
    const H = { ...J, "x-session-id": sid };
    const mk = async (name: string) =>
      (await fetch(`${base}/customers`, {
        method: "POST",
        headers: H,
        // REQ-1149: two customers on one phone — a seed, not the duplicate check
        body: JSON.stringify({
          name,
          phoneNumber: "+15125550000",
          allowDuplicate: true,
        }),
      })).json();
    const a = await mk("Ana Delete");
    const b = await mk("Bea Stays");

    // another account cannot delete it
    const forbidden = await fetch(`${base}/customers/${a.id}`, {
      method: "DELETE",
      headers: { ...J, "x-session-id": other },
    });
    await forbidden.body?.cancel();
    assertEquals(forbidden.status >= 400, true);
    const still = await fetch(`${base}/customers/${a.id}`, { headers: H });
    assertEquals(still.status, 200);
    await still.body?.cancel();

    // the owner deletes it
    const del = await fetch(`${base}/customers/${a.id}`, {
      method: "DELETE",
      headers: H,
    });
    assertEquals(del.status, 200);
    assertEquals(await del.json(), { ok: true });

    const gone = await fetch(`${base}/customers/${a.id}`, { headers: H });
    assertEquals(gone.status, 404);
    await gone.body?.cancel();

    const list: { id: string }[] =
      await (await fetch(`${base}/customers`, { headers: H })).json();
    assertEquals(list.some((c) => c.id === a.id), false);
    assertEquals(list.some((c) => c.id === b.id), true);
  });
});

// ── REQ-1138 (LOOP-007 q3, q3-69) ────────────────────────────────────────────
// Deleting a customer who still owes money orphaned the debt: DELETE answered {ok:true} with no word
// about the open balance, the invoice kept pointing at a 404 customer, and GET /clients then put the
// orphaned $820.67 into the headline owed while the "Owe you" chip counted 0.
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class OwesApp {}
const OWES_PORT = 9813;

Deno.test("REQ-1138 (LOOP-007 q3, q3-69) DELETE /customers/:id — a customer with a part-paid open invoice is refused 409 customer_owes ($820.67); ?force=1 deletes; GET /clients' headline owed then agrees with the 'Owe you' count", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(OwesApp, { port: OWES_PORT, swagger: false });
  await server.listen();
  try {
    const base = `http://localhost:${OWES_PORT}`;
    const sid = await login(OWES_PORT, "+15125551138");
    const H = { ...J, "x-session-id": sid };
    const lucia = await fetch(`${base}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Lucía Owes", phoneNumber: "+15125550101" }) }).then((r) => r.json());
    const uid: string = lucia.userId;
    const today = fieldToday();
    const inv = await new InvoiceStore().create(uid, { customerId: lucia.id, status: "sent", amount: 100000, dueDate: shiftDate(today, 14), issuedDate: today, jobName: "Fence repair" } as never);
    // the part payment goes through POST /payments, as the app records it: ComputeInvoiceBalance
    // stamps the invoice's paidCents (a bare PaymentStore row leaves the invoice owing $1,000.00)
    const paid = await fetch(`${base}/payments`, { method: "POST", headers: H, body: JSON.stringify({ invoiceId: inv.id, amount: 17933, method: "cash", receivedAt: today }) });
    assertEquals(paid.status, 200, `the part payment is recorded (${await paid.text()})`);

    // the plain delete is refused: the money must not lose its owner silently
    const refused = await fetch(`${base}/customers/${lucia.id}`, { method: "DELETE", headers: H });
    const refusedBody = await refused.json();
    assertEquals(refused.status, 409, `a customer who owes $820.67 is not deleted silently (got ${refused.status} ${JSON.stringify(refusedBody)})`);
    assertEquals(refusedBody.code, "customer_owes");
    assertEquals(refusedBody.owedCents, 82067);
    assertEquals(refusedBody.invoices, [inv.number]);
    const still = await fetch(`${base}/customers/${lucia.id}`, { headers: H });
    assertEquals(still.status, 200, "the refused delete leaves her on the roster");
    await still.body?.cancel();

    // the explicit "Delete anyway"
    const forced = await fetch(`${base}/customers/${lucia.id}?force=1`, { method: "DELETE", headers: H });
    assertEquals(forced.status, 200);
    assertEquals(await forced.json(), { ok: true });

    // /customers gives one answer to "who owes me"
    const page = await fetch(`${base}/clients`, { headers: H }).then((r) => r.json());
    assertEquals(page.counts.owes, 0, "no live card owes");
    assertEquals(page.summary.owedCents, 0, `the headline owed equals what the cards/chips carry (got ${page.summary.owedCents} with counts.owes=${page.counts.owes})`);
    assertEquals(page.summary.unassignedOwedCents, 82067, "the orphaned balance is reported on its own");
  } finally {
    await server.stop();
    await resetKv();
  }
});
