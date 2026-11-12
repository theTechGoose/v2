/**
 * REQ-271 — demo issue i18n-formatting-m5: a customer added a minute ago wore "Regular" /
 * "Habitual". deriveStatus had no "new" state: with no quotes, no invoices and a recent contact
 * every branch was skipped and the fallback returned "regular".
 */
import { assertEquals } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import { deriveStatus } from "./mod.ts";

const base = {
  balanceCents: 0,
  acceptedQuotes: [] as Quote[],
  myQuotes: [] as Quote[],
  activeJobs: 0,
  revenue12moCents: 0,
  daysSinceContact: 0,
  paidInvoiceCount: 0,
};

Deno.test("REQ-271 deriveStatus — no quotes, no invoices, contacted today: new, not regular", () => {
  assertEquals(deriveStatus(base), "new");
});

Deno.test("REQ-271 deriveStatus — paid work in the last year stays regular", () => {
  assertEquals(
    deriveStatus({ ...base, revenue12moCents: 50_000, paidInvoiceCount: 1 }),
    "regular",
  );
});

Deno.test("REQ-271 deriveStatus — an untouched customer quiet for 90 days is cold, not new", () => {
  assertEquals(deriveStatus({ ...base, daysSinceContact: 90 }), "cold");
});

Deno.test("REQ-271 deriveStatus — paid before (older than a year), nothing open: regular, not new", () => {
  assertEquals(
    deriveStatus({ ...base, paidInvoiceCount: 1, daysSinceContact: 10 }),
    "regular",
  );
});

/**
 * REQ-323 (demo-loop cycle 1, m20): the card carries the customer's documents —
 * one row per quote / invoice with its number, state, amount and link.
 */
import type { Invoice } from "@paperwork/dto/invoice.ts";
import { documentsFor } from "./mod.ts";

Deno.test("REQ-323 documentsFor — a sent quote and a pending invoice become two linked rows, newest first", () => {
  const quote = {
    id: "q-1",
    number: "Q-001",
    status: "sent",
    estimatedTotal: 950_000,
    updatedAt: "2026-04-20T00:00:00.000Z",
  } as unknown as Quote;
  const invoice = {
    id: "i-1",
    number: "INV-5000",
    status: "pending",
    amount: 400_000,
    updatedAt: "2026-04-21T00:00:00.000Z",
  } as unknown as Invoice;
  const docs = documentsFor([quote], [invoice]);
  assertEquals(docs, [
    {
      kind: "invoice",
      id: "i-1",
      number: "INV-5000",
      state: "sent",
      amountCents: 400_000,
      url: "/i/i-1",
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
    {
      kind: "quote",
      id: "q-1",
      number: "Q-001",
      state: "sent",
      amountCents: 950_000,
      url: "/quotes?open=q-1",
      updatedAt: "2026-04-20T00:00:00.000Z",
    },
  ]);
});

Deno.test("REQ-323 documentsFor — the onboarding sample quote is not a document of the customer", () => {
  const sample = {
    id: "q-s",
    status: "draft",
    estimatedTotal: 1,
    isSample: true,
    updatedAt: "2026-04-21T00:00:00.000Z",
  } as unknown as Quote;
  assertEquals(documentsFor([sample], []), []);
});
