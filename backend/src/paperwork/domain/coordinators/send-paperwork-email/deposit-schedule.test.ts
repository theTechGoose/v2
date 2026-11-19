/**
 * REQ-945 (LOOP-007 cycle 1, q1-20) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * q1-20 "Quote email never mentions the deposit and has no PDF": a quote on a
 * deposit plan reached the customer with only the total; the deposit
 * ($1,200 of $2,400 on "Deposit 50% + balance") showed up only after they
 * clicked through to /q. The email's money block must carry the same payment
 * schedule rows the /q page and the quote PDF render — in the send language.
 */
import { assert, assertStringIncludes } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderQuoteHtml } from "./mod.ts";

const carl = {
  id: "u-carl",
  name: "Carl",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const bizEn = {
  userId: "u-carl",
  businessName: "Jensen Electric LLC",
  commsLanguage: "en",
} as BusinessIdentity;
const bizEs = { ...bizEn, commsLanguage: "es" } as BusinessIdentity;

function quote(payment: string): Quote {
  return {
    id: "q-1",
    userId: "u-carl",
    number: "Q-001",
    version: 1,
    status: "sent",
    customerSnapshot: { name: "Pat Doe" },
    summary: "Panel upgrade",
    // INTEGER CENTS: $2,400.00
    lineItems: [{ description: "Panel upgrade", quantity: 1, price: 240000 }],
    estimatedTotal: 240000,
    terms: [{ stepId: "payment_terms", label: "Payment terms", value: payment }],
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
  } as unknown as Quote;
}

/** the email's visible text, tags dropped and whitespace collapsed */
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

Deno.test("REQ-945 q1-20: a 'Deposit 50% + balance' quote email for $2,400 states the $1,200.00 deposit, due before work starts (EN)", () => {
  const body = text(renderQuoteHtml(quote("Deposit 50% + balance"), undefined, carl, bizEn));
  assertStringIncludes(body, "$1,200.00", "the deposit amount is in the email");
  assertStringIncludes(body, "Deposit", "the deposit row is labelled");
  assertStringIncludes(body, "Before work starts", "the deposit says when it is due");
  assertStringIncludes(body, "Balance", "the balance row follows the deposit");
});

Deno.test("REQ-945 q1-20: the same deposit quote sent in Spanish states the $1,200.00 depósito, antes de empezar (ES)", () => {
  const body = text(renderQuoteHtml(quote("Deposit 50% + balance"), undefined, carl, bizEs));
  assertStringIncludes(body, "$1,200.00", "the deposit amount is in the Spanish email");
  assertStringIncludes(body, "Depósito", "the deposit row is labelled in Spanish");
  assertStringIncludes(body, "Antes de empezar", "when it is due, in Spanish");
  assertStringIncludes(body, "Saldo", "the balance row, in Spanish");
});

Deno.test("REQ-945 q1-20: a fixed-dollar deposit ('Deposit $500 + balance') shows $500.00 before work starts", () => {
  const body = text(renderQuoteHtml(quote("Deposit $500 + balance"), undefined, carl, bizEn));
  assertStringIncludes(body, "$500.00");
  assertStringIncludes(body, "Before work starts");
});

Deno.test("REQ-945 q1-20: a quote due in full ('Due Now') has no deposit schedule block", () => {
  const body = text(renderQuoteHtml(quote("Due Now"), undefined, carl, bizEn));
  assert(!body.includes("Before work starts"), "no deposit row on a due-now quote");
  assert(!body.includes("$1,200.00"), "no half-payment amount on a due-now quote");
});
