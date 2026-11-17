/**
 * REQ-695 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issues M23 and m55.
 *
 * M23: issuing an invoice to a client with an email and no phone showed, in
 * the Spanish UI, "Factura enviada por correo · El texto no salió: no
 * recipient: pass `to` or attach a customer with a phone number". The page
 * fired BOTH channels and passed the SMS endpoint's raw developer reason
 * into the half-delivered copy (InvoicesPage.tsx partialDispatchCopy /
 * partialParts); only the not-delivered path mapped "no recipient".
 *
 * m55: "Finish + send" with no contact on file left a text-only failure on
 * the card — no field, no link to add the email or phone.
 *
 * Now: a channel the client has no address for is not a failure when the
 * other one delivered (a phone-less bill is just "sent by email"); a missing
 * recipient is always "no phone/email on file", never the raw reason; both
 * missing is a `noRecipient` verdict the card turns into an inline
 * "Add email or phone" capture.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sendResult = () => require("../../shared/quote-flow/send-result");

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

const SENT = { outcome: { delivered: true } };
const NO_PHONE = {
  outcome: { delivered: false, reason: "noPhone" },
  rawReason: "no recipient: pass `to` or attach a customer with a phone number",
  failureCode: "missing",
};
const NO_EMAIL = {
  outcome: { delivered: false, reason: "noEmail" },
  rawReason: "no recipient: pass `to` or attach a customer with an email",
  failureCode: "missing",
};
const BOUNCED = {
  outcome: { delivered: false, reason: "bounced" },
  rawReason: "Postmark: hard bounce",
};

describe("REQ-695 M23 a missing recipient is never a raw developer reason", () => {
  it("REQ-695 es: the failed-channel reason for 'no recipient' is 'no hay teléfono registrado' — never contains 'recipient'", () => {
    const r = sendResult().channelFailReason(tOf(es), "text", NO_PHONE);
    expect(r).toBe(es["invoicesPage.send.noPhoneOnFile"]);
    expect(r).not.toMatch(/recipient/i);
  });

  it("REQ-695 en: a missing email reads 'no email on file'", () => {
    expect(sendResult().channelFailReason(tOf(en), "email", NO_EMAIL)).toBe(
      "no email on file",
    );
  });

  it("REQ-695 the backend's failureCode 'missing' alone marks it missing (no reason text needed)", () => {
    const r = sendResult().channelFailReason(tOf(es), "text", {
      outcome: { delivered: false, reason: "unknown" },
      failureCode: "missing",
    });
    expect(r).toBe(es["invoicesPage.send.noPhoneOnFile"]);
  });

  it("REQ-695 a real failure keeps its (backend-translated) reason", () => {
    expect(sendResult().channelFailReason(tOf(en), "email", BOUNCED)).toBe(
      "Postmark: hard bounce",
    );
  });

  it("REQ-695 es: a half-delivered copy whose failed channel had no recipient never contains 'recipient'", () => {
    const copy = sendResult().invoicePartialCopy(tOf(es), {
      email: SENT,
      text: NO_PHONE,
    });
    expect(copy).not.toMatch(/recipient/i);
    expect(copy).toContain(es["invoicesPage.send.noPhoneOnFile"]);
  });
});

describe("REQ-695 M23 a channel with no address is not a failure when the other delivered", () => {
  it("REQ-695 email sent + no phone on file → delivered, NOT partial, nothing failed", () => {
    const d = sendResult().summarizeInvoiceDispatch({
      email: SENT,
      text: NO_PHONE,
    });
    expect(d).toEqual({
      delivered: true,
      partial: false,
      failedChannels: [],
      noRecipient: false,
    });
  });

  it("REQ-695 a skipped channel (never fired) is not a failure either", () => {
    const d = sendResult().summarizeInvoiceDispatch({
      email: { outcome: { delivered: false }, skipped: true },
      text: SENT,
    });
    expect(d.partial).toBe(false);
    expect(d.delivered).toBe(true);
  });

  it("REQ-695 email sent + text truly failed → still partial", () => {
    const d = sendResult().summarizeInvoiceDispatch({
      email: SENT,
      text: {
        outcome: { delivered: false, reason: "unknown" },
        rawReason: "Twilio said no",
      },
    });
    expect(d.partial).toBe(true);
    expect(d.failedChannels).toEqual(["text"]);
  });

  it("REQ-695 m55 no email AND no phone on file → noRecipient (the card offers to add one)", () => {
    const d = sendResult().summarizeInvoiceDispatch({
      email: NO_EMAIL,
      text: NO_PHONE,
    });
    expect(d.delivered).toBe(false);
    expect(d.noRecipient).toBe(true);
  });

  it("REQ-695 m55 one missing + one real failure → not noRecipient (a contact would not fix it)", () => {
    const d = sendResult().summarizeInvoiceDispatch({
      email: NO_EMAIL,
      text: {
        outcome: { delivered: false, reason: "unknown" },
        rawReason: "Twilio said no",
      },
    });
    expect(d.noRecipient).toBe(false);
  });
});

describe("REQ-695 the island is wired to it", () => {
  const src = read("front-end/islands/InvoicesPage.tsx");

  it("REQ-695 the half-delivered copy and parts never read rawReason directly", () => {
    const start = src.indexOf("function partialDispatchCopy(");
    const end = src.indexOf("function dispatchFailureCopy(");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/rawReason/);
    expect(body).toMatch(/channelFailReason|invoicePartialCopy/);
  });

  it("REQ-695 New invoice dispatches only the channels its contact can use", () => {
    // REQ-695 AMENDMENT (reconciled with REQ-727 on demo-fixes): Issue opens
    // the send sheet on the invoice's contact, and the sheet starts on the
    // channel(s) that contact can be reached on; only the pick is dispatched.
    expect(src).toMatch(/customer:\s*invoiceSendContact\(\s*\{\s*customerId,\s*billTo:\s*bt\s*\}/);
    expect(src).toMatch(/dispatchInvoice\(invoice\.id,\s*\{\s*\.\.\.pick,\s*hasCustomer\s*\}\)/);
    expect(read("front-end/components/InvoiceSendDialog.tsx")).toMatch(
      /initialChannel=\{defaultSendChannel\(onFile\)\}/,
    );
  });

  it("REQ-695 m55 the card's send notes carry the inline 'add email or phone' capture", () => {
    expect(src).toMatch(/data-cy="invoice-add-contact"/);
    expect(src).toMatch(/customerFixHref\(/);
  });

  it("REQ-695 every new key exists in en and es", () => {
    for (
      const k of [
        "invoicesPage.send.addContactLabel",
        "invoicesPage.send.addContactSave",
        "invoicesPage.send.addContactOpen",
        "invoicesPage.send.addContactInvalid",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
  });
});
