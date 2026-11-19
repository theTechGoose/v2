/**
 * REQ-1029 (LOOP-007 cycle 2, q2-10) — the /customers board's "Send a kind
 * reminder" on a customer who owes money handed off to `sms:` for a phone
 * the app itself refuses to text (REQ-569 `phoneCantReceiveTexts`, the
 * fictional 555-01xx block). On desktop nothing happened and nothing reached
 * the Outbox, while the invoice send sheet for the same customer says the
 * phone can't take texts and recommends email.
 *
 * Pins: (1) the card's message links skip an untextable phone — mailto: when
 * there is an email, nothing otherwise; (2) the board card's CTA handler runs
 * the app's own invoice reminder (the send sheet → dispatchInvoice), not an
 * `sms:` hand-off via `location.href`.
 */
import * as fs from "fs";
import * as path from "path";
import { messageHref } from "../../shared/card-actions/mod";
import { phoneCantReceiveTexts } from "../../shared/quote-flow/sms-number";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ca = () => require("../../front-end/lib/client-actions");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const ROSA = { phoneNumber: "843-555-0111", email: "rosa@blackhole.postmarkapp.com" };

describe("REQ-1029 (q2-10) the board never texts a phone the app says can't take texts", () => {
  test("REQ-1029 precondition: 843-555-0111 is a phone the shared REQ-569 rule flags", () => {
    expect(phoneCantReceiveTexts(ROSA.phoneNumber)).toBe(true);
  });

  test("REQ-1029 messageHref: an untextable phone + email → mailto:, never sms:", () => {
    expect(messageHref(ROSA)).toBe("mailto:rosa@blackhole.postmarkapp.com");
    expect(messageHref(ROSA, "hola")).toBe(
      "mailto:rosa@blackhole.postmarkapp.com?body=hola",
    );
  });

  test("REQ-1029 messageHref: an untextable phone and no email → null (the card opens instead)", () => {
    expect(messageHref({ phoneNumber: ROSA.phoneNumber })).toBeNull();
  });

  test("REQ-1029 messageHrefFor (panel Message): an untextable phone + email → mailto:, no email → null", () => {
    const { messageHrefFor } = ca();
    const base = { balanceCents: 0, status: "regular" };
    expect(messageHrefFor({ ...base, ...ROSA })).toBe(
      "mailto:rosa@blackhole.postmarkapp.com",
    );
    expect(messageHrefFor({ ...base, phoneNumber: ROSA.phoneNumber }))
      .toBeNull();
  });

  test("REQ-1029 nudgeActionFor: a reminder for an untextable phone with no email opens the card, not sms:", () => {
    const { nudgeActionFor } = ca();
    expect(
      nudgeActionFor({
        balanceCents: 64000,
        status: "active",
        phoneNumber: ROSA.phoneNumber,
      }),
    ).toEqual({ kind: "open" });
  });

  test("REQ-1029 ClientsBoard onCta: the 'reminder' CTA runs the app's own invoice reminder, not a location.href hand-off", () => {
    const src = read("front-end/islands/ClientsBoard.tsx");
    const start = src.indexOf("function onCta(");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n  function ", start + 1);
    const body = src.slice(start, end < 0 ? undefined : end);
    // the reminder is handled on its own …
    expect(body).toMatch(/["']reminder["']/);
    // … through the in-app send (the send sheet / dispatchInvoice / the
    // workspace's remind deep link), not an OS texting app
    expect(body).toMatch(/InvoiceSendDialog|dispatchInvoice|remind=|setRemind|onRemind/);
    // and the reminder branch returns before any location.href hand-off
    const reminderAt = body.search(/["']reminder["']/);
    const hrefAt = body.indexOf("location.href");
    if (hrefAt > -1) {
      expect(reminderAt).toBeGreaterThan(-1);
      expect(reminderAt).toBeLessThan(hrefAt);
    }
  });
});
