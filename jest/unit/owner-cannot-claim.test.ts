/**
 * REQ-479 — demo-loop cycle 3, issue M30: the owner's own browser on /i/:id
 * could tap "I sent it" and file "the customer paid by Zelle" on her own
 * invoice. The public invoice now carries `internal: true` for the business's
 * own viewer; the claim island shows the preview banner and, in place of the
 * claim buttons, "Record a payment you received" → /invoices?open=…&pay=1.
 * `?as=customer&confirm=1` is the in-person override, carried on the POST.
 *
 *   shared/documents/invoice-claim-view.ts → invoiceClaimPreview(),
 *                                            recordPaymentHref(), claimPaymentPath()
 *   front-end/islands/PublicInvoiceClaim.tsx → banner (data-cy="invoice-internal-preview")
 *   front-end/routes/i/[id].tsx            → session-carrying read, `internal` prop
 *   lang/{en,es}.json                      → publicInvoiceClaim.internalPreview*
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const view = () => require("../../shared/documents/invoice-claim-view");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const lang = (l: string) =>
  JSON.parse(read(`lang/${l}.json`)) as Record<string, string>;

describe("REQ-479 invoiceClaimPreview — the business's own viewer previews the claim, never files it", () => {
  it("REQ-479 an internal viewer of an open invoice is a preview; the customer (no flag) is not", () => {
    const { invoiceClaimPreview } = view();
    expect(invoiceClaimPreview({ internal: true, status: "sent" }, "")).toBe(
      true,
    );
    expect(invoiceClaimPreview({ internal: true, status: "overdue" }, ""))
      .toBe(true);
    expect(invoiceClaimPreview({ status: "sent" }, "")).toBe(false);
    expect(invoiceClaimPreview({ internal: false, status: "sent" }, ""))
      .toBe(false);
  });

  it("REQ-479 the full in-person override shows the claim form to an internal viewer; half of it does not", () => {
    const { invoiceClaimPreview } = view();
    const p = { internal: true, status: "sent" };
    expect(invoiceClaimPreview(p, "?as=customer&confirm=1")).toBe(false);
    expect(invoiceClaimPreview(p, "?lang=es&as=customer&confirm=1")).toBe(
      false,
    );
    expect(invoiceClaimPreview(p, "?as=customer")).toBe(true);
    expect(invoiceClaimPreview(p, "?confirm=1")).toBe(true);
  });

  it("REQ-479 a paid or void invoice has nothing to claim, so it is never a preview", () => {
    const { invoiceClaimPreview } = view();
    expect(invoiceClaimPreview({ internal: true, status: "paid" }, "")).toBe(
      false,
    );
    expect(invoiceClaimPreview({ internal: true, status: "void" }, "")).toBe(
      false,
    );
  });

  it("REQ-479 'Record a payment you received' opens the invoice on Payment received", () => {
    const { recordPaymentHref } = view();
    expect(recordPaymentHref("inv-1")).toBe("/invoices?open=inv-1&pay=1");
    expect(recordPaymentHref("a b")).toBe("/invoices?open=a%20b&pay=1");
  });

  it("REQ-479 the claim POST carries the in-person override only when the page has it", () => {
    const { claimPaymentPath } = view();
    expect(claimPaymentPath("inv-1", "")).toBe(
      "/api/invoices/inv-1/claim-payment",
    );
    expect(claimPaymentPath("inv-1", "?lang=es")).toBe(
      "/api/invoices/inv-1/claim-payment",
    );
    expect(claimPaymentPath("inv-1", "?lang=es&as=customer&confirm=1")).toBe(
      "/api/invoices/inv-1/claim-payment?as=customer&confirm=1",
    );
  });
});

describe("REQ-479 wiring — route, island and dictionaries", () => {
  it("REQ-479 /i/:id reads the invoice with the viewer's session and hands `internal` to the claim island", () => {
    const src = read("front-end/routes/i/[id].tsx");
    expect(src).toMatch(
      /ssrBackendGetAuthed<InvoicePublic>\(\s*`\/invoices\/\$\{id\}\/public`,\s*getSessionId\(ctx\.req\)/,
    );
    expect(src).toMatch(/internal=\{invoice\.internal === true\}/);
  });

  it("REQ-479 the island renders the preview banner + record-payment link instead of the claim buttons, and posts via claimPaymentPath", () => {
    const src = read("front-end/islands/PublicInvoiceClaim.tsx");
    expect(src).toContain("invoiceClaimPreview(");
    expect(src).toContain('data-cy="invoice-internal-preview"');
    expect(src).toContain('data-cy="invoice-record-payment"');
    expect(src).toContain("recordPaymentHref(invoiceId)");
    expect(src).toContain("claimPaymentPath(invoiceId");
    // the preview returns before the method chips render
    const previewAt = src.indexOf('data-cy="invoice-internal-preview"');
    const chipsAt = src.indexOf("data-cy={`claim-method-");
    expect(previewAt).toBeGreaterThan(-1);
    expect(chipsAt).toBeGreaterThan(previewAt);
  });

  it("REQ-479 en and es carry the preview, record-payment and owner_cannot_claim copy", () => {
    const keys = [
      "publicInvoiceClaim.internalPreview",
      "publicInvoiceClaim.internalPreviewBody",
      "publicInvoiceClaim.internalPreviewInPerson",
      "publicInvoiceClaim.recordPayment",
      "publicInvoiceClaim.ownerCannotClaim",
    ];
    const en = lang("en");
    const es = lang("es");
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
    }
    expect(en["publicInvoiceClaim.recordPayment"]).toBe(
      "Record a payment you received",
    );
    expect(en["publicInvoiceClaim.internalPreview"]).toMatch(
      /viewing as the customer/,
    );
  });
});
