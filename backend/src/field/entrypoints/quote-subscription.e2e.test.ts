/**
 * REQ-699 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue M20: pair 2 quoted "4 visitas al mes, $180
 * al mes"; the payment step had no monthly option (fleet-1 stdout:406), the
 * signature billed a one-time $180 (INV-001) and Campo → Suscripciones said
 * "0 ACTIVAS" (fleet-1 stdout:433).
 *
 * End to end over HTTP, the app booted (Field with the paperwork, customer
 * and user modules it imports): the owner's monthly quote is signed on the
 * PUBLIC accept, nothing is billed as a one-off, Field → Subscriptions holds
 * the subscription linked to the quote and reads "Monthly · $180/mo", and the
 * first period's visit, done and pulled by the Field batch, is a $180 invoice.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fieldToday } from "@field/domain/business/schedule/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const J = { "content-type": "application/json" };

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  const r = await fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: { ...J, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch { /* raw */ }
  return { status: r.status, body: parsed };
}

async function login(phone: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name: "Jorge Ramirez", language: "es" }, H);
  return H;
}

Deno.test("REQ-699 M20 e2e: pair 2's monthly quote, signed on the public page, becomes a Field subscription that bills $180 a period — never a one-off invoice", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const H = await login("+15125556990");
    const maria = (await call("POST", "/customers", {
      name: "María López",
      phoneNumber: "(305) 555-0144",
      email: "maria@blackhole.postmarkapp.com",
    }, H)).body;
    assert(maria?.id, `customer: ${JSON.stringify(maria)}`);

    // the agreement the terms wizard writes for "$180 al mes" → Recurring
    const q = await call("POST", "/quotes", {
      customerId: maria.id,
      summary: "Corte de césped y poda de setos",
      jobName: "Corte de césped",
      serviceAddress: "845 Palm Ave, Orlando, FL 32803",
      lineItems: [{
        description:
          "Mantenimiento mensual de jardín — corte de césped y poda de setos (4 visitas al mes)",
        quantity: 1,
        unit: "month",
        price: 18_000,
      }],
      estimatedTotal: 18_000,
      terms: [
        { stepId: "start_date", label: "Start", value: "Right away" },
        { stepId: "wraps", label: "Time to complete", value: "2 hours" },
        {
          stepId: "payment_terms",
          label: "Payment",
          value: "Monthly · $180/mo",
        },
      ],
    }, H);
    assertEquals(q.status < 300, true, `create quote → ${q.status}`);
    await call("PUT", `/quotes/${q.body.id}`, { status: "sent" }, H);

    // María signs on /q
    const accepted = await call("POST", `/quotes/${q.body.id}/accept`, {
      name: "María López",
    });
    assertEquals(accepted.body?.ok, true, JSON.stringify(accepted.body));

    // no one-off $180 invoice (the demo's INV-001)
    const invoices = (await call("GET", "/invoices", undefined, H)).body as {
      quoteId?: string;
    }[];
    assertEquals(
      invoices.filter((i) => i.quoteId === q.body.id),
      [],
      "a recurring quote is billed by its subscription, not at signing",
    );

    // Campo → Suscripciones: 1 active, linked to Q-00x, "Monthly · $180/mo"
    const subs = (await call("GET", "/field/subscriptions", undefined, H)).body;
    assertEquals(subs.length, 1, JSON.stringify(subs));
    const s = subs[0];
    const today = fieldToday();
    assertEquals(
      [
        s.quoteId,
        s.quoteNumber,
        s.customerName,
        s.cadence,
        s.startDate,
        s.active,
      ],
      [q.body.id, q.body.number, "María López", "monthly", today, true],
    );
    assertEquals(
      s.items.map((i: { taskTypeName: string; priceCents: number }) => [
        i.taskTypeName,
        i.priceCents,
      ]),
      [["Corte de césped", 18_000]],
    );
    assertEquals(s.billing, {
      en: "Monthly · $180/mo",
      es: "Mensual · $180/mes",
    });
    assert(s.region?.id, "zoned, so a worker can be put on it");

    // the first period: Pedro covers the zone, the visit is done, the batch bills it
    const pedro = (await call("POST", "/field/workers", {
      name: "Pedro",
      phoneNumber: "843-555-0299",
      pin: "4321",
    }, H)).body;
    await call("PUT", `/field/regions/${s.region.id}/worker`, {
      workerId: pedro.id,
    }, H);
    const day = (await call("GET", `/field/tasks?date=${today}`, undefined, H))
      .body as { id: string; subscriptionId: string; priceCents: number }[];
    const visit = day.filter((t) => t.subscriptionId === s.id);
    assertEquals(visit.map((t) => t.priceCents), [18_000]);
    const done = await call("PUT", `/field/tasks/${visit[0].id}`, {
      status: "complete",
    }, H);
    assertEquals(done.status, 200, JSON.stringify(done.body));
    const pulled = await call("POST", "/field/batches/pull", {
      from: today,
      to: today,
    }, H);
    assertEquals(pulled.status, 201, JSON.stringify(pulled.body));
    assertEquals(
      pulled.body.invoices.map((
        i: { customerName: string; amount: number; status: string },
      ) => [i.customerName, i.amount, i.status]),
      [["María López", 18_000, "draft"]],
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
