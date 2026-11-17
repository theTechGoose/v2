/**
 * REQ-461 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m8: "No preview of the email/SMS the client
 * gets and no send-language choice (Settings promises it)".
 *
 * Cause (RCA at cc5d4b0e, analyst + skeptic UPHELD): the send dialog
 * (AsstChat.tsx) offered only the three channels; the language the quote
 * went out in was the review card's "Preview in" pill (hidden with one
 * language), silently passed as sendQuoteNow(m, ch, previewLang) — and the
 * client's email/text was never shown before Send.
 *
 * Rule now: the dialog shows "Sends in: English | Español" bound to the same
 * previewLang the send uses, and a collapsed "What they'll get" that renders
 * the real subject/body/text from GET /quotes/:id/send-preview.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSendPreviewQuery,
  sendPreviewPath,
  sendPreviewSections,
} from "../../shared/quote-flow/send-preview";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("REQ-461 m8: send-preview helpers", () => {
  it("REQ-461 the path names the quote, the channel and the language", () => {
    expect(sendPreviewPath("q 1", "sms", "es")).toBe(
      "/quotes/q%201/send-preview?channel=sms&lang=es",
    );
  });

  it("REQ-461 the channel decides which parts the client gets", () => {
    expect(sendPreviewSections("both")).toEqual({ email: true, sms: true });
    expect(sendPreviewSections("email")).toEqual({ email: true, sms: false });
    expect(sendPreviewSections("sms")).toEqual({ email: false, sms: true });
  });

  it("REQ-461 the server reads the query safely: unknown channel → both, unknown lang → none", () => {
    expect(parseSendPreviewQuery({ channel: "sms", lang: "es" })).toEqual({
      channel: "sms",
      lang: "es",
    });
    expect(parseSendPreviewQuery({ channel: "fax", lang: "fr" })).toEqual({
      channel: "both",
      lang: undefined,
    });
    expect(parseSendPreviewQuery({})).toEqual({ channel: "both", lang: undefined });
  });
});

describe("REQ-461 m8: the send dialog shows the send language and what the client gets", () => {
  const island = read("front-end/islands/AsstChat.tsx");
  const dialogStart = island.indexOf('data-cy="send-dialog"');
  const dialogEnd = island.indexOf('data-cy="send-cancel"', dialogStart);
  const dialog = island.slice(dialogStart, dialogEnd);

  it("REQ-461 the dialog renders SendLangPreview for a quote", () => {
    expect(dialogStart).toBeGreaterThan(0);
    expect(dialog).toMatch(/<SendLangPreview\b/);
    expect(dialog).toMatch(/reviewDocType\s*!==\s*"invoice"/);
  });

  it("REQ-461 the dialog's language IS the send language (previewLang), and picking it moves previewLang", () => {
    const tag = dialog.slice(dialog.indexOf("<SendLangPreview"));
    expect(tag).toMatch(/sendLang=\{previewLang\}/);
    expect(tag).toMatch(/langs=\{sendLangs\}/);
    expect(tag).toMatch(/channel=\{dialogChannel\}/);
    expect(tag).toMatch(/setPreviewLang\(/);
    // the Send still sends in previewLang
    expect(island).toMatch(/sendQuoteNow\(m, ch, previewLang, /);
  });

  it("REQ-461 the quotes client reads the preview from the shared path", () => {
    const client = read("front-end/clients/quotes.ts");
    expect(client).toMatch(/sendPreview:/);
    expect(client).toMatch(/sendPreviewPath\(/);
  });

  it("REQ-461 every new string exists in en and es", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of [
        "asstChat.send.sendsIn",
        "asstChat.send.whatTheyGet",
        "asstChat.send.previewEmail",
        "asstChat.send.previewSubject",
        "asstChat.send.previewText",
        "asstChat.send.previewLoading",
        "asstChat.send.previewFailed",
        "asstChat.send.previewNeedsName",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
  });
});
