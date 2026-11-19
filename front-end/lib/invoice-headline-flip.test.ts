/**
 * REQ-984 (LOOP-007 q1-60) — the island-side headline rebuild agrees with the
 * server's invoiceHeadline: after a claim "Payment reported", never "Sent".
 *
 *   cd front-end && deno test -A lib/invoice-headline-flip.test.ts
 */
import { assertEquals } from "@std/assert";
import { headlineFor } from "./invoice-headline-flip.ts";
import { invoiceTitle } from "../../shared/documents/linked-view.ts";

const attrs = (a: Record<string, string>) => ({
  getAttribute: (n: string) => a[n] ?? null,
});

Deno.test("REQ-984 (q1-60): a claimed invoice's rebuilt headline reads 'Payment reported' in EN and ES", () => {
  const el = attrs({
    "data-headline-number": "INV-001",
    "data-headline-version": "1",
  });
  assertEquals(
    headlineFor(el, "claimed", "en"),
    "INV-001 · Version 1 · Payment reported",
  );
  assertEquals(
    headlineFor(el, "claimed", "es"),
    "INV-001 · Versión 1 · Pago reportado",
  );
});

Deno.test("REQ-984 (q1-60): a card-paid invoice's rebuilt headline reads 'Paid' with the payment date", () => {
  const el = attrs({
    "data-headline-number": "INV-002",
    "data-headline-version": "2",
  });
  assertEquals(
    headlineFor(el, "paid", "en", "2026-11-18T12:00:00.000Z"),
    "INV-002 · Version 2 · Paid · Nov 18, 2026",
  );
});

Deno.test("REQ-984 (q1-60): no headline parts on the page → nothing is rewritten", () => {
  assertEquals(headlineFor(attrs({}), "claimed", "en"), undefined);
});

Deno.test("REQ-984 (q1-60): invoiceTitle — job, else summary, else the first line, else 'Invoice INV-001' / 'Factura INV-001'", () => {
  assertEquals(invoiceTitle({ number: "INV-001" }, "en"), "Invoice INV-001");
  assertEquals(invoiceTitle({ number: "INV-001" }, "es"), "Factura INV-001");
  assertEquals(
    invoiceTitle({ number: "INV-001", jobName: " Deck ", summary: "x" }),
    "Deck",
  );
  assertEquals(invoiceTitle({ number: "INV-001", summary: "Roof" }), "Roof");
  assertEquals(
    invoiceTitle({ number: "INV-001", lineDescriptions: ["Gutter cleaning"] }),
    "Gutter cleaning",
  );
  assertEquals(
    invoiceTitle({ number: "INV-001", lineDescriptions: [" ", "A", "B"] }),
    "A",
  );
});
