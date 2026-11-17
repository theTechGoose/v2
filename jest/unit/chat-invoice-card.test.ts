/**
 * REQ-368 (demo-loop cycle 1, M32) — the invoice card in the assistant chat.
 *
 * Pair 1: "John signed! Please send him the deposit invoice for $1,600". The
 * deposit invoice (INV-001) had gone out at signing; the assistant now
 * answers with it as an invoice card — actionType "invoice", the payload
 * SendInvoice's "sent" card already carries. The island's card renderer only
 * knew quote cards: an invoice card got the quote's "Re-open" button (which
 * posts "Re-open the quote." against the signed quote) and no way to open the
 * invoice, and the send preview / payment-step preview took its $1,600 for
 * the quote's.
 *
 * Shared logic: shared/quote-flow/chat-invoice-card.ts.
 */
import * as fs from "fs";
import * as path from "path";
import {
  invoiceCardHref,
  isInvoiceCardPayload,
  isQuoteCardPayload,
} from "../../shared/quote-flow/chat-invoice-card";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** What AnswerBilling (and SendInvoice) put on an invoice card. */
const DEPOSIT_CARD = {
  actionType: "invoice",
  status: "sent",
  invoiceId: "inv-1",
  quoteId: "q-1",
  lineItems: [{ description: "Deposit (1 of 2)", amountCents: 160_000 }],
  totalCents: 160_000,
};

describe("REQ-368 M32: an invoice card links to the invoice and is never read as the quote", () => {
  test("REQ-368: an invoice card opens that invoice on the Invoices page", () => {
    expect(isInvoiceCardPayload(DEPOSIT_CARD)).toBe(true);
    expect(invoiceCardHref(DEPOSIT_CARD)).toBe("/invoices?open=inv-1");
  });

  test("REQ-368: the invoice id is URL-encoded", () => {
    expect(
      invoiceCardHref({ actionType: "invoice", invoiceId: "a b/c&d" }),
    ).toBe("/invoices?open=a%20b%2Fc%26d");
  });

  test("REQ-368: an invoice card without an id is still an invoice card — it just has no link", () => {
    for (const invoiceId of [undefined, "", "   ", 42]) {
      const p = { actionType: "invoice", invoiceId };
      expect(isInvoiceCardPayload(p)).toBe(true);
      expect(isQuoteCardPayload(p)).toBe(false);
      expect(invoiceCardHref(p)).toBeUndefined();
    }
  });

  test("REQ-368: a quote card — or a card with no actionType, as older threads have — is a quote card with no invoice link", () => {
    for (const p of [{ actionType: "quote" }, {}, undefined, null]) {
      expect(isQuoteCardPayload(p)).toBe(true);
      expect(isInvoiceCardPayload(p)).toBe(false);
      expect(invoiceCardHref(p)).toBeUndefined();
    }
    // an id on a quote card is not an invoice link
    expect(
      invoiceCardHref({ actionType: "quote", invoiceId: "inv-1" }),
    ).toBeUndefined();
    expect(isQuoteCardPayload(DEPOSIT_CARD)).toBe(false);
  });

  test("REQ-368: the island renders an invoice card on its own branch, ahead of the quote card's buttons", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const invoiceBranch = src.indexOf("isInvoiceCardPayload(");
    const quoteBranch = src.indexOf('if (m.kind === "action_card") {');
    expect(invoiceBranch).toBeGreaterThan(0);
    expect(quoteBranch).toBeGreaterThan(0);
    expect(invoiceBranch).toBeLessThan(quoteBranch);
    const branch = src.slice(invoiceBranch, quoteBranch);
    expect(branch).toMatch(/invoiceCardHref\(/);
    expect(branch).toMatch(/asstChat\.invoiceFlow\.viewInvoice/);
    expect(branch).not.toMatch(/lockActionCard|Re-open the quote/);
  });

  test("REQ-368: the send preview and the payment-step preview read quote cards only", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const at = (needle: string) => {
      const i = src.indexOf(needle);
      expect(i).toBeGreaterThan(0);
      return src.slice(i, i + 900);
    };
    expect(at("function latestSentQuoteCents(")).toMatch(
      /isQuoteCardPayload\(/,
    );
    expect(at("const lockedCard = [...messages]")).toMatch(
      /isQuoteCardPayload\(/,
    );
  });
});
