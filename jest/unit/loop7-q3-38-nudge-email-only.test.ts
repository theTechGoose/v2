/**
 * REQ-1113 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 3, issue
 * q3-38: "Remind dialog previews a text, but only an email with different
 * wording goes".
 *
 * The nudge reply for a customer whose phone can't take texts is
 * {channels: ["email"], textSkip: "fictional"}. nudgeNote turned any
 * non-empty channels into "invoicesPage.nudge.sent" ("sent"), so the toast
 * never said the text didn't go. It must pick an email-only key, worded in
 * en and es, that says the reminder was emailed and the text couldn't go.
 */
import * as fs from "fs";
import * as path from "path";
import { nudgeNote } from "../../shared/documents/delivery-truth";

const ROOT = path.resolve(__dirname, "../..");
const dict = (lang: string) =>
  JSON.parse(
    fs.readFileSync(path.join(ROOT, `lang/${lang}.json`), "utf8"),
  ) as Record<string, string>;

describe("REQ-1113 q3-38 the nudge toast says when only the email went", () => {
  const reply = { channels: ["email"], textSkip: "fictional" } as Parameters<
    typeof nudgeNote
  >[0];

  it("REQ-1113 q3-38 nudgeNote({channels:['email'], textSkip:'fictional'}) is the email-only note, not the plain 'sent'", () => {
    const note = nudgeNote(reply);
    expect(note.key).toBe("invoicesPage.nudge.sentEmailOnly");
    expect(note.tone).toBe("note");
  });

  it("REQ-1113 q3-38 the email-only note is worded in en and es and names email", () => {
    const key = nudgeNote(reply).key;
    expect(dict("en")[key]).toMatch(/email/i);
    expect(dict("es")[key]).toMatch(/correo/i);
  });

  it("REQ-1113 q3-38 email + text both delivered still reads as the plain 'sent'", () => {
    expect(nudgeNote({ channels: ["email", "sms"] }).key).toBe(
      "invoicesPage.nudge.sent",
    );
  });
});
