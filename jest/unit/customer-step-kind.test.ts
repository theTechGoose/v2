/**
 * REQ-532 (demo-loop cycle 3, issue p8-pair5-b) — "fix every issue the demo
 * found, loop until there are none". Pair 5 tapped "Person" on the lock-quote
 * CTA and the "Who is this for?" form still showed "Business Name (optional)".
 *
 * RCA: CustomerStepPanel (front-end/islands/AsstChat.tsx) kept the picked
 * `kind` and derived `isBusiness`, but rendered the business-name input
 * unconditionally and used the same "Name" placeholder for both kinds.
 *
 * Rule (shared/quote-flow/customer-step.ts `customerCreateShape`):
 *  - person   → one required "Name"; the business name is NOT shown, only a
 *               "+ Add a business name" link that reveals it (optional);
 *  - business → the one required field IS the business name ("Business
 *               name"), no second business-name input; it is saved as both
 *               `name` and `businessName`.
 */
import * as fs from "fs";
import * as path from "path";
import {
  customerCreateBusinessName,
  customerCreateShape,
} from "../../shared/quote-flow/customer-step.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-532 p8-pair5-b: the create form follows the Business / Person pick", () => {
  test("REQ-532 person: 'Name' is the required field and no business-name input is shown up front", () => {
    const s = customerCreateShape("person");
    expect(s.nameKey).toBe("asstChat.customerStep.name");
    expect(s.showBusinessField).toBe(false);
    expect(s.offerAddBusiness).toBe(true);
  });

  test("REQ-532 business: the required field is the business name, with its own placeholder; no second input", () => {
    const s = customerCreateShape("business");
    expect(s.nameKey).toBe("asstChat.customerStep.businessNameRequired");
    expect(s.showBusinessField).toBe(false);
    expect(s.offerAddBusiness).toBe(false);
  });

  test("REQ-532 person who opened '+ Add a business name' gets the optional input", () => {
    expect(customerCreateShape("person", true).showBusinessField).toBe(true);
    expect(customerCreateShape("person", true).offerAddBusiness).toBe(false);
    expect(customerCreateShape("business", true).showBusinessField).toBe(false);
  });

  test("REQ-532 the saved businessName: business → the name typed; person → the optional field, if any", () => {
    expect(customerCreateBusinessName("business", "  Riley Roofing ", ""))
      .toBe("Riley Roofing");
    expect(customerCreateBusinessName("person", "Ana", "  ")).toBeUndefined();
    expect(customerCreateBusinessName("person", "Ana", " Ana's Bakery "))
      .toBe("Ana's Bakery");
  });

  test("REQ-532 en/es carry the business-name placeholder and the add-link", () => {
    for (const d of [en, es]) {
      expect(d["asstChat.customerStep.businessNameRequired"]).toBeTruthy();
      expect(d["asstChat.customerStep.addBusinessName"]).toBeTruthy();
      expect(d["asstChat.customerStep.businessNameRequired"]).not.toMatch(
        /optional|opcional/i,
      );
    }
    expect(en["asstChat.customerStep.businessNameRequired"]).toBe(
      "Business name",
    );
  });

  test("REQ-532 AsstChat renders the form through customerCreateShape and gates wizard-business-name on it", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    expect(chat).toContain("customerCreateShape(kind, addBusinessOpen)");
    expect(chat).toContain("customerCreateBusinessName(");
    expect(chat).toContain('data-cy="wizard-add-business-name"');
    const at = chat.indexOf('data-cy="wizard-business-name"');
    expect(at).toBeGreaterThan(0);
    // the input sits inside a `shape.showBusinessField` branch
    const before = chat.slice(Math.max(0, at - 400), at);
    expect(before).toContain("shape.showBusinessField");
  });
});
