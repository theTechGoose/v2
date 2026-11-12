/**
 * REQ-569 (demo-loop cycle 4, issue m46) — the send dialog never recommends
 * a text to a number that can't receive one.
 *
 * m46: a customer with an email and a fictional 555 phone was offered
 * "Text + Email" as Recommended, although the SMS layer refuses that number
 * before the provider (REQ-523). The predicate now lives in
 * shared/quote-flow/sms-number.ts, used by the backend's guard and by
 * front-end/lib/send-dialog.ts alike.
 */
import * as fs from "fs";
import * as path from "path";
import {
  isFictionalUsNumber,
  phoneCantReceiveTexts,
} from "../../shared/quote-flow/sms-number.ts";
import {
  channelNeedsKey,
  defaultSendChannel,
  recommendedChannel,
} from "../../front-end/lib/send-dialog.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const fictional = "+15125550123"; // reserved 555-01XX block
const fictionalArea = "(555) 555-1234"; // area code 555
const real = "+15126550123";

describe("REQ-569 m46 the shared undeliverable-number predicate", () => {
  it("REQ-569 flags the 555-01XX block and area code 555, in any typed form", () => {
    expect(isFictionalUsNumber("+15125550100")).toBe(true);
    expect(isFictionalUsNumber("+15555551234")).toBe(true);
    expect(phoneCantReceiveTexts(fictional)).toBe(true);
    expect(phoneCantReceiveTexts("(512) 555-0199")).toBe(true);
    expect(phoneCantReceiveTexts(fictionalArea)).toBe(true);
  });
  it("REQ-569 a real number, a 555-6xxx line, a blank and a non-US number are not flagged", () => {
    expect(phoneCantReceiveTexts(real)).toBe(false);
    expect(phoneCantReceiveTexts("+15125556252")).toBe(false);
    expect(phoneCantReceiveTexts("+442079460958")).toBe(false);
    expect(phoneCantReceiveTexts("")).toBe(false);
    expect(phoneCantReceiveTexts(undefined)).toBe(false);
  });
});

describe("REQ-569 m46 recommendedChannel skips a number that can't take texts", () => {
  it("REQ-569 email + fictional phone → email, not both", () => {
    expect(recommendedChannel({ email: "a@b.co", phoneNumber: fictional }))
      .toBe("email");
    expect(recommendedChannel({ email: "a@b.co", phoneNumber: fictionalArea }))
      .toBe("email");
  });
  it("REQ-569 fictional phone only → nothing recommended; real phone → unchanged", () => {
    expect(recommendedChannel({ phoneNumber: fictional })).toBeUndefined();
    expect(recommendedChannel({ email: "a@b.co", phoneNumber: real }))
      .toBe("both");
    expect(recommendedChannel({ phoneNumber: real })).toBe("sms");
  });
  it("REQ-569 the starting channel is email when the phone can't take texts", () => {
    expect(defaultSendChannel({ email: "a@b.co", phoneNumber: fictional }))
      .toBe("email");
    expect(defaultSendChannel({ phoneNumber: fictional })).toBe("email");
  });
});

describe("REQ-569 m46 Text is marked 'This number can't receive texts'", () => {
  it("REQ-569 Text and Text + Email carry the hint; Email does not", () => {
    const c = { email: "a@b.co", phoneNumber: fictional };
    expect(channelNeedsKey("sms", c)).toBe("asstChat.send.cantText");
    expect(channelNeedsKey("both", c)).toBe("asstChat.send.cantText");
    expect(channelNeedsKey("email", c)).toBeUndefined();
    expect(channelNeedsKey("sms", { phoneNumber: fictional }))
      .toBe("asstChat.send.cantText");
    expect(channelNeedsKey("sms", { phoneNumber: real })).toBeUndefined();
  });
  it("REQ-569 the copy exists in en and es", () => {
    expect(en["asstChat.send.cantText"]).toBe(
      "This number can't receive texts",
    );
    expect(es["asstChat.send.cantText"]).toBe(
      "Este número no puede recibir mensajes de texto",
    );
  });
});

describe("REQ-569 m46 one rule, not two copies", () => {
  it("REQ-569 the backend's normalize-phone takes isFictionalUsNumber from shared/", () => {
    const src = read(
      "backend/src/users/domain/business/normalize-phone/mod.ts",
    );
    expect(src).toMatch(/from "#quote-flow\/sms-number\.ts"/);
    expect(src).not.toMatch(/function isFictionalUsNumber/);
  });
});
