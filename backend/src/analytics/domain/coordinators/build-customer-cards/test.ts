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
