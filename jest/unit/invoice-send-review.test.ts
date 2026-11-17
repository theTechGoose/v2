/**
 * REQ-776 — Raphael: "Finish and send should have a review step." (and
 * "fix every issue the demo found, loop until there are none"). Demo-loop
 * cycle dv1, issue d3: "'Finish + send' on an invoice has a review step
 * before anything is sent" — the REQ-727 send sheet asked for the channel
 * and language, but did not show WHAT was being sent: the amount, the line
 * items, who it goes to and when it is due.
 *
 * Pure rules: front-end/lib/invoice-send-sheet.ts `invoiceSendReview`.
 * Wiring: the island hands the sheet the invoice's review; the dialog
 * renders it (proven in the browser by e2e/invoice-send-sheet).
 */
import * as fs from "fs";
import * as path from "path";
import { invoiceSendReview } from "../../front-end/lib/invoice-send-sheet.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-776 dv1-d3 the Finish + send review — what is being sent", () => {
  it("REQ-776 the amount, each line item (qty × unit price) and the due date the send stamps", () => {
    const r = invoiceSendReview(
      {
        amount: 72500,
        dueDate: "2026-12-31",
        lineItems: [
          { description: "Paint gate", quantity: 2, price: 30000 },
          { description: "Primer", quantity: 1, price: 12500 },
        ],
      },
      { issuedDate: "2026-11-13", dueDate: "2026-11-28" },
    );
    expect(r).toEqual({
      totalCents: 72500,
      lines: [
        { description: "Paint gate", quantity: 2, amountCents: 60000 },
        { description: "Primer", quantity: 1, amountCents: 12500 },
      ],
      dueDate: "2026-11-28",
    });
  });

  it("REQ-776 no new due date → the invoice's own; an amount-only invoice has no lines; junk lines are dropped", () => {
    const r = invoiceSendReview(
      {
        amount: 5000,
        dueDate: "2026-12-01",
        lineItems: [null, { description: "  " }, "x"] as unknown[],
      },
      {},
    );
    expect(r).toEqual({ totalCents: 5000, lines: [], dueDate: "2026-12-01" });
    expect(invoiceSendReview({}, {})).toEqual({ totalCents: 0, lines: [] });
  });

  it("REQ-776 the island hands the sheet the invoice's review", () => {
    const island = read("front-end/islands/InvoicesPage.tsx");
    const at = island.indexOf("<InvoiceSendDialog");
    expect(at).toBeGreaterThan(-1);
    expect(island.slice(at, at + 1500)).toMatch(
      /review=\{invoiceSendReview\(\s*sendSheet\.inv,\s*sendSheet\.dates/,
    );
  });

  it("REQ-776 the review's copy exists in en and es", () => {
    for (
      const k of [
        "invoicesPage.send.reviewAmount",
        "invoicesPage.send.reviewItems",
        "invoicesPage.send.reviewTo",
        "invoicesPage.send.reviewDue",
        "invoicesPage.send.reviewNoDue",
        "invoicesPage.send.reviewNoContact",
      ]
    ) {
      expect(en[k]).toBeTruthy();
      expect(es[k]).toBeTruthy();
      expect(es[k]).not.toEqual(en[k]);
    }
  });
});
