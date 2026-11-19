/**
 * REQ-954 (LOOP-007 cycle 1, q1-26) — "Deposit deadline: 'First invoice due
 * in 7 days' vs 'Before work starts'". On a signed /q the payment schedule's
 * DEPOSIT card read a fixed "Before work starts" (computeMilestones' deposit
 * role → quoteDoc.milestone.beforeStart) while the deposit invoice the
 * signature created carries its own dueDate (net-7) and the email names that
 * one. Once the deposit invoice exists, the schedule's deposit row must state
 * the invoice's due date — the one stored deadline — not "Before work starts".
 */
import { assert } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";
import { shortDate } from "../../shared/documents/linked-view.ts";
import { tFor } from "./i18n.ts";

const DEPOSIT_DUE = "2026-11-25";

function signedDepositQuote(): QuotePublic {
  return {
    id: "q-954",
    number: "Q-005",
    version: 1,
    state: "accepted",
    status: "accepted",
    acceptedAt: "2026-11-18T15:00:00.000Z",
    acceptedName: "Dana Whitfield",
    customer: { name: "Dana Whitfield", email: "dana@example.com" },
    contractor: { name: "Maria Castro", businessName: "Castro Remodeling" },
    summary: "Kitchen remodel",
    estimatedTotal: 23_250_00,
    startDate: "2026-11-28",
    estimatedCompletionDate: "2026-12-12",
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 23_250_00,
    }],
    terms: [{
      stepId: "payment_terms",
      label: "Payment",
      value: "Deposit + balance",
    }],
    // the deposit the signature billed (sent; the balance is still scheduled
    // and so is not on the public projection — REQ-312)
    invoices: [{
      id: "inv-954",
      number: "INV-001",
      status: "sent",
      amountCents: 4_650_00,
      balanceCents: 4_650_00,
      dueDate: DEPOSIT_DUE,
      url: "/i/inv-954",
    }],
  } as QuotePublic;
}

function depositCardText(lang: "en" | "es"): string {
  const html = renderToString(
    <QuoteDoc quote={signedDepositQuote()} lang={lang} />,
  );
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
  const cards = [...doc.querySelectorAll(".ctr__milestones > div")];
  assert(cards.length >= 2, `a deposit + balance schedule: ${cards.length}`);
  const deposit = cards.find((c) =>
    (c.textContent ?? "").toLowerCase().includes(
      tFor(lang, "quoteDoc.milestone.deposit").toLowerCase(),
    )
  );
  assert(deposit, "the schedule has a deposit card");
  return (deposit.textContent ?? "").replace(/\s+/g, " ");
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-954 (LOOP-007 q1-26) [${lang}]: a signed quote's DEPOSIT schedule row names the deposit invoice's due date, not "Before work starts"`, () => {
    const text = depositCardText(lang);
    const before = tFor(lang, "quoteDoc.milestone.beforeStart");
    assert(
      !text.includes(before),
      `the deposit row must not say "${before}" when its invoice is due ${DEPOSIT_DUE}: "${text}"`,
    );
    const short = shortDate(DEPOSIT_DUE, lang, false); // "Nov 25" / "25 nov"
    assert(
      text.toLowerCase().includes(short.toLowerCase()),
      `the deposit row names the invoice's due date "${short}": "${text}"`,
    );
  });
}
