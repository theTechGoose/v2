/**
 * REQ-935 (LOOP-007 cycle 1, q1-16) — "Make a new invoice for Priya Shah,
 * …: stained her 300 sq ft deck, $1,450, net 15." The server's invoice-flow
 * offer carries the due terms ("net 15" → dueDays 15), the chat keeps them
 * when it reads the payload, and the invoice flow prefills its due date
 * from them — "net 15" is never dropped.
 *
 *   shared/quote-flow/chat-invoice-flow-offer.ts   invoiceFlowOfferOf
 *   front-end/islands/AsstChat.tsx                 startInvoiceFlow(prefill)
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/quote-flow/chat-invoice-flow-offer");

const SAID =
  "Make a new invoice for Priya Shah, priya.shah@example.com, 77 Oak Hollow Dr, Austin TX 78745: stained her 300 sq ft deck, $1,450, net 15.";

describe("REQ-935 q1-16 invoice-flow offer due terms", () => {
  test("REQ-935 invoiceFlowOfferOf keeps the offer's dueDays (net 15)", () => {
    expect(
      mod().invoiceFlowOfferOf({
        invoiceFlow: {
          details: SAID,
          amountCents: 145_000,
          customerName: "Priya Shah",
          customerEmail: "priya.shah@example.com",
          dueDays: 15,
        },
      }),
    ).toEqual({
      details: SAID,
      amountCents: 145_000,
      customerName: "Priya Shah",
      customerEmail: "priya.shah@example.com",
      dueDays: 15,
    });
  });

  test("REQ-935 invoiceFlowOfferOf drops junk dueDays", () => {
    for (const dueDays of [-1, "15", Number.NaN, 15.5, 1000]) {
      expect(
        mod().invoiceFlowOfferOf({ invoiceFlow: { details: SAID, dueDays } })
          ?.dueDays,
      ).toBeUndefined();
    }
  });

  test("REQ-935 AsstChat's startInvoiceFlow prefills the due date from the offer's dueDays", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const start = src.indexOf("function startInvoiceFlow(");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n  }\n", start);
    const body = src.slice(start, end);
    expect(body).toMatch(/prefill\.dueDays/);
  });
});
