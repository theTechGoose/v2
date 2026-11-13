/**
 * REQ-558 (demo-loop cycle 4, issue m42) — the customer never reads an
 * owner-only invoice state on /i/:id.
 *
 * getInvoicePublic sends `state: invoiceState(i)`, which since REQ-481 is
 * "scheduled" for a scheduled installment (and "draft" for an unissued one).
 * Those are the business's lifecycle words: Juan, logged out on /i/, read
 * "Programada". For an external viewer the headline names the document an
 * invoice with its due date; the business's own preview (internal) keeps
 * "Scheduled" / "Draft".
 *
 * Target: shared/documents/linked-view.ts invoiceHeadline
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path");

const scheduled = {
  number: "INV-5001",
  version: 1,
  state: "scheduled",
  dueDate: "2026-12-01",
};

describe("REQ-558 /i/ headline — owner-only states are not shown to the customer", () => {
  it("REQ-558 a scheduled installment reads 'Invoice · due <date>' for the customer (en)", () => {
    const { invoiceHeadline } = lv();
    const h = invoiceHeadline(scheduled, "en");
    expect(h).toBe("INV-5001 · Version 1 · Invoice · due Dec 1, 2026");
    expect(h).not.toMatch(/Scheduled/);
  });

  it("REQ-558 the same in Spanish never says 'Programada'", () => {
    const { invoiceHeadline } = lv();
    const h = invoiceHeadline(scheduled, "es");
    expect(h).toBe("INV-5001 · Versión 1 · Factura · vence 1 dic 2026");
    expect(h).not.toMatch(/Programada/);
  });

  it("REQ-558 a draft reads 'Invoice' for the customer, never 'Draft' / 'Borrador'", () => {
    const { invoiceHeadline } = lv();
    expect(
      invoiceHeadline({ number: "INV-5002", version: 1, state: "draft" }, "en"),
    ).toBe("INV-5002 · Version 1 · Invoice");
    expect(
      invoiceHeadline({ number: "INV-5002", version: 1, state: "draft" }, "es"),
    ).toBe("INV-5002 · Versión 1 · Factura");
  });

  it("REQ-558 the business's own preview (internal) keeps 'Scheduled' / 'Programada'", () => {
    const { invoiceHeadline } = lv();
    expect(invoiceHeadline({ ...scheduled, internal: true }, "en"))
      .toBe("INV-5001 · Version 1 · Scheduled");
    expect(invoiceHeadline({ ...scheduled, internal: true }, "es"))
      .toBe("INV-5001 · Versión 1 · Programada");
  });

  it("REQ-558 customer-facing states are unchanged (sent, paid)", () => {
    const { invoiceHeadline } = lv();
    expect(
      invoiceHeadline(
        {
          number: "INV-5003",
          version: 1,
          state: "sent",
          dueDate: "2026-12-01",
        },
        "en",
      ),
    ).toBe("INV-5003 · Version 1 · Sent");
    expect(
      invoiceHeadline({ number: "INV-5003", version: 1, state: "paid" }, "es"),
    ).toBe("INV-5003 · Versión 1 · Pagada");
  });

  it("REQ-558 /i/[id].tsx passes the viewer (internal) and the due date into the headline", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../front-end/routes/i/[id].tsx"),
      "utf8",
    );
    const call = src.slice(src.indexOf("invoiceHeadline("));
    const args = call.slice(0, call.indexOf("lang,"));
    expect(args).toMatch(/internal:\s*invoice\.internal === true/);
    expect(args).toMatch(/dueDate:\s*invoice\.dueDate/);
  });
});
