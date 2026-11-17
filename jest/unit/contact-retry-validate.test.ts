/**
 * REQ-603 (demo-loop cycle 4, issue M23) — the chat's recovery box ("Fix the
 * number and resend") saved through `saveContactAndRetry`, which sent the
 * typed phone straight to `PUT /customers/:id` and, on the 400, showed lib/api's
 * transport line "PUT /customers/<id> failed: 400" in the chat. The phone input
 * masked with `formatPhoneInput`, which strips every non-digit, so the letter
 * in "512-867-53O9" vanished and only 9 digits were left — and Save stayed
 * enabled on any non-empty draft.
 */
import * as fs from "fs";
import * as path from "path";
import {
  recoveryContactErrors,
  recoveryPhoneValue,
} from "../../front-end/lib/send-dialog.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-603 M23 recoveryContactErrors: the recovery box checks before it saves", () => {
  it("REQ-603 a letter in the phone is flagged, not stripped", () => {
    expect(recoveryContactErrors({ phone: "512-867-53O9" })).toEqual({
      phone: "asstChat.recovery.phoneLetters",
    });
    // even when the digits alone would make ten
    expect(recoveryContactErrors({ phone: "512-867-5309x" }).phone).toBe(
      "asstChat.recovery.phoneLetters",
    );
  });
  it("REQ-603 fewer than 10 digits asks for a full number", () => {
    expect(recoveryContactErrors({ phone: "512-867-539" })).toEqual({
      phone: "customer.invalidPhone",
    });
    expect(recoveryContactErrors({ phone: "(512) 555" }).phone).toBe(
      "customer.invalidPhone",
    );
  });
  it("REQ-603 a full number, masked or not, is fine", () => {
    expect(recoveryContactErrors({ phone: "(512) 867-5309" })).toEqual({});
    expect(recoveryContactErrors({ phone: "+1 512 867 5309" })).toEqual({});
    expect(recoveryContactErrors({ phone: "5128675309" })).toEqual({});
  });
  it("REQ-603 a malformed email is flagged; blanks are not format errors", () => {
    expect(recoveryContactErrors({ email: "bob at gmail" })).toEqual({
      email: "customer.invalidEmail",
    });
    expect(recoveryContactErrors({ email: "bob@example.com" })).toEqual({});
    expect(recoveryContactErrors({ email: "  ", phone: "" })).toEqual({});
    expect(recoveryContactErrors({})).toEqual({});
  });
});

describe("REQ-603 M23 recoveryPhoneValue: what the phone box shows", () => {
  it("REQ-603 a typed letter stays visible", () => {
    expect(recoveryPhoneValue("512-867-53O9")).toBe("512-867-53O9");
  });
  it("REQ-603 digits still get the as-you-type mask", () => {
    expect(recoveryPhoneValue("5128675309")).toBe("(512) 867-5309");
    expect(recoveryPhoneValue("512867")).toBe("(512) 867");
    expect(recoveryPhoneValue("")).toBe("");
  });
});

describe("REQ-603 copy: every key the recovery box shows is worded in en and es", () => {
  it("REQ-603 en + es carry the keys, and none is a transport line", () => {
    for (
      const k of [
        "asstChat.recovery.phoneLetters",
        "customer.invalidPhone",
        "customer.invalidEmail",
        "asstChat.send.contactSaveFailed",
      ]
    ) {
      expect(en[k]).toBeTruthy();
      expect(es[k]).toBeTruthy();
      expect(en[k]).not.toEqual(es[k]);
      expect(en[k]).not.toMatch(/failed: \d/);
    }
    expect(en["customer.invalidPhone"]).toMatch(/10 digits/);
  });
});

describe("REQ-603 AsstChat wires the recovery box through the check", () => {
  const src = read("front-end/islands/AsstChat.tsx");
  const body = (name: string) => {
    const at = src.indexOf(`function ${name}(`);
    expect(at).toBeGreaterThan(-1);
    const next = src.indexOf("\n  async function ", at + 10);
    const next2 = src.indexOf("\n  function ", at + 10);
    const end = Math.min(...[next, next2].filter((i) => i > -1));
    return src.slice(at, end);
  };

  it("REQ-603 saveContactAndRetry checks before the PUT and never shows err.message", () => {
    const s = body("saveContactAndRetry");
    const check = s.indexOf("recoveryContactErrors(");
    const put = s.indexOf("clientsClient.update(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(put);
    expect(s).toMatch(/tFor\(\s*lang,\s*contactSaveErrorKey\(err\)\s*\)/);
    expect(s).not.toMatch(/err\.message/);
  });

  it("REQ-603 the recovery card shows the field error and disables Save on it", () => {
    const from = src.indexOf('class="recovery-card__fields"');
    const card = src.slice(from, src.indexOf("// Continue-CTA", from));
    const save = card.slice(card.indexOf('class="recovery-card__save"'));
    expect(save.slice(0, save.indexOf("onClick"))).toMatch(
      /recoveryErrs\.phone/,
    );
    expect(card).toMatch(/recoveryPhoneValue\(/);
    expect(card).not.toMatch(/formatPhoneInput\(/);
    expect(card).toMatch(/data-cy="recovery-phone-error"/);
    expect(card).toMatch(/aria-invalid/);
    expect(card).toMatch(/recoveryErrs\.(phone|email)/);
  });

  it("REQ-603 guard: no setError in AsstChat renders a raw ApiError message beyond today's count", () => {
    // ratchet — the count may only fall; saveContactAndRetry's one is gone.
    const raw = src.match(/setError\(\s*err instanceof Error \? err\.message/g)
      ?.length ?? 0;
    expect(raw).toBeLessThanOrEqual(17);
  });
});
