/**
 * REQ-402 (demo-loop cycle 2, issue m5) — the send chooser tells the truth
 * about each channel.
 *
 * m5: for a phone-only customer the split-button menu tagged "Text + Email"
 * Recommended while the dialog tagged "Text only"; the dialog offered Email
 * with no hint that there was no email on file; the main button read "Send
 * by Text" yet only opened a chooser; the add-email field said "Add an email
 * to also email it" / "Email (optional)" even when Email was the only
 * channel; and the title read "How do you want to send to customer?".
 */
import * as fs from "fs";
import * as path from "path";
import {
  addFieldLabelKey,
  channelNeedsKey,
  defaultSendChannel,
} from "../../front-end/lib/send-dialog.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const bob = { phoneNumber: "+15125550123" }; // phone, no email
const ana = { email: "ana@example.com" }; // email, no phone
const both = { email: "a@b.co", phoneNumber: "+15125550123" };

describe("REQ-402 m5 channelNeedsKey names what a channel lacks on file", () => {
  it("REQ-402 phone-only customer: Email and Text + Email need an email; Text needs nothing", () => {
    expect(channelNeedsKey("email", bob)).toBe("asstChat.send.needsEmail");
    expect(channelNeedsKey("both", bob)).toBe("asstChat.send.needsEmail");
    expect(channelNeedsKey("sms", bob)).toBeUndefined();
  });
  it("REQ-402 email-only customer: Text and Text + Email need a phone", () => {
    expect(channelNeedsKey("sms", ana)).toBe("asstChat.send.needsPhone");
    expect(channelNeedsKey("both", ana)).toBe("asstChat.send.needsPhone");
    expect(channelNeedsKey("email", ana)).toBeUndefined();
  });
  it("REQ-402 nothing on file: Text + Email needs both; full contact needs nothing", () => {
    expect(channelNeedsKey("both", {})).toBe("asstChat.send.needsBoth");
    expect(channelNeedsKey("both", undefined)).toBe("asstChat.send.needsBoth");
    expect(channelNeedsKey("both", both)).toBeUndefined();
    expect(channelNeedsKey("sms", both)).toBeUndefined();
    expect(channelNeedsKey("email", both)).toBeUndefined();
  });
  it("REQ-402 a blank email does not count as on file", () => {
    expect(channelNeedsKey("email", { email: "  ", phoneNumber: "+1" }))
      .toBe("asstChat.send.needsEmail");
  });
});

describe("REQ-402 m5 defaultSendChannel is the recommended channel", () => {
  it("REQ-402 phone-only → sms, email-only → email, both → both, neither → both", () => {
    expect(defaultSendChannel(bob)).toBe("sms");
    expect(defaultSendChannel(ana)).toBe("email");
    expect(defaultSendChannel(both)).toBe("both");
    expect(defaultSendChannel({})).toBe("both");
    expect(defaultSendChannel({ email: " ", phoneNumber: "+1" })).toBe("sms");
  });
});

describe("REQ-402 m5 the add-contact field says when it is the only channel", () => {
  it('REQ-402 Email only → "Customer\'s email"; Text only → "Customer\'s phone"', () => {
    expect(addFieldLabelKey("email", "email")).toBe(
      "asstChat.send.customerEmail",
    );
    expect(addFieldLabelKey("phone", "sms")).toBe(
      "asstChat.send.customerPhone",
    );
  });
  it("REQ-402 Text + Email keeps the 'also' wording", () => {
    expect(addFieldLabelKey("email", "both")).toBe("asstChat.send.addEmail");
    expect(addFieldLabelKey("phone", "both")).toBe("asstChat.send.addPhone");
  });
});

describe("REQ-402 m5 the dictionaries", () => {
  it("REQ-402 the title names the customer, with a fallback", () => {
    expect(en["asstChat.send.howTitle"]).toBe(
      "How do you want to send this to {name}?",
    );
    expect(es["asstChat.send.howTitle"]).toBe(
      "¿Cómo quieres enviárselo a {name}?",
    );
    expect(en["asstChat.send.howTitleNoName"]).toBe(
      "How do you want to send this to your customer?",
    );
    expect(es["asstChat.send.howTitleNoName"]).toBe(
      "¿Cómo quieres enviárselo a tu cliente?",
    );
  });
  it("REQ-402 the needs hints, the required field labels and a placeholder with no '(optional)'", () => {
    for (const d of [en, es]) {
      for (
        const k of [
          "asstChat.send.needsEmail",
          "asstChat.send.needsPhone",
          "asstChat.send.needsBoth",
          "asstChat.send.customerEmail",
          "asstChat.send.customerPhone",
          "asstChat.send.emailPlaceholder",
          "asstChat.preview.sendOpen",
        ]
      ) expect(d[k]).toBeTruthy();
      expect(d["asstChat.send.emailPlaceholder"]).not.toMatch(
        /opcional|optional/i,
      );
    }
    expect(en["asstChat.send.needsEmail"]).toBe("needs an email");
    expect(en["asstChat.send.needsPhone"]).toBe("needs a phone");
    expect(en["asstChat.send.customerEmail"]).toBe("Customer's email");
    expect(en["asstChat.preview.sendOpen"]).toBe("Send…");
    expect(es["asstChat.preview.sendOpen"]).toBe("Enviar…");
  });
});

describe("REQ-402 m5 the island wires menu and dialog to the same derivations", () => {
  const src = read("front-end/islands/AsstChat.tsx");
  const dStart = src.indexOf('data-cy="send-dialog"');
  const dialog = src.slice(dStart, src.indexOf('data-cy="send-keep"', dStart));
  const mStart = src.indexOf('class="quote-review__send-menu"');
  const menu = src.slice(mStart, src.indexOf("menuCopyLink", mStart));
  const mainStart = src.indexOf('class="quote-review__send-main"');
  const main = src.slice(mainStart, src.indexOf("</button>", mainStart));

  it("REQ-402 the menu tags Recommended only where recommendedChannel says so", () => {
    expect(mStart).toBeGreaterThan(0);
    const tags = menu.split('"asstChat.preview.recommended"').length - 1;
    expect(tags).toBe(1); // one tag, rendered per channel
    expect(menu).toMatch(/recommendedChannel\(customer\) === ch/);
    // all three channels still offered
    for (const k of ["menuBoth", "menuSms", "menuEmail"]) {
      expect(menu).toContain(`"asstChat.preview.${k}"`);
    }
  });
  it("REQ-402 menu and dialog both mark a channel whose contact is missing", () => {
    expect(menu).toMatch(/channelNeedsKey\(ch, customer\)/);
    expect(dialog).toMatch(/channelNeedsKey\(ch, customer\)/);
  });
  it("REQ-402 the dialog title names the customer", () => {
    expect(dialog).toMatch(/"asstChat\.send\.howTitle",\s*\{/);
    expect(dialog).toContain('"asstChat.send.howTitleNoName"');
  });
  it("REQ-402 the add-email field is labelled by addFieldLabelKey with no '(optional)' placeholder", () => {
    expect(dialog).toMatch(/addFieldLabelKey\("email", dialogChannel\)/);
    expect(dialog).toMatch(/addFieldLabelKey\("phone", dialogChannel\)/);
    expect(dialog).not.toContain('"asstChat.customerStep.emailPlaceholder"');
    expect(dialog).toContain('"asstChat.send.emailPlaceholder"');
  });
  it("REQ-402 the main button opens a chooser, so it reads 'Send…', not 'Send by Text'", () => {
    expect(main).toContain('"asstChat.preview.sendOpen"');
    expect(main).not.toMatch(/asstChat\.preview\.send(Both|Sms|Email)"/);
  });
  it("REQ-402 the smart default uses defaultSendChannel, not its own copy of the rule", () => {
    expect(src).toMatch(/setSendChannel\(defaultSendChannel\(customer\)\)/);
  });
});
