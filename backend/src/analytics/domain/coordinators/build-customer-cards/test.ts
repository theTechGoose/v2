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
  completedJobs: 0,
};

Deno.test("REQ-271 deriveStatus — no quotes, no invoices, contacted today: new, not regular", () => {
  assertEquals(deriveStatus(base), "new");
});

Deno.test("REQ-271 deriveStatus — paid work in the last year stays regular (REQ-562: two completed jobs)", () => {
  assertEquals(
    deriveStatus({
      ...base,
      revenue12moCents: 50_000,
      paidInvoiceCount: 2,
      completedJobs: 2,
    }),
    "regular",
  );
});

Deno.test("REQ-271 deriveStatus — an untouched customer quiet for 90 days is cold, not new", () => {
  assertEquals(deriveStatus({ ...base, daysSinceContact: 90 }), "cold");
});

Deno.test("REQ-271 deriveStatus — paid before (older than a year), nothing open: regular, not new (REQ-562: two completed jobs)", () => {
  assertEquals(
    deriveStatus({
      ...base,
      paidInvoiceCount: 2,
      completedJobs: 2,
      daysSinceContact: 10,
    }),
    "regular",
  );
});

/**
 * REQ-562 — demo-loop cycle 4, m21: a brand-new client whose first (50/50) job
 * had its deposit paid wore "Regular". A first job in progress is "active";
 * "regular" takes at least two completed jobs.
 */
Deno.test("REQ-562 (cycle 4, m21) deriveStatus — first job in flight, deposit paid, balance scheduled: active, not regular", () => {
  assertEquals(
    deriveStatus({
      ...base,
      acceptedQuotes: [{ id: "q" } as Quote],
      myQuotes: [{ id: "q" } as Quote],
      activeJobs: 1,
      revenue12moCents: 1_425_00,
      paidInvoiceCount: 1,
    }),
    "active",
  );
});

Deno.test("REQ-562 (cycle 4, m21) deriveStatus — one completed job, nothing open, contacted recently: not regular yet", () => {
  const status = deriveStatus({
    ...base,
    acceptedQuotes: [{ id: "q" } as Quote],
    myQuotes: [{ id: "q" } as Quote],
    revenue12moCents: 2_850_00,
    paidInvoiceCount: 2,
    completedJobs: 1,
  });
  assertEquals(status, "new");
});

Deno.test("REQ-562 (cycle 4, m21) deriveStatus — two completed jobs, nothing open: regular", () => {
  assertEquals(
    deriveStatus({
      ...base,
      acceptedQuotes: [{ id: "a" } as Quote, { id: "b" } as Quote],
      myQuotes: [{ id: "a" } as Quote, { id: "b" } as Quote],
      revenue12moCents: 5_000_00,
      paidInvoiceCount: 3,
      completedJobs: 2,
    }),
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

/**
 * REQ-565 (demo-loop cycle 4, m33): the customer card left change orders out
 * and showed the quote at its original total. documentsFor lists each change
 * order (its number, state, signed amount and /co link) and words the quote at
 * the agreed total — the quote plus its approved change orders.
 */
import type { ChangeOrder } from "@paperwork/dto/change-order.ts";

const signed = {
  id: "q-9",
  number: "Q-001",
  status: "accepted",
  acceptedAt: "2026-11-10T00:00:00.000Z",
  estimatedTotal: 705_000,
  updatedAt: "2026-11-10T00:00:00.000Z",
} as unknown as Quote;
const co = (
  id: string,
  number: string,
  status: ChangeOrder["status"],
  deltaAmountCents: number,
  updatedAt: string,
) =>
  ({
    id,
    userId: "u-1",
    invoiceId: "i-9",
    quoteId: "q-9",
    number,
    description: "Glass door",
    deltaAmountCents,
    status,
    createdAt: updatedAt,
    updatedAt,
  }) as ChangeOrder;

Deno.test("REQ-565 m33 documentsFor — a change order is a row of its own: number, state, signed amount, its /co link", () => {
  const docs = documentsFor([signed], [], [
    co("co-1", "CO-001", "pending", 120_000, "2026-11-11T00:00:00.000Z"),
  ]);
  assertEquals(docs[0], {
    kind: "change_order",
    id: "co-1",
    number: "CO-001",
    state: "pending",
    amountCents: 120_000,
    url: "/co/co-1",
    updatedAt: "2026-11-11T00:00:00.000Z",
  });
  assertEquals(docs.length, 2);
});

Deno.test("REQ-565 m33 documentsFor — the quote row shows the agreed total: the quote plus its APPROVED change orders only", () => {
  const docs = documentsFor([signed], [], [
    co("co-1", "CO-001", "approved", 120_000, "2026-11-11T00:00:00.000Z"),
    co("co-2", "CO-002", "approved", -20_000, "2026-11-11T01:00:00.000Z"),
    co("co-3", "CO-003", "pending", 50_000, "2026-11-11T02:00:00.000Z"),
    co("co-4", "CO-004", "declined", 90_000, "2026-11-11T03:00:00.000Z"),
  ]);
  const quote = docs.find((d) => d.kind === "quote")!;
  assertEquals(quote.amountCents, 805_000);
  assertEquals(quote.changeOrdersCents, 100_000);
  assertEquals(
    docs.filter((d) => d.kind === "change_order").map((d) => d.number),
    ["CO-004", "CO-003", "CO-002", "CO-001"],
  );
});

Deno.test("REQ-565 m33 documentsFor — a quote with no approved change order keeps its own total and no change-order note", () => {
  const [quote] = documentsFor([signed], [], [
    co("co-3", "CO-003", "pending", 50_000, "2026-11-09T00:00:00.000Z"),
  ]).filter((d) => d.kind === "quote");
  assertEquals(quote.amountCents, 705_000);
  assertEquals("changeOrdersCents" in quote, false);
});
