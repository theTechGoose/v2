/**
 * REQ-1131 (LOOP-007 cycle 3, q3-61) — a cancelled invoice is named the same
 * way everywhere on the customer's /i page.
 *
 * REQ-627 made the /i pill read `publicInvoice.cancelled.pill` ("Cancelled" /
 * "Cancelada") for a void invoice, but the REQ-201 headline still comes from
 * shared/documents/linked-view.ts `invoiceHeadline`, whose state label for
 * "void" is "Void" / "Anulada". The page reads "INV-003 · Version 1 · Void"
 * above a "CANCELLED" pill.
 *
 * Target: shared/documents/linked-view.ts invoiceHeadline
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es = require("../../lang/es.json");

const voided = { number: "INV-003", version: 1, state: "void" };

describe("REQ-1131 /i headline — a void invoice uses the pill's word", () => {
  it("REQ-1131 q3-61 the en headline of a void invoice ends in the pill's 'Cancelled', never 'Void'", () => {
    const { invoiceHeadline } = lv();
    const h: string = invoiceHeadline(voided, "en");
    expect(en["publicInvoice.cancelled.pill"]).toBe("Cancelled");
    expect(h).toBe("INV-003 · Version 1 · Cancelled");
    expect(h).not.toMatch(/\bVoid\b/);
  });

  it("REQ-1131 q3-61 the es headline of a void invoice ends in the pill's 'Cancelada', never 'Anulada'", () => {
    const { invoiceHeadline } = lv();
    const h: string = invoiceHeadline(voided, "es");
    expect(es["publicInvoice.cancelled.pill"]).toBe("Cancelada");
    expect(h).toBe("INV-003 · Versión 1 · Cancelada");
    expect(h).not.toMatch(/Anulada/);
  });
});
