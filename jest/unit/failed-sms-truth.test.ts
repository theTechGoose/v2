/**
 * REQ-403 (demo-loop cycle 2, issue m11) — "After a failed text the app says
 * it was sent/delivered and promises SMS confirmation."
 *
 *  (b) the signed /q page said "We'll text a confirmation to your phone"
 *      whenever the customer had no email — to a number whose text had just
 *      failed. It now reads the server's `confirmChannel` and falls back to a
 *      neutral "Your contractor has your signed copy" + Download PDF.
 *  (c) the chat kept the red "That number can't receive texts" recovery form
 *      after the customer signed. An accepted quote retires it.
 *
 * Targets: shared/quote-flow/signed-note.ts, front-end/lib/send-delivery.ts,
 * front-end/components/quote-doc.tsx, front-end/islands/AsstChat.tsx.
 */
import * as fs from "fs";
import * as path from "path";
import { signedNoteKey } from "../../shared/quote-flow/signed-note.ts";
import { lastRecoveryDividerId } from "../../front-end/lib/send-delivery.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-403 (m11) the signed page promises only a confirmation that can arrive", () => {
  test("email on file → the email note", () => {
    expect(signedNoteKey({ confirmChannel: "email" })).toBe(
      "quoteDoc.signedNote",
    );
    expect(signedNoteKey({ customer: { email: "a@b.co" } })).toBe(
      "quoteDoc.signedNote",
    );
  });

  test("a textable number whose last text did not fail → the text note", () => {
    expect(signedNoteKey({ confirmChannel: "text" })).toBe(
      "quoteDoc.signedNoteSms",
    );
  });

  test("a failed / fictional / missing number → the neutral signed-copy note, never the text promise", () => {
    expect(
      signedNoteKey({
        confirmChannel: "none",
        customer: { phoneNumber: "+15125550177" },
      }),
    ).toBe("quoteDoc.signedNoteKept");
    // an older payload without confirmChannel and no email: no promise either
    expect(signedNoteKey({ customer: { phoneNumber: "+15125550177" } })).toBe(
      "quoteDoc.signedNoteKept",
    );
    expect(signedNoteKey({})).toBe("quoteDoc.signedNoteKept");
  });

  test("the neutral note exists in en and es and points at the PDF", () => {
    expect(en["quoteDoc.signedNoteKept"]).toMatch(/signed copy/i);
    expect(en["quoteDoc.signedNoteKept"]).toMatch(/PDF/);
    expect(es["quoteDoc.signedNoteKept"]).toMatch(/copia firmada/i);
    expect(es["quoteDoc.signedNoteKept"]).toMatch(/PDF/);
  });

  test("quote-doc picks the note through signedNoteKey (no bare !email → SMS fallback)", () => {
    const src = read("front-end/components/quote-doc.tsx");
    expect(src).toMatch(/signedNoteKey\(/);
    expect(src).not.toMatch(/\?\s*t\.signedNote\s*:\s*t\.signedNoteSms/);
  });
});

describe("REQ-403 (m11) the chat's recovery form retires once the quote is accepted", () => {
  const failedText = {
    id: "d1",
    kind: "phase_divider",
    payload: {
      quoteId: "q1",
      channel: "sms",
      smsFailureReason: "That number can't receive texts",
      smsFailureCode: "fictional",
    },
  };
  const customer = { phoneNumber: "+15125550177" };

  test("before signing, the failed text carries the form", () => {
    expect(lastRecoveryDividerId([failedText], customer)).toBe("d1");
  });

  test("after signing, no divider carries it", () => {
    expect(
      lastRecoveryDividerId([failedText], customer, { accepted: true }),
    ).toBeUndefined();
  });

  test("AsstChat passes quoteAccepted to the recovery scan", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /lastRecoveryDividerId\(\s*visible,\s*customer,\s*\{\s*accepted:\s*quoteAccepted\s*\}/,
    );
  });
});
