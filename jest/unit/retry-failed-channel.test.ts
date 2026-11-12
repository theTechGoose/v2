/**
 * REQ-568 (demo-loop cycle 4, issue m44) — "Fixing SMS number re-sends the
 * email too."
 *
 * The recovery card's "Save and resend" retried the send on the ORIGINAL
 * channel (`dp.channel`, e.g. "both"), so a send whose email delivered and
 * whose text failed emailed the customer a second time when the contractor
 * fixed the phone number. The retry now covers only the channels that
 * failed — derived from the outcome (emailedTo/textedTo vs the
 * *FailureReason fields), never from the original channel.
 *
 * Targets: front-end/lib/send-delivery.ts (retryChannel),
 * front-end/islands/AsstChat.tsx (the recovery card's resend).
 */
import * as fs from "fs";
import * as path from "path";
import { retryChannel } from "../../front-end/lib/send-delivery.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-568 (cycle 4, m44) the resend retries only the failed channel", () => {
  test("email delivered, text failed → resend by text only", () => {
    expect(
      retryChannel({
        quoteId: "q1",
        channel: "both",
        emailedTo: "a@b.co",
        smsFailureReason: "That number can't receive texts",
        smsFailureCode: "not_mobile",
      }),
    ).toBe("sms");
  });

  test("text delivered, email failed → resend by email only", () => {
    expect(
      retryChannel({
        quoteId: "q1",
        channel: "both",
        textedTo: "+15551234567",
        emailFailureReason: "No email on file",
      }),
    ).toBe("email");
  });

  test("both failed → resend both", () => {
    expect(
      retryChannel({
        quoteId: "q1",
        channel: "both",
        emailFailureReason: "No email on file",
        smsFailureReason: "No phone on file",
      }),
    ).toBe("both");
  });

  test("a single-channel send that failed retries that channel", () => {
    expect(
      retryChannel({ quoteId: "q1", channel: "sms", smsFailureReason: "x" }),
    ).toBe("sms");
    expect(
      retryChannel({
        quoteId: "q1",
        channel: "email",
        emailFailureReason: "x",
      }),
    ).toBe("email");
  });

  test("an older divider without a channel still infers it from the failure", () => {
    expect(retryChannel({ quoteId: "q1", smsFailureReason: "x" })).toBe("sms");
    expect(
      retryChannel({
        quoteId: "q1",
        emailFailureReason: "x",
        smsFailureReason: "y",
      }),
    ).toBe("both");
  });

  test("nothing failed → no retry channel", () => {
    expect(
      retryChannel({
        quoteId: "q1",
        channel: "both",
        emailedTo: "a@b.co",
        textedTo: "+15551234567",
      }),
    ).toBeUndefined();
  });

  test("the recovery card resends via retryChannel, not the divider's channel", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/inferredChannel[^=]*=\s*retryChannel\(dp\)/);
    expect(src).not.toMatch(/inferredChannel[^=]*=\s*dp\.channel\s*\?\?/);
  });
});
