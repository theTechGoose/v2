/**
 * REQ-551 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issue B2: a $999,999,999 payment
 * on a $99,999,999 invoice was accepted with no check, and the totals then
 * disagreed — /payments said $999,999,999, /invoices "Paid this month" said
 * $99,999,999, and the Customers leaderboard said there were no paid
 * invoices at all (the invoice had no customer).
 *
 * Unit level: the shared overpayment decision, the form's validation and
 * confirm step, the server-reason text, the one "paid" KPI definition both
 * pages use, and the leaderboard's no-customer line.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import {
  OVERPAYMENT_HARD_MULTIPLE,
  overpaymentCheck,
} from "../../shared/documents/overpayment.ts";
import {
  paymentErrorText,
  validatePaymentReceived,
} from "./payment-received.ts";
import { ApiError } from "./api.ts";
import { tFor } from "./i18n.ts";
import { creditedPayments, paidKpiInvoiceCents } from "./headline-counts.ts";
import PaymentReceivedForm from "../components/PaymentReceivedForm.tsx";
import { TopClients } from "../components/ClientsSections.tsx";

const DEMO_INVOICE = 9_999_999_900; // $99,999,999.00
const DEMO_PAYMENT = 99_999_999_900; // $999,999,999.00

Deno.test("REQ-551 B2: the shared decision — up to the balance is fine, above it asks, above 10x the invoice is refused", () => {
  assertEquals(OVERPAYMENT_HARD_MULTIPLE, 10);
  assertEquals(
    overpaymentCheck({ paymentCents: 6500, amountCents: 6500, paidCents: 0 }),
    { kind: "ok", balanceCents: 6500 },
  );
  assertEquals(
    overpaymentCheck({ paymentCents: 2000, amountCents: 6500, paidCents: 0 }),
    { kind: "ok", balanceCents: 6500 },
  );
  assertEquals(
    overpaymentCheck({ paymentCents: 7000, amountCents: 6500, paidCents: 0 }),
    { kind: "over", balanceCents: 6500, overCents: 500 },
  );
  // a partial payment already in: the balance is what is left
  assertEquals(
    overpaymentCheck({
      paymentCents: 5000,
      amountCents: 6500,
      paidCents: 2000,
    }),
    { kind: "over", balanceCents: 4500, overCents: 500 },
  );
  // the demo's payment: 10x the invoice and a dollar more
  assertEquals(
    overpaymentCheck({
      paymentCents: DEMO_PAYMENT,
      amountCents: DEMO_INVOICE,
      paidCents: 0,
    }),
    {
      kind: "refuse",
      balanceCents: DEMO_INVOICE,
      limitCents: DEMO_INVOICE * 10,
    },
  );
  // exactly 10x is still only an overpayment to confirm
  assertEquals(
    overpaymentCheck({ paymentCents: 65000, amountCents: 6500, paidCents: 0 })
      .kind,
    "over",
  );
});

Deno.test("REQ-551 B2: the form asks before recording more than is owed, and says by how much", () => {
  const r = validatePaymentReceived({
    method: "zelle",
    dollars: "100",
    date: "2026-11-12",
    amountCents: 6500,
    paidCents: 0,
  });
  assertEquals(r.ok, false);
  assert(!r.ok);
  assertEquals(r.errKey, "invoicesPage.pay.confirmOver");
  assertEquals(r.confirmOver, { overCents: 3500, balanceCents: 6500 });
  assertEquals(
    tFor("en", r.errKey, r.vars),
    "This is $35.00 more than the $65.00 owed. Record it anyway?",
  );
  assertEquals(
    tFor("es", r.errKey, r.vars),
    "Son $35.00 más de los $65.00 que se deben. ¿Registrarlo de todos modos?",
  );
});

Deno.test("REQ-551 B2: once confirmed, the same amount goes through with override", () => {
  const r = validatePaymentReceived({
    method: "zelle",
    dollars: "100",
    date: "2026-11-12",
    amountCents: 6500,
    paidCents: 0,
    confirmedOver: true,
  });
  assert(r.ok);
  assertEquals(r.cents, 10000);
  assertEquals(r.override, true);
});

Deno.test("REQ-551 B2: up to the balance needs no confirm and sends no override", () => {
  const r = validatePaymentReceived({
    method: "cash",
    dollars: "45",
    date: "2026-11-12",
    amountCents: 6500,
    paidCents: 2000,
  });
  assert(r.ok);
  assertEquals(r.override, undefined);
});

Deno.test("REQ-551 B2: more than 10x the invoice is refused outright — no confirm can push it through", () => {
  for (const confirmedOver of [false, true]) {
    const r = validatePaymentReceived({
      method: "card",
      dollars: "999999999",
      date: "2026-11-12",
      amountCents: DEMO_INVOICE,
      paidCents: 0,
      confirmedOver,
    });
    assert(!r.ok);
    assertEquals(r.errKey, "invoicesPage.pay.errTooMuch");
    assertEquals(r.confirmOver, undefined);
    assertEquals(
      tFor("en", r.errKey, r.vars),
      "That's more than 10 times the $99,999,999.00 invoice. Check the amount.",
    );
    assertEquals(
      tFor("es", r.errKey, r.vars),
      "Es más de 10 veces la factura de $99,999,999.00. Revisa el monto.",
    );
  }
});

Deno.test("REQ-551 B2: the server's overpayment refusals are worded, never the raw code", () => {
  assertEquals(
    paymentErrorText(
      "en",
      new ApiError(409, {
        ok: false,
        error: "overpayment",
        reason: "overpayment",
        balanceCents: 6500,
        overCents: 3500,
      }),
    ),
    "This is $35.00 more than the $65.00 owed. Record it anyway?",
  );
  assertEquals(
    paymentErrorText(
      "es",
      new ApiError(422, {
        ok: false,
        error: "overpayment_limit",
        reason: "overpayment_limit",
        amountCents: DEMO_INVOICE,
        limitCents: DEMO_INVOICE * 10,
      }),
    ),
    "Es más de 10 veces la factura de $99,999,999.00. Revisa el monto.",
  );
});

Deno.test("REQ-551 B2: the form prefills the balance still owed, not the face amount", () => {
  const html = renderToString(
    <PaymentReceivedForm
      invoiceId="inv1"
      amountCents={6500}
      paidCents={2000}
      lang="en"
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const amt = doc.querySelector("[data-cy=pay-received-amount]") as Element;
  assertEquals(amt.getAttribute("value"), "45");
});

Deno.test("REQ-551 B2: one 'paid' definition — an invoice counts what it was owed, never what was overpaid", () => {
  assertEquals(
    paidKpiInvoiceCents({ amount: DEMO_INVOICE, paidCents: DEMO_PAYMENT }),
    DEMO_INVOICE,
  );
  assertEquals(paidKpiInvoiceCents({ amount: 6500, paidCents: 2000 }), 2000);
  // a paid invoice from before paidCents existed counts its amount
  assertEquals(paidKpiInvoiceCents({ amount: 6500 }), 6500);
});

Deno.test("REQ-551 B2: /payments credits each payment up to what its invoice still owed; the rest is overpaid — the two pages agree", () => {
  const invoices = [{ id: "i1", amount: DEMO_INVOICE }, {
    id: "i2",
    amount: 10000,
  }];
  const payments = [
    {
      id: "p1",
      invoiceId: "i1",
      amount: DEMO_PAYMENT,
      receivedAt: "2026-11-12T12:00:00.000Z",
      createdAt: "2026-11-12T12:00:00.000Z",
    },
    {
      id: "p2",
      invoiceId: "i2",
      amount: 6000,
      receivedAt: "2026-11-01T12:00:00.000Z",
      createdAt: "2026-11-01T12:00:00.000Z",
    },
    {
      id: "p3",
      invoiceId: "i2",
      amount: 6000,
      receivedAt: "2026-11-05T12:00:00.000Z",
      createdAt: "2026-11-05T12:00:00.000Z",
    },
  ];
  const c = creditedPayments(payments, invoices);
  assertEquals(c.get("p1"), {
    creditedCents: DEMO_INVOICE,
    overCents: 90_000_000_000,
  });
  assertEquals(c.get("p2"), { creditedCents: 6000, overCents: 0 });
  assertEquals(c.get("p3"), { creditedCents: 4000, overCents: 2000 });
  // /payments month total == /invoices paid-this-month total
  const paymentsTotal = [...c.values()].reduce(
    (s, x) => s + x.creditedCents,
    0,
  );
  const invoicesTotal = paidKpiInvoiceCents({
    amount: DEMO_INVOICE,
    paidCents: DEMO_PAYMENT,
  }) + paidKpiInvoiceCents({ amount: 10000, paidCents: 12000 });
  assertEquals(paymentsTotal, invoicesTotal);
});

Deno.test("REQ-551 B2: the leaderboard says paid invoices with no customer are not ranked, instead of 'no paid invoices'", () => {
  const html = renderToString(
    <TopClients
      rows={[]}
      unassigned={{ invoiceCount: 1, revenue12moCents: DEMO_INVOICE }}
      lang="es"
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const line = doc.querySelector("[data-cy=top-clients-unassigned]") as
    | Element
    | null;
  assert(line, "the no-customer line renders");
  assertEquals(
    line.textContent.trim(),
    "1 factura pagada sin cliente ($99,999,999) no entra en el ranking.",
  );
  assert(
    !html.includes(tFor("es", "topClients.empty")),
    "it no longer says there are no paid invoices",
  );
});
