/**
 * REQ-480 — demo-loop cycle 3, issue M18: "After 'Issue invoice', a red
 * quote-specific 'no email — add one to send it' notice while the list shows
 * INV-002 Enviada".
 *
 * RCA (CONFIRMED, skeptic UPHELD at cc5d4b0e): NewInvoiceModal.submit wrote
 * status "sent" BEFORE trying delivery (InvoicesPage.tsx:3413), so the list
 * always said Enviada; when both channels then failed, dispatchFailureCopy
 * (InvoicesPage.tsx:2034-2039) showed the QUOTE divider key
 * sendQuote.divider.noEmail ("Cotización + Acuerdo redactada — no hay
 * correo…") and dropped the text channel's reason on that branch.
 *
 * Now: an invoice-specific "not delivered" sentence that names the invoice,
 * says why each channel failed (the text reason is never dropped), and the
 * New invoice "Issue" path creates the invoice unissued when it is about to
 * dispatch — the backend stamps "sent" only once a channel delivers.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sendResult = () => require("../../shared/quote-flow/send-result");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const invoiceForm = () => require("../../shared/documents/invoice-form");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const tOf =
  (dict: Record<string, string>) =>
  (key: string, params: Record<string, string> = {}) => {
    const tpl = dict[key];
    if (typeof tpl !== "string") throw new Error(`missing lang key ${key}`);
    return tpl.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  };

const NO_EMAIL = {
  outcome: { delivered: false, reason: "noEmail" },
  rawReason: "no recipient: pass `to` or attach a customer with an email",
};
const NO_PHONE = {
  outcome: { delivered: false, reason: "noPhone" },
  rawReason: "no recipient: pass `to` or attach a customer with a phone number",
};
const FICTIONAL_EN = {
  // the backend's translated 555 reason (sms.fictionalNumber) — it mentions
  // "email", so classifyReason() files it under noEmail; the copy must still
  // show the reason, never "no phone/email on file".
  outcome: { delivered: false, reason: "noEmail" },
  rawReason: en["sms.fictionalNumber"],
};
const FICTIONAL_ES = { ...FICTIONAL_EN, rawReason: es["sms.fictionalNumber"] };
const BOUNCED = {
  outcome: { delivered: false, reason: "bounced" },
  rawReason: "Postmark: hard bounce",
};

describe("REQ-480 M18 invoice 'not delivered' copy", () => {
  it("REQ-480 en: names the invoice, says no email on file AND keeps the text's reason — no Quote + Agreement wording", () => {
    const copy = sendResult().invoiceNotDeliveredCopy(tOf(en), {
      number: "INV-002",
      email: NO_EMAIL,
      text: FICTIONAL_EN,
    });
    expect(copy).toBe(
      `INV-002 not delivered — no email on file; the text failed: ${
        en["sms.fictionalNumber"]
      }`,
    );
    expect(copy).not.toMatch(/quote|agreement/i);
  });

  it("REQ-480 es: 'INV-002 no entregada — no hay correo registrado; el mensaje de texto falló: …' — never 'Cotización + Acuerdo'", () => {
    const copy = sendResult().invoiceNotDeliveredCopy(tOf(es), {
      number: "INV-002",
      email: NO_EMAIL,
      text: FICTIONAL_ES,
    });
    expect(copy).toBe(
      `INV-002 no entregada — no hay correo registrado; el mensaje de texto falló: ${
        es["sms.fictionalNumber"]
      }`,
    );
    expect(copy).not.toMatch(/cotizaci|acuerdo/i);
  });

  it("REQ-480 no email and no phone on file → says both are missing", () => {
    const copy = sendResult().invoiceNotDeliveredCopy(tOf(en), {
      number: "INV-003",
      email: NO_EMAIL,
      text: NO_PHONE,
    });
    expect(copy).toBe(
      "INV-003 not delivered — no email on file; no phone on file",
    );
  });

  it("REQ-480 a failed email (not missing) carries its reason", () => {
    const copy = sendResult().invoiceNotDeliveredCopy(tOf(en), {
      number: "INV-004",
      email: BOUNCED,
      text: NO_PHONE,
    });
    expect(copy).toBe(
      "INV-004 not delivered — the email failed: Postmark: hard bounce; no phone on file",
    );
  });

  it("REQ-480 no number yet → 'Invoice not delivered …' / 'Factura no entregada …'", () => {
    const input = { email: NO_EMAIL, text: NO_PHONE };
    expect(sendResult().invoiceNotDeliveredCopy(tOf(en), input)).toMatch(
      /^Invoice not delivered — /,
    );
    expect(sendResult().invoiceNotDeliveredCopy(tOf(es), input)).toMatch(
      /^Factura no entregada — /,
    );
  });

  it("REQ-480 keptDraft → adds that it was kept as a draft until it reaches the client", () => {
    const copy = sendResult().invoiceNotDeliveredCopy(tOf(en), {
      number: "INV-002",
      email: NO_EMAIL,
      text: FICTIONAL_EN,
      keptDraft: true,
    });
    expect(copy).toMatch(/^INV-002 not delivered — no email on file; /);
    expect(copy).toContain(en["invoicesPage.send.keptDraft"]);
    expect(en["invoicesPage.send.keptDraft"]).toMatch(/draft/i);
    expect(es["invoicesPage.send.keptDraft"]).toMatch(/borrador/i);
  });

  it("REQ-480 every new key exists in en and es with the same placeholders", () => {
    const keys = [
      "invoicesPage.send.notDelivered",
      "invoicesPage.send.invoiceFallback",
      "invoicesPage.send.noEmailOnFile",
      "invoicesPage.send.emailFailedReason",
      "invoicesPage.send.noPhoneOnFile",
      "invoicesPage.send.textFailedReason",
      "invoicesPage.send.keptDraft",
    ];
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(ph(es[k])).toBe(ph(en[k]));
    }
  });
});

describe("REQ-480 M18 'Issue invoice' never stamps sent before delivery", () => {
  it("REQ-480 newInvoiceStatus: issuing with a dispatch → draft (the send stamps sent); issuing with no contact → sent; save → draft / scheduled", () => {
    const { newInvoiceStatus } = invoiceForm();
    expect(newInvoiceStatus({ issue: true, dispatch: true })).toBe("draft");
    expect(newInvoiceStatus({ issue: true, dispatch: false })).toBe("sent");
    expect(newInvoiceStatus({ issue: false, dispatch: true })).toBe("draft");
    expect(
      newInvoiceStatus({
        issue: false,
        dispatch: false,
        scheduledFor: "2099-01-01",
      }),
    ).toBe("scheduled");
  });

  it("REQ-480 the island wires it: submit uses newInvoiceStatus, the failure copy is the invoice one, Finish + send no longer flips status up front", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toContain("newInvoiceStatus(");
    expect(src).not.toMatch(/status:\s*issue\s*\?\s*"sent"/);
    expect(src).toContain("invoiceNotDeliveredCopy(");
    expect(src).not.toContain('"sendQuote.divider.noEmail"');
    const finish = src.slice(
      src.indexOf("async function doFinishDraft"),
      src.indexOf("async function doFinishDraft") + 2500,
    );
    expect(finish).not.toMatch(/status:\s*"sent"/);
  });
});
