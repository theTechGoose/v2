/**
 * REQ-555 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issue M24: on /payments the
 * card's "View receipt →" and the back's Receipt / Match invoice / Text
 * client were placeholders whose only handler was e.stopPropagation(); on
 * /invoices the send-failure note sat outside the card body, over the back
 * face's "Open" hit area, and "Open" lived only on the back face.
 *
 * - every payment-card action has a destination: the receipt is the paid
 *   invoice's page /i/<invoiceId>, the invoice is /invoices?open=<id>;
 * - no button on either island is a stopPropagation-only placeholder;
 * - the invoice card's front face carries its own Open link and renders the
 *   send notes inside .qcard__body (browser proof:
 *   e2e/payment-card-actions).
 */
import { assert, assertEquals } from "@std/assert";
import { paymentCardCtaHref, paymentCardLinks } from "./payment-card.ts";

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

Deno.test("REQ-555 M24: the receipt is the paid invoice's own page, the invoice opens its /invoices detail", () => {
  assertEquals(paymentCardLinks("inv-1"), {
    receipt: "/i/inv-1",
    invoice: "/invoices?open=inv-1",
  });
  // ids are path/query-safe
  assertEquals(paymentCardLinks("a b/c").receipt, "/i/a%20b%2Fc");
  assertEquals(paymentCardLinks("a b/c").invoice, "/invoices?open=a%20b%2Fc");
});

Deno.test("REQ-555 M24: a landed card's CTA ('View receipt') opens the receipt; an in-transit card's ('View timeline') opens the invoice", () => {
  assertEquals(paymentCardCtaHref("landed", "inv-1"), "/i/inv-1");
  assertEquals(paymentCardCtaHref("transit", "inv-1"), "/invoices?open=inv-1");
});

Deno.test("REQ-555 M24: /payments has no stopPropagation-only placeholder buttons", () => {
  const s = src("../islands/PaymentsPage.tsx");
  const card = s.slice(
    s.indexOf("function PaymentCard("),
    s.indexOf("/* ---------------- Claim card"),
  );
  assert(card.length > 0, "PaymentCard found");
  assert(
    !/onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(card),
    "a button whose only handler is e.stopPropagation() does nothing",
  );
  for (
    const cy of [
      "payment-card-cta",
      "payment-card-receipt",
      "payment-card-invoice",
      "payment-card-text",
    ]
  ) {
    assert(s.includes(`data-cy="${cy}"`), `PaymentCard renders ${cy}`);
  }
  assert(
    s.includes("/api/invoices/${p.invoiceId}/text"),
    "Text client texts the client the invoice (receipt) link",
  );
});

Deno.test("REQ-555 M24: the invoice card front has its own Open link and the send notes live inside the card body", () => {
  const s = src("../islands/InvoicesPage.tsx");
  assert(
    s.includes('data-cy="invoice-card-open"'),
    "front-face Open link",
  );
  // The notes component, never a bare <p class="qcard__sendfail"> sibling of
  // .qcard__back.
  const card = s.slice(
    s.indexOf("class={`qcard qcard--inv"),
    s.indexOf("/* ---------------- New invoice modal"),
  );
  const body = card.indexOf('<div class="qcard__body">');
  const foot = card.indexOf('<div class="qcard__foot">');
  const back = card.indexOf('<div class="qcard__back"');
  const notes = card.indexOf("<CardSendNotes");
  assert(notes > body && notes < foot, "the notes render inside .qcard__body");
  assert(
    card.indexOf('class="qcard__sendfail"') === -1 ||
      card.indexOf('class="qcard__sendfail"') > back,
    "no send note between the front foot and the back face",
  );
});
