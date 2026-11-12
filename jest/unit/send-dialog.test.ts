/**
 * REQ-308 (demo-loop cycle 1, issues M3 + m51) — the send dialog.
 *
 * M3: the confirm said "Keep"/"Guardar" and sent at once; "Recommended" was
 * hard-wired to Text + Email even with no email on file; Text + Email with a
 * phone typed and no email was told to "add a phone number or email"; and
 * every dialog string followed the DOCUMENT preview language, so a Spanish
 * app with an English preview got an English dialog.
 * m51: the failed-send recovery card said "Saved to {name} for next time."
 * before anything was saved.
 */
import * as fs from "fs";
import * as path from "path";
import {
  missingContactKey,
  recommendedChannel,
} from "../../front-end/lib/send-dialog.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-308 M3 recommendedChannel follows what the customer has on file", () => {
  it("REQ-308 both only when email AND phone are on file", () => {
    expect(recommendedChannel({ email: "a@b.co", phoneNumber: "+15125550123" }))
      .toBe("both");
  });
  it("REQ-308 phone only → sms; email only → email", () => {
    expect(recommendedChannel({ phoneNumber: "+15125550123" })).toBe("sms");
    expect(recommendedChannel({ email: "a@b.co" })).toBe("email");
  });
  it("REQ-308 neither (or no customer) → nothing is recommended", () => {
    expect(recommendedChannel({})).toBeUndefined();
    expect(recommendedChannel(undefined)).toBeUndefined();
    expect(recommendedChannel({ email: "  ", phoneNumber: "" }))
      .toBeUndefined();
  });
});

describe("REQ-308 M3 missingContactKey names the contact the chosen channel still lacks", () => {
  const none = {};
  it("REQ-308 the demo case: Text + Email, phone typed, no email → needEmail (not the generic needContact)", () => {
    expect(missingContactKey("both", none, { email: "", phone: "5125550123" }))
      .toBe("asstChat.customerStep.needEmail");
  });
  it("REQ-308 Text + Email, email typed, no phone → needPhone", () => {
    expect(missingContactKey("both", none, { email: "a@b.co", phone: "" }))
      .toBe("asstChat.customerStep.needPhone");
  });
  it("REQ-308 Text + Email with nothing on file or typed → needContact (both)", () => {
    expect(missingContactKey("both", none, { email: "", phone: "" }))
      .toBe("asstChat.customerStep.needContact");
  });
  it("REQ-308 sms only ever asks for the phone; email only ever for the email", () => {
    expect(missingContactKey("sms", none, { email: "", phone: "" }))
      .toBe("asstChat.customerStep.needPhone");
    expect(missingContactKey("email", none, { email: "", phone: "" }))
      .toBe("asstChat.customerStep.needEmail");
  });
  it("REQ-308 what is on file or typed satisfies the channel", () => {
    expect(
      missingContactKey("both", { email: "a@b.co" }, {
        email: "",
        phone: "512",
      }),
    )
      .toBeUndefined();
    expect(
      missingContactKey("both", { email: "a@b.co", phoneNumber: "+1" }, {
        email: "",
        phone: "",
      }),
    )
      .toBeUndefined();
    expect(
      missingContactKey("sms", { phoneNumber: "+1" }, { email: "", phone: "" }),
    )
      .toBeUndefined();
    expect(missingContactKey("email", none, { email: "a@b.co", phone: "" }))
      .toBeUndefined();
  });
});

describe("REQ-308 the dictionaries: Send, the split contact errors, the future-tense hint", () => {
  it("REQ-308 M3 the confirm button is Send / Enviar, never Keep / Guardar", () => {
    expect(en["asstChat.send.keep"]).toBe("Send");
    expect(es["asstChat.send.keep"]).toBe("Enviar");
  });
  it("REQ-308 M3 needEmail / needPhone exist in both dictionaries and name only that contact", () => {
    expect(en["asstChat.customerStep.needEmail"]).toMatch(/^Add an email/);
    expect(en["asstChat.customerStep.needEmail"]).not.toMatch(/phone/i);
    expect(en["asstChat.customerStep.needPhone"]).toMatch(/^Add a phone/);
    expect(en["asstChat.customerStep.needPhone"]).not.toMatch(/email/i);
    expect(es["asstChat.customerStep.needEmail"]).toMatch(/^Agrega un correo/);
    expect(es["asstChat.customerStep.needEmail"]).not.toMatch(/teléfono/i);
    expect(es["asstChat.customerStep.needPhone"]).toMatch(
      /^Agrega un (número de )?teléfono/,
    );
    expect(es["asstChat.customerStep.needPhone"]).not.toMatch(/correo/i);
  });
  it("REQ-308 m51 the recovery hint is a promise, not a past-tense confirmation", () => {
    expect(en["asstChat.recovery.savedHint"]).toBe(
      "We'll save it to {name}'s card for next time.",
    );
    expect(es["asstChat.recovery.savedHint"]).toBe(
      "Lo guardaremos en la ficha de {name} para la próxima vez.",
    );
  });
});

describe("REQ-308 M3 the island wires the dialog to the app language and the derivations", () => {
  const src = read("front-end/islands/AsstChat.tsx");
  const start = src.indexOf('data-cy="send-dialog"');
  const end = src.indexOf('data-cy="send-keep"', start);
  const dialog = src.slice(start, src.indexOf("</button>", end));
  it("REQ-308 the dialog exists and renders no string with tFor(previewLang", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(dialog).not.toMatch(/tFor\(\s*previewLang/);
    expect(dialog).toMatch(/tFor\(\s*lang,\s*"asstChat\.send\.howTitle"/);
    expect(dialog).toMatch(/tFor\(\s*lang,\s*"asstChat\.send\.keep"/);
  });
  it("REQ-308 the Recommended tag follows recommendedChannel, not a hard-wired 'both'", () => {
    expect(dialog).not.toMatch(/ch === "both"\s*\?/);
    expect(dialog).toMatch(/recommendedChannel\(/);
    expect(src).toMatch(
      /import \{[^}]*recommendedChannel[^}]*\} from "\.\.\/lib\/send-dialog\.ts"/,
    );
  });
  it("REQ-308 keepAndSend asks for the contact that is actually missing, in the app language", () => {
    const k = src.indexOf("function keepAndSend(");
    const body = src.slice(k, src.indexOf("setSendChannel(ch);", k));
    // REQ-399: sendDialogErrorKey runs missingContactKey first, then format.
    expect(body).toMatch(/(missingContactKey|sendDialogErrorKey)\(/);
    expect(body).not.toMatch(/"asstChat\.customerStep\.needContact"/);
    expect(body).not.toMatch(/tFor\(\s*previewLang/);
  });
});
