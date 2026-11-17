/**
 * REQ-457 — demo-loop cycle 3, issue M27: "Client's signed agreement /q page
 * never mentions the change order or new total".
 *
 * GET /quotes/:id/public already returns every change order, but
 * relatedDocumentRows() (shared/documents/linked-view.ts) skipped any whose
 * status was not "approved", and nothing else on the page read a pending
 * one — so the customer's signed Q-001 ($7,050) never said CO-001 (+$1,200)
 * was waiting for them, nor that the job would come to $8,250.
 *
 * Now a pending change order is a related row "Waiting for your approval"
 * linking /co/:id, and pendingChangeOrderNotices() feeds a banner on the
 * signed /q: "A change order (CO-001, +$1,200.00) is waiting for your
 * approval — new job total $8,250.00".
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

/** the demo's signed agreement: Q-001 $7,050, CO-001 +$1,200 pending */
const demoQuote = {
  status: "accepted",
  estimatedTotal: 705000,
  invoices: [],
  changeOrders: [
    {
      id: "co1",
      number: "CO-001",
      url: "/co/co1",
      status: "pending",
      deltaAmountCents: 120000,
      description: "Add a second vanity",
    },
  ],
};

describe("REQ-457 relatedDocumentRows lists a pending change order", () => {
  it("REQ-457 a pending CO is a row 'Waiting for your approval' linking /co/:id", () => {
    const rows = lv().relatedDocumentRows(demoQuote, "en");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "changeOrder",
      id: "co1",
      number: "CO-001",
      url: "/co/co1",
      stateLabel: "Waiting for your approval",
      deltaAmountCents: 120000,
      pending: true,
    });
  });

  it("REQ-457 the same row in Spanish", () => {
    const rows = lv().relatedDocumentRows(demoQuote, "es");
    expect(rows[0].stateLabel).toBe("Esperando tu aprobación");
  });

  it("REQ-457 a declined change order is still not listed", () => {
    const rows = lv().relatedDocumentRows({
      changeOrders: [{
        id: "c3",
        number: "CO-003",
        status: "declined",
        deltaAmountCents: 1000,
      }],
    }, "en");
    expect(rows).toEqual([]);
  });
});

describe("REQ-457 pendingChangeOrderNotices — the banner's numbers", () => {
  it("REQ-457 the demo: CO-001 +$1,200 on a $7,050 agreement → new job total $8,250", () => {
    expect(lv().pendingChangeOrderNotices(demoQuote)).toEqual([
      {
        id: "co1",
        number: "CO-001",
        url: "/co/co1",
        deltaAmountCents: 120000,
        newTotalCents: 825000,
      },
    ]);
  });

  it("REQ-457 approved change orders are already in the job total", () => {
    const notices = lv().pendingChangeOrderNotices({
      estimatedTotal: 705000,
      changeOrders: [
        {
          id: "a",
          number: "CO-001",
          status: "approved",
          deltaAmountCents: 50000,
        },
        {
          id: "b",
          number: "CO-002",
          status: "pending",
          deltaAmountCents: -20000,
        },
        {
          id: "c",
          number: "CO-003",
          status: "declined",
          deltaAmountCents: 99900,
        },
      ],
    });
    expect(notices).toEqual([
      {
        id: "b",
        number: "CO-002",
        url: "/co/b",
        deltaAmountCents: -20000,
        newTotalCents: 735000,
      },
    ]);
  });

  it("REQ-457 no total on the payload → the line items are summed", () => {
    const notices = lv().pendingChangeOrderNotices({
      lineItems: [{ price: 300000, quantity: 2 }],
      changeOrders: [{
        id: "p",
        number: "CO-001",
        status: "pending",
        deltaAmountCents: 10000,
      }],
    });
    expect(notices[0].newTotalCents).toBe(610000);
  });

  it("REQ-457 nothing pending → no notices", () => {
    expect(lv().pendingChangeOrderNotices({ estimatedTotal: 1 })).toEqual([]);
  });
});

describe("REQ-457 the banner's copy (en + es) and its wiring in quote-doc.tsx", () => {
  it("REQ-457 en reads 'A change order (CO-001, +$1,200.00) is waiting for your approval — new job total $8,250.00'", () => {
    expect(
      fill(en["quoteDoc.pendingChangeOrder"], {
        number: "CO-001",
        delta: "+$1,200.00",
        total: "$8,250.00",
      }),
    ).toBe(
      "A change order (CO-001, +$1,200.00) is waiting for your approval — new job total $8,250.00",
    );
    expect(en["quoteDoc.pendingChangeOrderCta"]).toBeTruthy();
  });

  it("REQ-457 es carries the same placeholders", () => {
    const tpl = es["quoteDoc.pendingChangeOrder"];
    expect(tpl).toBeTruthy();
    for (const p of ["{number}", "{delta}", "{total}"]) {
      expect(tpl).toContain(p);
    }
    expect(es["quoteDoc.pendingChangeOrderCta"]).toBeTruthy();
  });

  it("REQ-457 the signed /q renders the banner from pendingChangeOrderNotices(quote)", () => {
    const src = read("front-end/components/quote-doc.tsx");
    expect(src).toContain("pendingChangeOrderNotices(quote)");
    expect(src).toContain('data-cy="quote-pending-change-order"');
    expect(src).toContain('"quoteDoc.pendingChangeOrder"');
  });
});
