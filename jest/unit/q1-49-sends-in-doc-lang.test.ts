/**
 * REQ-971 — LOOP-007 cycle 1, issue q1-49 [minor/BUG_POLISH] "'Sends in'
 * defaults to English for a customer the contractor described in Spanish".
 * AMENDS REQ-715: "Sends in" / "Preview in" starts on the customer's own
 * language, else the DOCUMENT's own language (quote.lang, stamped from the
 * typed text by REQ-710), else the app language — still clamped by REQ-925.
 *
 * The contractor's app is English and they typed the quote in Spanish; the
 * quote is stamped lang "es", Customer.language stays empty (the create_quote
 * prompt never infers it, REQ-715 c4-M34), and the dialog started on English.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dialog = () => require("../../front-end/lib/send-dialog");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-971 (LOOP-007 q1-49) 'Sends in' starts on the document's own language when the customer has none", () => {
  it("REQ-971 defaultSendLang: a Spanish quote for a customer with no language, in an English app, starts on Español", () => {
    const { defaultSendLang } = dialog();
    expect(defaultSendLang({ language: undefined }, "en", ["en", "es"], "es"))
      .toBe("es");
    expect(defaultSendLang({}, "en", null, "es")).toBe("es");
    expect(defaultSendLang(null, "en", undefined, "es")).toBe("es");
    // an English document in a Spanish app starts on English
    expect(defaultSendLang({}, "es", ["en", "es"], "en")).toBe("en");
  });

  it("REQ-971 defaultSendLang: the customer's own language still wins over the document's", () => {
    const { defaultSendLang } = dialog();
    expect(defaultSendLang({ language: "en" }, "en", ["en", "es"], "es"))
      .toBe("en");
    expect(defaultSendLang({ language: "es" }, "en", ["en", "es"], "en"))
      .toBe("es");
  });

  it("REQ-971 defaultSendLang: no (or an unknown) document language falls back to the app language; REQ-925 still clamps", () => {
    const { defaultSendLang } = dialog();
    expect(defaultSendLang({}, "en", ["en", "es"], undefined)).toBe("en");
    expect(defaultSendLang({}, "es", ["en", "es"], null)).toBe("es");
    expect(defaultSendLang({}, "en", ["en", "es"], "fr")).toBe("en");
    // English only in Settings never starts on Spanish
    expect(defaultSendLang({}, "en", ["en"], "es")).toBe("en");
  });

  it("REQ-971 the assistant's 'Preview in' / 'Sends in' passes the quote's language to defaultSendLang and follows it", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const calls = [...src.matchAll(/defaultSendLang\(([^;]*?)\)\s*[,;)]/g)]
      .map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      // a fourth argument: the quote's language (quote?.lang / quoteTextLang(quote) …)
      expect(args.split(",").length).toBeGreaterThanOrEqual(4);
    }
    // the effect that re-follows the default lists the quote's language
    const effect = src.match(
      /setPreviewLang\(defaultSendLang\([\s\S]*?\}\s*,\s*\[([^\]]*)\]\s*\)/,
    );
    expect(effect?.[1] ?? "").toMatch(/quote/i);
  });

  it("REQ-971 /quotes' QuoteSendDialog is given the quote's own language", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    const at = src.indexOf("<QuoteSendDialog");
    expect(at).toBeGreaterThan(-1);
    const el = src.slice(at, src.indexOf("/>", at));
    expect(el).toMatch(/initialSendLang=|loadDefaultLang=/);
  });
});
