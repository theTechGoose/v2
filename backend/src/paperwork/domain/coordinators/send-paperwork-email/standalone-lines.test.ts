/**
 * REQ-1127 — Raphael: "test every single aspect of this application … one Opus
 * agent per issue to do root cause analysis, then one to write the test, then
 * one to fix it and make it green." LOOP-007 cycle 3, issue q3-55: "Invoice
 * email lists line items without their prices."
 *
 * A standalone invoice (no quote) built from REQ-921 service rows has its own
 * `lineItems`. renderInvoiceHtml only itemizes from the linked quote, so the
 * standalone one falls to renderInvoiceBasicHtml ("amount-only"), which prints
 * the jobName (the joined service names) and the subtotal, never a line price.
 * REQ-946 promises the invoice email still shows the line items (the work).
 */
import { assert } from "#std/assert";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderInvoiceHtml } from "./mod.ts";

const dana = {
  id: "u-dana",
  name: "Dana Whitfield",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const biz = (lang: "en" | "es") =>
  ({
    userId: "u-dana",
    businessName: "Whitfield Fence & Gate",
    commsLanguage: lang,
  }) as BusinessIdentity;

/** A New-invoice (REQ-921) standalone bill: two service rows, no quote. */
const invoice = {
  id: "i-3",
  userId: "u-dana",
  number: "INV-003",
  customerId: "c-1",
  status: "sent",
  jobName: "Gate repair, Hinge hardware",
  lineItems: [
    { description: "Gate repair", quantity: 1, unit: "ea", price: 18010 },
    { description: "Hinge hardware", quantity: 1, unit: "ea", price: 4520 },
  ],
  amount: 22530,
  subtotalCents: 22530,
  billTo: { name: "Rosa Delgado" },
  issuedDate: "2026-10-01",
  dueDate: "2026-10-08",
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-10-01T12:00:00Z",
} as unknown as Invoice;

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

for (const lang of ["en", "es"] as const) {
  Deno.test(
    `REQ-1127 (q3-55) ${lang}: the email of a standalone two-line invoice prints each line's price`,
    () => {
      const body = text(
        renderInvoiceHtml(invoice, undefined, dana, biz(lang)),
      );
      // the total is there today — the bug is the missing per-line prices
      assert(body.includes("$225.30"), "the amount due is missing");
      assert(
        body.includes("$180.10"),
        `the "Gate repair" line's price $180.10 is missing from the email: …${
          body.slice(
            Math.max(0, body.indexOf("Gate repair") - 40),
            body.indexOf("Gate repair") + 260,
          )
        }`,
      );
      assert(
        body.includes("$45.20"),
        `the "Hinge hardware" line's price $45.20 is missing from the email`,
      );
    },
  );
}
