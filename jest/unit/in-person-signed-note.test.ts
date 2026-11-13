/**
 * REQ-560 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue p4-p2b: "In-person signing note tells
 * contractor to check his email". signedNoteKey had no in-person / business-
 * viewer branch, so after the customer signed on the contractor's device the
 * note under "Signed and binding" told whoever held it to check "your" email.
 */
import * as fs from "fs";
import * as path from "path";
import {
  signedNoteKey,
  signedNoteParams,
} from "../../shared/quote-flow/signed-note.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const OVERRIDE = "?lang=en&as=customer&confirm=1";

describe("REQ-560 (cycle 4, p4-p2b) the signed note on the business's own device", () => {
  test("signed in person (business viewer + in-person override) → the in-person keys, per channel", () => {
    expect(
      signedNoteKey({ confirmChannel: "email", internal: true }, OVERRIDE),
    ).toBe("quoteDoc.signedNoteInPerson");
    expect(
      signedNoteKey({ confirmChannel: "text", internal: true }, OVERRIDE),
    ).toBe("quoteDoc.signedNoteInPersonSms");
    expect(
      signedNoteKey({ confirmChannel: "none", internal: true }, OVERRIDE),
    ).toBe("quoteDoc.signedNoteInPersonKept");
  });

  test("the business viewing a signed quote without the override → the owner keys (never 'your email')", () => {
    expect(signedNoteKey({ confirmChannel: "email", internal: true })).toBe(
      "quoteDoc.signedNoteOwner",
    );
    expect(signedNoteKey({ confirmChannel: "text", internal: true }, "")).toBe(
      "quoteDoc.signedNoteOwnerSms",
    );
    expect(signedNoteKey({ confirmChannel: "none", internal: true })).toBe(
      "quoteDoc.signedNoteOwnerKept",
    );
  });

  test("the customer's own device keeps the current copy, even with the override query", () => {
    expect(signedNoteKey({ confirmChannel: "email" }, OVERRIDE)).toBe(
      "quoteDoc.signedNote",
    );
    expect(signedNoteKey({ confirmChannel: "text" })).toBe(
      "quoteDoc.signedNoteSms",
    );
    expect(signedNoteKey({ confirmChannel: "none" })).toBe(
      "quoteDoc.signedNoteKept",
    );
  });

  test("params name the customer and the address the copy goes to", () => {
    expect(
      signedNoteParams(
        { customer: { name: " Ana Pérez ", email: "ana@example.com" } },
        "your customer",
      ),
    ).toEqual({ customer: "Ana Pérez", email: "ana@example.com" });
    expect(signedNoteParams({ acceptedName: "Ana" }, "your customer"))
      .toEqual({ customer: "Ana", email: "" });
    expect(signedNoteParams({}, "your customer")).toEqual({
      customer: "your customer",
      email: "",
    });
  });

  test("every new key exists in en and es, names the customer, and never says 'your email'", () => {
    const keys = [
      "quoteDoc.signedNoteInPerson",
      "quoteDoc.signedNoteInPersonSms",
      "quoteDoc.signedNoteInPersonKept",
      "quoteDoc.signedNoteOwner",
      "quoteDoc.signedNoteOwnerSms",
      "quoteDoc.signedNoteOwnerKept",
      "quoteDoc.signedNoteCustomerFallback",
    ];
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
    for (const k of keys.slice(0, 6)) {
      expect(en[k]).toContain("{customer}");
      expect(es[k]).toContain("{customer}");
      expect(en[k]).not.toMatch(/your email|checking your/i);
      expect(es[k]).not.toMatch(/tu correo/i);
    }
    expect(en["quoteDoc.signedNoteInPerson"]).toMatch(/^Signed in person/);
    expect(en["quoteDoc.signedNoteInPerson"]).toContain("{email}");
    expect(es["quoteDoc.signedNoteInPerson"]).toContain("{email}");
    expect(en["quoteDoc.signedNoteOwner"]).toContain("{email}");
    expect(es["quoteDoc.signedNoteOwner"]).toContain("{email}");
    expect(en["quoteDoc.signedNoteInPersonSms"]).toMatch(/by text/);
    expect(es["quoteDoc.signedNoteInPersonSms"]).toMatch(/por mensaje/);
  });

  test("quote-doc passes the page's search and the note params", () => {
    const src = read("front-end/components/quote-doc.tsx");
    expect(src).toMatch(/signedNoteKey\(quote,\s*search\)/);
    expect(src).toMatch(/signedNoteParams\(/);
  });
});
