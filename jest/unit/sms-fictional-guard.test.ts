/**
 * REQ-523 (demo-loop cycle 3, issue m16) — "The app says texts were sent to
 * numbers that can't get texts":
 *  - /admins said "We texted (512) 555-0199 an invite" to a fictional number
 *    (pair 7); the invite now answers `texted` and the page says when it
 *    could not text;
 *  - /i promised "we'll text you a receipt then" (claim thanks) and "We'll
 *    text you a receipt once … confirms" (claimed note) whatever the
 *    customer's contact (pair 9); the page now reads the server's
 *    `receiptChannel` and promises an email, a text, or neither;
 *  - the phone hint said "like (512) 555-1234" while the send failure said
 *    "that's a made-up 555 number" (pairs 6, 9, 10) — the hint no longer
 *    shows a 555 number, and the failure names the reserved 555-01XX block
 *    instead of every 555 number.
 *
 * Targets: shared/documents/receipt-note.ts, front-end/islands/AdminsPage.tsx,
 * front-end/islands/PublicInvoiceClaim.tsx, front-end/routes/i/[id].tsx,
 * lang/en.json, lang/es.json.
 */
import * as fs from "fs";
import * as path from "path";
import {
  claimedNoteKey,
  claimThanksKey,
  receiptChannelOf,
} from "../../shared/documents/receipt-note.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS: [string, Record<string, string>][] = [["en", en], ["es", es]];

describe("REQ-523 (m16) the invoice page promises a receipt only on a channel it can arrive on", () => {
  test("the server's receiptChannel wins; an older payload falls back to email-or-nothing, never a text", () => {
    expect(receiptChannelOf({ receiptChannel: "text" })).toBe("text");
    expect(receiptChannelOf({ receiptChannel: "none" })).toBe("none");
    expect(
      receiptChannelOf({
        receiptChannel: "email",
        customer: { phoneNumber: "+15125551234" },
      }),
    ).toBe("email");
    expect(receiptChannelOf({ customer: { email: "a@b.co" } })).toBe("email");
    expect(
      receiptChannelOf({ customer: { phoneNumber: "+15125550142" } }),
    ).toBe("none");
    expect(receiptChannelOf({})).toBe("none");
    expect(receiptChannelOf({ receiptChannel: "carrier pigeon" })).toBe("none");
  });

  test("claim thanks: text → the text promise, email → the email promise, none → no promise", () => {
    expect(claimThanksKey("text")).toBe("publicInvoiceClaim.thanksBody");
    expect(claimThanksKey("email")).toBe("publicInvoiceClaim.thanksBodyEmail");
    expect(claimThanksKey("none")).toBe("publicInvoiceClaim.thanksBodyNone");
  });

  test("claimed note (after a reload): the same three", () => {
    expect(claimedNoteKey("text")).toBe("publicInvoice.claimed.body");
    expect(claimedNoteKey("email")).toBe("publicInvoice.claimed.bodyEmail");
    expect(claimedNoteKey("none")).toBe("publicInvoice.claimed.bodyNone");
  });

  test.each(DICTS)(
    "%s: each variant says what it promises — the none variants promise neither a text nor an email",
    (lang, d) => {
      for (
        const k of [
          "publicInvoiceClaim.thanksBody",
          "publicInvoice.claimed.body",
        ]
      ) {
        // the text variant: a receipt, never by email
        expect(d[k]).toMatch(lang === "en" ? /text you a receipt/i : /recibo/i);
        expect(d[k]).not.toMatch(/email|correo/i);
      }
      for (
        const k of [
          "publicInvoiceClaim.thanksBodyEmail",
          "publicInvoice.claimed.bodyEmail",
        ]
      ) {
        expect(d[k]).toMatch(
          lang === "en" ? /email you a receipt/i : /recibo por correo/i,
        );
        expect(d[k]).not.toMatch(/\btext|mensaje de texto/i);
      }
      for (
        const k of [
          "publicInvoiceClaim.thanksBodyNone",
          "publicInvoice.claimed.bodyNone",
        ]
      ) {
        expect(d[k]).toBeTruthy();
        expect(d[k]).not.toMatch(/\btext|mensaje|email|correo|receipt|recibo/i);
      }
      // the claimed note names who confirms
      for (
        const k of [
          "publicInvoice.claimed.body",
          "publicInvoice.claimed.bodyEmail",
          "publicInvoice.claimed.bodyNone",
        ]
      ) {
        expect(d[k]).toContain("{who}");
      }
    },
  );

  test("the claim island and the claimed note pick their line through the channel", () => {
    const island = read("front-end/islands/PublicInvoiceClaim.tsx");
    expect(island).toMatch(/claimThanksKey\(\s*receiptChannel\s*\)/);
    expect(island).not.toMatch(
      /tFor\(lang,\s*"publicInvoiceClaim\.thanksBody"\)/,
    );
    const page = read("front-end/routes/i/[id].tsx");
    expect(page).toMatch(/claimedNoteKey\(/);
    expect(page).not.toMatch(/tFor\(lang,\s*"publicInvoice\.claimed\.body",/);
    expect(page).toMatch(/receiptChannel=\{receiptChannelOf\(invoice\)\}/);
  });
});

describe("REQ-523 (m16) /admins never says it texted an invite that did not go out", () => {
  test.each(DICTS)(
    "%s: admins.notTexted says the text did not go out",
    (lang, d) => {
      expect(d["admins.notTexted"]).toContain("{phone}");
      expect(d["admins.notTexted"]).toMatch(
        lang === "en" ? /couldn't text/i : /no pudimos/i,
      );
    },
  );

  test("AdminsPage shows admins.sent only when the invite answers texted: true", () => {
    const src = read("front-end/islands/AdminsPage.tsx");
    expect(src).toMatch(/texted\s*===\s*true/);
    expect(src).toMatch(/"admins\.notTexted"/);
    const client = read("front-end/clients/admins.ts");
    expect(client).toMatch(/texted\??:\s*boolean/);
  });
});

describe("REQ-523 (m16) the phone hint and the 555 failure agree", () => {
  test.each(DICTS)(
    "%s: customer.invalidPhone shows no 555 example",
    (_lang, d) => {
      expect(d["customer.invalidPhone"]).toBeTruthy();
      expect(d["customer.invalidPhone"]).not.toMatch(/555/);
      expect(d["customer.invalidPhone"]).toMatch(/10/);
    },
  );

  test.each(DICTS)(
    "%s: sms.fictionalNumber names the reserved 555-01XX block, not every 555 number",
    (_lang, d) => {
      expect(d["sms.fictionalNumber"]).toMatch(/555-01XX/);
      expect(d["sms.fictionalNumber"]).not.toMatch(
        /made-up 555 number|número 555 ficticio/i,
      );
    },
  );
});
