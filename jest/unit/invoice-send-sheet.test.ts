/**
 * REQ-727 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue c4-M16 (m56 in the merged
 * report): "Invoices go out at once: no preview, confirmation or channel
 * choice". On /invoices, "Finish + send" (fleet-7 stdout:311: "sent at once
 * (no review/confirm step)"), "Send now" and "Issue invoice" sent over email
 * AND text the moment they were pressed, while a quote goes through
 * QuoteSendDialog (the channel, "Sends in", "What they'll get", then Send).
 *
 * Now each opens the invoice send sheet — the same dialog
 * (components/QuoteSendDialog.tsx `SendDialog`, lib/send-dialog.ts rules)
 * with the invoice's preview (GET /invoices/:id/send-preview) in the
 * invoice's own language — and only its Send dispatches, on the picked
 * channel(s), in the picked language.
 *
 * Pure rules: front-end/lib/invoice-send-sheet.ts,
 * shared/quote-flow/send-result.ts and shared/quote-flow/send-preview.ts.
 * Wiring: the island and component sources (the behaviour is proven in the
 * browser by e2e/invoice-send-sheet).
 */
import * as fs from "fs";
import * as path from "path";
import {
  dispatchChannels,
  finishDraftDates,
  invoiceDispatchBody,
  invoiceSendContact,
  invoiceSheetLang,
} from "../../front-end/lib/invoice-send-sheet.ts";
import {
  invoiceNotDeliveredCopy,
  summarizeDispatch,
} from "../../shared/quote-flow/send-result.ts";
import {
  invoiceSendPreviewPath,
  parseInvoiceSendPreviewQuery,
} from "../../shared/quote-flow/send-preview.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const tOf =
  (dict: Record<string, string>) =>
  (key: string, params: Record<string, string> = {}) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);

/** the body of `(async) function <name>(` … up to the next sibling function */
function fnBody(src: string, name: string): string {
  const at = src.search(new RegExp(`(async )?function ${name}\\(`));
  expect(at).toBeGreaterThan(-1);
  const next = src.slice(at + 10).search(
    /\n {0,2}(async )?function \w+\(|\n {2}const \[|\n {2}useEffect\(|\n {2}return \(/,
  );
  return src.slice(at, next > -1 ? at + 10 + next : at + 3000);
}

describe("REQ-727 c4-M16 the sheet's pick decides what is dispatched", () => {
  it("REQ-727 Text + Email posts both endpoints; Email only the email; Text only the text", () => {
    expect(dispatchChannels("both")).toEqual(["email", "text"]);
    expect(dispatchChannels("email")).toEqual(["email"]);
    expect(dispatchChannels("sms")).toEqual(["text"]);
  });

  it("REQ-727 each POST carries the picked language; a typed contact is the recipient only when no customer record can keep it", () => {
    const typed = { email: " ana@example.com ", phone: "5125550199" };
    expect(invoiceDispatchBody("email", { language: "es", typed }, true))
      .toEqual({ language: "es" });
    expect(invoiceDispatchBody("email", { language: "en", typed }, false))
      .toEqual({ language: "en", to: "ana@example.com" });
    expect(invoiceDispatchBody("text", { language: "es", typed }, false))
      .toEqual({ language: "es", to: "5125550199" });
    expect(
      invoiceDispatchBody(
        "text",
        { typed: { email: "x@y.co", phone: " " } },
        false,
      ),
    ).toEqual({});
  });
});

describe("REQ-727 c4-M16 a one-channel send is reported on that channel alone", () => {
  const went = { delivered: true };
  const failed = { delivered: false, reason: "unknown" as const };

  it("REQ-727 summarizeDispatch: a channel that was not picked is neither a failure nor half of a partial", () => {
    expect(summarizeDispatch({ email: went })).toEqual({
      delivered: true,
      partial: false,
      failedChannels: [],
    });
    expect(summarizeDispatch({ text: failed })).toEqual({
      delivered: false,
      partial: false,
      failedChannels: ["text"],
    });
    // both picked: unchanged (REQ-030)
    expect(summarizeDispatch({ email: went, text: failed })).toEqual({
      delivered: true,
      partial: true,
      failedChannels: ["text"],
    });
    expect(summarizeDispatch({ email: failed, text: failed })).toEqual({
      delivered: false,
      partial: false,
      failedChannels: ["email", "text"],
    });
  });

  it("REQ-727 the not-delivered sentence names only the channel that was tried — en and es", () => {
    const text = {
      outcome: failed,
      rawReason: "that's a reserved test number (555-01XX)",
    };
    expect(invoiceNotDeliveredCopy(tOf(en), { number: "INV-002", text })).toBe(
      "INV-002 not delivered — the text failed: that's a reserved test number (555-01XX)",
    );
    expect(invoiceNotDeliveredCopy(tOf(es), { number: "INV-002", text })).toBe(
      "INV-002 no entregada — el mensaje de texto falló: that's a reserved test number (555-01XX)",
    );
    expect(
      invoiceNotDeliveredCopy(tOf(en), {
        number: "INV-002",
        email: { outcome: { delivered: false, reason: "noEmail" } },
      }),
    ).toBe("INV-002 not delivered — no email on file");
    // both tried: the two-part sentence, unchanged (REQ-480)
    expect(
      invoiceNotDeliveredCopy(tOf(en), {
        number: "INV-002",
        email: { outcome: { delivered: false, reason: "noEmail" } },
        text,
      }),
    ).toMatch(/^INV-002 not delivered — no email on file; the text failed: /);
  });
});

describe("REQ-727 c4-M16 the sheet's contact, first language and previewed dates", () => {
  it("REQ-727 the customer's live record first (what the send endpoints read), else the invoice's named bill-to; the id stays the invoice's customer", () => {
    const inv = {
      customerId: "c-1",
      billTo: { name: "Ann Lee", email: "old@example.com", phoneNumber: "" },
    };
    expect(
      invoiceSendContact(inv, {
        id: "c-1",
        name: "Ann Lee",
        email: "ann@example.com",
        phoneNumber: "+15125551234",
      }),
    ).toEqual({
      id: "c-1",
      name: "Ann Lee",
      email: "ann@example.com",
      phoneNumber: "+15125551234",
    });
    // the record isn't loaded: the bill-to
    expect(invoiceSendContact(inv, undefined)).toEqual({
      id: "c-1",
      name: "Ann Lee",
      email: "old@example.com",
    });
    // a bill-to with no name is not on the document (doc-render's rule)
    expect(
      invoiceSendContact({ billTo: { email: "x@example.com" } }, undefined),
    ).toEqual({});
    // no customer at all: no id — a typed contact can only be the recipient
    expect(invoiceSendContact({ billTo: { name: "Jo" } }, undefined).id)
      .toBeUndefined();
  });

  it("REQ-727 'Sends in' starts on the invoice's own typed language when the page knows it (else the server says)", () => {
    expect(invoiceSheetLang({ lang: "es" })).toBe("es");
    expect(invoiceSheetLang({ lang: "en" })).toBe("en");
    expect(invoiceSheetLang({})).toBeUndefined();
    expect(invoiceSheetLang({ lang: "fr" })).toBeUndefined();
  });

  it("REQ-727 'Finish + send' issues a draft today (when it has no issue date) and makes it due today + its days to pay — the dates the sheet previews", () => {
    expect(finishDraftDates({ netDays: 15 }, "2026-11-12")).toEqual({
      issuedDate: "2026-11-12",
      dueDate: "2026-11-27",
    });
    expect(finishDraftDates({ netDays: 30 }, "2026-12-15")).toEqual({
      issuedDate: "2026-12-15",
      dueDate: "2027-01-14",
    });
    expect(finishDraftDates({ issuedDate: "2026-11-01" }, "2026-11-12"))
      .toEqual({});
  });
});

describe("REQ-727 c4-M16 GET /invoices/:id/send-preview — the path and the query", () => {
  it("REQ-727 the path carries the channel, the language when picked, and the send's dates", () => {
    expect(invoiceSendPreviewPath("inv 1", "both", "es", {
      issuedDate: "2026-11-12",
      dueDate: "2026-11-27",
    })).toBe(
      "/invoices/inv%201/send-preview?channel=both&lang=es&issuedDate=2026-11-12&dueDate=2026-11-27",
    );
    expect(invoiceSendPreviewPath("i-2", "sms")).toBe(
      "/invoices/i-2/send-preview?channel=sms",
    );
  });

  it("REQ-727 the server reads it safely: unknown channel → both, unknown language → none, a date only when it is one", () => {
    expect(parseInvoiceSendPreviewQuery({
      channel: "email",
      lang: "es",
      issuedDate: "2026-11-12",
      dueDate: "2026-11-27",
    })).toEqual({
      channel: "email",
      lang: "es",
      issuedDate: "2026-11-12",
      dueDate: "2026-11-27",
    });
    expect(parseInvoiceSendPreviewQuery({
      channel: "fax",
      lang: "fr",
      issuedDate: "soon",
      dueDate: "2026-02-31",
    })).toEqual({ channel: "both", lang: undefined });
  });
});

describe("REQ-727 c4-M16 /invoices never sends an invoice at once", () => {
  const src = read("front-end/islands/InvoicesPage.tsx");

  it("REQ-727 the Upcoming / Drafting CTA opens the send sheet — ctaAction itself sends nothing", () => {
    const cta = fnBody(src, "ctaAction");
    expect(cta).toMatch(/openSendSheet\(e\)/);
    expect(cta).not.toMatch(/doSendNow\(|doFinishDraft\(/);
    const open = fnBody(src, "openSendSheet");
    expect(open).toMatch(/onSendSheet\(/);
    expect(open).toMatch(/sendNowDates\(/);
    expect(open).toMatch(/finishDraftDates\(/);
    expect(open).toMatch(/doSendNow\(pick\)/);
    expect(open).toMatch(/doFinishDraft\(pick\)/);
    expect(open).not.toMatch(/dispatchInvoice\(/);
  });

  it("REQ-727 Send now / Finish + send dispatch the sheet's pick", () => {
    for (const fn of ["doSendNow", "doFinishDraft"]) {
      const body = fnBody(src, fn);
      expect(body).toMatch(
        new RegExp(`function ${fn}\\(pick: SendDialogPick\\)`),
      );
      expect(body).toMatch(/dispatchInvoice\(inv\.id, \{\s*\.\.\.pick,/);
    }
    expect(fnBody(src, "doFinishDraft")).toMatch(/finishDraftDates\(/);
  });

  it("REQ-727 dispatchInvoice posts only the picked channels, each with its JSON body", () => {
    const body = fnBody(src, "dispatchInvoice");
    expect(body).toMatch(/dispatchChannels\(pick\.channel\)/);
    expect(body).toMatch(/invoiceDispatchBody\(/);
    expect(body).toMatch(/"content-type": "application\/json"/);
    expect(body).not.toMatch(/\/api\/invoices\/\$\{id\}\/email`/);
  });

  it("REQ-727 the page renders the card's sheet, outside the cards; every card can open it", () => {
    expect(src).toMatch(
      /import InvoiceSendDialog from "\.\.\/components\/InvoiceSendDialog\.tsx"/,
    );
    const cards = src.match(/<InvoiceCard\b/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    const wired =
      src.match(/<InvoiceCard\b[^>]*?onSendSheet=\{setSendSheet\}/gs) ?? [];
    expect(wired.length).toBe(cards.length);
    const at = src.indexOf("{sendSheet && (");
    expect(at).toBeGreaterThan(-1);
    const tag = src.slice(at, at + 1200);
    expect(tag).toMatch(/<InvoiceSendDialog\b/);
    expect(tag).toMatch(/invoiceSendContact\(/);
    expect(tag).toMatch(/sendSheet\.send\(pick\)/);
  });

  it("REQ-727 a contact typed in the sheet is on file next time: the page's re-read includes the customers", () => {
    expect(fnBody(src, "refreshInvoices")).toMatch(
      /dashboardClient\.customers\(/,
    );
  });

  it("REQ-727 Issue invoice creates the invoice, then the sheet sends it — the submit itself dispatches nothing", () => {
    const submit = fnBody(src, "submit");
    expect(submit).not.toMatch(/dispatchInvoice\(/);
    expect(submit).toMatch(/setSheet\(/);
    expect(submit).toMatch(/sendIssued\(/);
    expect(submit).toMatch(/keepIssuedDraft\(/);
    expect(fnBody(src, "sendIssued")).toMatch(/dispatchInvoice\(/);
    // Cancel keeps it — a draft, and the page says it was not sent
    const keep = fnBody(src, "keepIssuedDraft");
    expect(keep).toMatch(/invoicesPage\.send\.sheetKeptDraft/);
    expect(keep).toMatch(/notSent: true/);
  });

  it("REQ-727 'Send INV-001 now' in New invoice opens the sheet too", () => {
    const at = src.indexOf('data-cy="new-invoice-prior-send"');
    expect(at).toBeGreaterThan(-1);
    const button = src.slice(at, at + 400);
    expect(button).toMatch(/openPriorSheet\(/);
    expect(button).not.toMatch(/sendPrior\(/);
    expect(fnBody(src, "sendPrior")).toMatch(/dispatchInvoice\(inv\.id, \{/);
  });

  it("REQ-727 the modal's sheet sits outside its <form> (Enter in the sheet must not submit a second invoice)", () => {
    const formEnd = src.lastIndexOf("</form>");
    const sheetAt = src.indexOf("{sheet && (");
    expect(formEnd).toBeGreaterThan(-1);
    expect(sheetAt).toBeGreaterThan(formEnd);
  });
});

describe("REQ-727 c4-M16 the sheet is the quote's send dialog with the invoice's preview", () => {
  const dlg = read("front-end/components/InvoiceSendDialog.tsx");
  const shared = read("front-end/components/QuoteSendDialog.tsx");

  it("REQ-727 InvoiceSendDialog renders SendDialog — the one QuoteSendDialog renders too", () => {
    expect(dlg).toMatch(
      /import \{[^}]*\bSendDialog\b[^}]*\} from "\.\/QuoteSendDialog\.tsx"/,
    );
    expect(dlg).toMatch(/<SendDialog\b/);
    expect(shared).toMatch(/export function SendDialog\b/);
    expect(shared).toMatch(
      /export default function QuoteSendDialog[\s\S]*<SendDialog\b/,
    );
  });

  it("REQ-727 'What they'll get' comes from GET /invoices/:id/send-preview, with the invoice's own language first", () => {
    expect(dlg).toMatch(/dashboardClient\.invoiceSendPreview\(/);
    expect(dlg).toMatch(/loadDefaultLang=/);
    expect(dlg).toMatch(/initialSendLang=\{invoiceSheetLang\(/);
    expect(read("front-end/clients/dashboard.ts")).toMatch(
      /invoiceSendPreviewPath\(/,
    );
  });
});

describe("REQ-727 c4-M16 copy in en and es", () => {
  const keys = [
    "invoicesPage.send.sheetTitle",
    "invoicesPage.send.sheetTitleNoName",
    "invoicesPage.send.sheetError",
    "invoicesPage.send.sheetKeptDraft",
    "invoicesPage.send.notDeliveredOne",
  ];
  it.each(keys)("REQ-727 %s exists in en and es and differs", (k) => {
    expect(typeof en[k]).toBe("string");
    expect(typeof es[k]).toBe("string");
    expect(en[k].length).toBeGreaterThan(0);
    expect(es[k]).not.toBe(en[k]);
  });
  it("REQ-727 the sheet names the invoice and the client", () => {
    expect(
      tOf(en)("invoicesPage.send.sheetTitle", {
        number: "INV-001",
        name: "Juan Perez",
      }),
    ).toBe("How do you want to send INV-001 to Juan Perez?");
    expect(
      tOf(es)("invoicesPage.send.sheetTitle", {
        number: "INV-001",
        name: "Juan Perez",
      }),
    ).toBe("¿Cómo quieres enviar INV-001 a Juan Perez?");
    expect(
      tOf(en)("invoicesPage.send.sheetKeptDraft", { number: "INV-003" }),
    ).toMatch(/^INV-003 saved as a draft — not sent/);
  });
});
