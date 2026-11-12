/**
 * REQ-390 (demo-loop cycle 2; demo m18, m19, M18) — "fix every issue the demo
 * found, loop until there are none". The demo saw:
 *  - m19: a red "Add a phone number or email…" in the assistant's "Who is
 *    this for?" form before anything was typed;
 *  - m18: that form named one bad field at a time (phone before email); a
 *    custom duration of "-3" became "1 day"; onboarding blocked silently;
 *  - M18: "Looks like Bob already exists" for a Bob with ANOTHER phone, with
 *    no way to see which Bob; two "Bob" cards on /customers looked identical.
 *
 * Pure rules: shared/quote-flow/customer-contact.ts (customerStepFeedback),
 * shared/quote-flow/customer-dedupe.ts (duplicateNotice),
 * shared/quote-flow/duration-input.ts (parseDurationNumber),
 * front-end/lib/clients-display.ts (cardDisambiguators). The source checks
 * pin that the islands use them.
 */
import * as fs from "fs";
import * as path from "path";
import { customerStepFeedback } from "../../shared/quote-flow/customer-contact.ts";
import { duplicateNotice } from "../../shared/quote-flow/customer-dedupe.ts";
import { parseDurationNumber } from "../../shared/quote-flow/duration-input.ts";
import { cardDisambiguators } from "../../front-end/lib/clients-display.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-390 m18/m19: the in-chat customer form's feedback", () => {
  test("REQ-390 m19: nothing typed → the missing-contact reason is a neutral hint, not an error", () => {
    const f = customerStepFeedback(
      { name: "", email: "", phoneNumber: "" },
      {},
    );
    expect(f.contact).toEqual({
      key: "asstChat.customerStep.needContact",
      tone: "hint",
    });
    expect(f.name).toBeUndefined();
    expect(f.canSubmit).toBe(false);
  });

  test("REQ-390 m19: once a contact field was touched (typed in or left), the reason turns into an error", () => {
    const f = customerStepFeedback(
      { name: "Bob", email: "", phoneNumber: "" },
      {
        contactTouched: true,
      },
    );
    expect(f.contact).toEqual({
      key: "asstChat.customerStep.needContact",
      tone: "error",
    });
  });

  test("REQ-390 m18: a bad phone AND a bad email are both named, each on its own field", () => {
    const f = customerStepFeedback({
      name: "Bob",
      phoneNumber: "555-12",
      email: "bob@@gmail",
    }, { contactTouched: true });
    expect(f.phone).toBe("customer.invalidPhone");
    expect(f.email).toBe("customer.invalidEmail");
    expect(f.contact).toBeUndefined();
    expect(f.canSubmit).toBe(false);
  });

  test("REQ-390 m18: an empty name is named once the name field was left", () => {
    const quiet = customerStepFeedback(
      { name: " ", phoneNumber: "5125550142" },
      {},
    );
    expect(quiet.name).toBeUndefined();
    expect(quiet.canSubmit).toBe(false);
    const named = customerStepFeedback(
      { name: " ", phoneNumber: "5125550142" },
      {
        nameTouched: true,
      },
    );
    expect(named.name).toBe("customer.nameRequired");
  });

  test("REQ-390: the contractor's own phone / email sit on their own field (REQ guard kept)", () => {
    const f = customerStepFeedback({
      name: "Bob",
      phoneNumber: "(512) 555-0100",
      email: "ME@x.com",
    }, { ownerPhone: "+15125550100", ownerEmail: "me@x.com" });
    expect(f.phone).toBe("asstChat.customerStep.ownPhone");
    expect(f.email).toBe("asstChat.customerStep.ownEmail");
    expect(f.canSubmit).toBe(false);
  });

  test("REQ-390: a name and one good contact can be submitted", () => {
    const f = customerStepFeedback({
      name: "Bob",
      phoneNumber: "5125550142",
      email: "",
    }, {});
    expect(f).toEqual({ canSubmit: true });
  });
});

describe("REQ-390 M18: the duplicate warning says which customer it means", () => {
  const bob = {
    id: "c1",
    name: "Bob",
    phoneNumber: "+15125550142",
    email: null,
  };

  test("REQ-390 M18: the same phone → '<name> · <their phone> already exists'", () => {
    const n = duplicateNotice(bob, {
      name: "Robert",
      phoneNumber: "(512) 555-0142",
    });
    expect(n.key).toBe("asstChat.customerStep.alreadyExistsContact");
    expect(n.params).toEqual({ name: "Bob", contact: "(512) 555-0142" });
  });

  test("REQ-390 M18: the same name with a DIFFERENT phone → 'another Bob', with the existing Bob's phone", () => {
    const n = duplicateNotice(bob, { name: "bob", phoneNumber: "5125550177" });
    expect(n.key).toBe("asstChat.customerStep.anotherSameName");
    expect(n.params).toEqual({ name: "Bob", contact: "(512) 555-0142" });
  });

  test("REQ-390 M18: the same name, no contact typed yet → the existing Bob's contact is shown", () => {
    const n = duplicateNotice(bob, { name: "Bob" });
    expect(n.key).toBe("asstChat.customerStep.alreadyExistsContact");
    expect(n.params.contact).toBe("(512) 555-0142");
  });

  test("REQ-390 M18: an existing customer with no contact keeps the plain wording", () => {
    const n = duplicateNotice({ id: "c2", name: "Ann" }, { name: "Ann" });
    expect(n.key).toBe("asstChat.customerStep.alreadyExists");
    expect(n.params).toEqual({ name: "Ann" });
  });

  test("REQ-390 M18: an email match shows the email", () => {
    const n = duplicateNotice(
      { id: "c3", name: "Cy", email: "cy@x.com" },
      { name: "C", email: "CY@x.com" },
    );
    expect(n.key).toBe("asstChat.customerStep.alreadyExistsContact");
    expect(n.params.contact).toBe("cy@x.com");
  });

  test("REQ-390 M18: en and es carry the new wording with {name} and {contact}", () => {
    for (const d of [en, es]) {
      for (const k of ["alreadyExistsContact", "anotherSameName"]) {
        const s = d[`asstChat.customerStep.${k}`];
        expect(s).toMatch(/\{name\}/);
        expect(s).toMatch(/\{contact\}/);
      }
    }
    expect(en["asstChat.customerStep.anotherSameName"]).toMatch(/another/i);
  });
});

describe("REQ-390 M18: same-name cards on /customers carry a disambiguator", () => {
  test("REQ-390 M18: two Bobs get their C-numbers; a unique name gets nothing", () => {
    const m = cardDisambiguators([
      { id: "a", name: "Bob", number: "C-001", phoneNumber: "+15125550142" },
      { id: "b", name: "bób ", number: "C-002", phoneNumber: "+15125550177" },
      { id: "c", name: "Ann", number: "C-003" },
    ]);
    expect(m.get("a")).toBe("C-001");
    expect(m.get("b")).toBe("C-002");
    expect(m.has("c")).toBe(false);
  });

  test("REQ-390 M18: without a number, the phone's last 4 tells them apart", () => {
    const m = cardDisambiguators([
      { id: "a", name: "Bob", phoneNumber: "+15125550142" },
      { id: "b", name: "Bob", phoneNumber: "+15125550177" },
    ]);
    expect(m.get("a")).toBe("···0142");
    expect(m.get("b")).toBe("···0177");
  });
});

describe("REQ-390 m18: a custom duration validates the number typed, before any clamp", () => {
  test.each(["-3", "0", "2.5", "100", "abc", "1e2"])(
    "REQ-390 m18: %s is refused with a message",
    (raw) => {
      const r = parseDurationNumber(raw);
      expect(r.n).toBeNull();
      expect(r.error).toBe("asstChat.duration.invalidNumber");
    },
  );
  test.each([["1", 1], ["3", 3], [" 99 ", 99]])(
    "REQ-390 %s is %d",
    (raw, n) => {
      expect(parseDurationNumber(raw as string)).toEqual({ n, error: null });
    },
  );
  test("REQ-390 empty is not an error yet (Lock in just waits)", () => {
    expect(parseDurationNumber("")).toEqual({ n: null, error: null });
  });
  test("REQ-390 en and es explain the number rule", () => {
    expect(en["asstChat.duration.invalidNumber"]).toMatch(/1.*99/);
    expect(es["asstChat.duration.invalidNumber"]).toMatch(/1.*99/);
  });
});

describe("REQ-390: the islands use the rules", () => {
  const chat = read("front-end/islands/AsstChat.tsx");

  test("REQ-390 m18/m19: AsstChat's create form uses customerStepFeedback, not the one-error customerContactError", () => {
    expect(chat).toMatch(/customerStepFeedback\(/);
    expect(chat).not.toMatch(/customerContactError\(/);
    // the hint has a neutral style until touched
    expect(chat).toMatch(/cust-pick__hint/);
    expect(chat).toMatch(/data-cy="cust-phone-err"/);
    expect(chat).toMatch(/data-cy="cust-email-err"/);
  });

  test("REQ-390 M18: the duplicate warning goes through duplicateNotice", () => {
    expect(chat).toMatch(/duplicateNotice\(/);
  });

  test("REQ-390 m18: the duration input keeps what was typed (no Math.max clamp on input)", () => {
    const start = chat.indexOf("function CustomDurationPickerForm(");
    const end = chat.indexOf("\nfunction ", start + 10);
    const picker = chat.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(picker).toMatch(/parseDurationNumber\(/);
    expect(picker).not.toMatch(/setN\(String\(Math\.max\(1/);
    expect(picker).not.toMatch(/Math\.max\(1, Math\.min\(99, Number\(n\)/);
    expect(picker).toMatch(/data-cy="dur-num-err"/);
  });

  test("REQ-390 M18: ClientsBoard shows the disambiguator on the card face", () => {
    const board = read("front-end/islands/ClientsBoard.tsx");
    expect(board).toMatch(/cardDisambiguators\(/);
    expect(board).toMatch(/data-cy="ccard2-disambig"/);
  });
});
