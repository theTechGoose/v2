/**
 * REQ-386 — demo-loop cycle 2, issue m17: "Assistant loses customer details
 * from the message (names, zip, Bob not picked up, address)".
 *
 * Root cause (RCA m17, analyst + skeptic UPHELD at deb85b35):
 *   - extractCustomerName only reads a name right after a "this is / for /
 *     para" lead-in, takes the first match and stops at punctuation:
 *     "for the Gutierrez family. Maria Gutierrez, …" → "Gutierrez family";
 *     "para Okafor (Daniel Okafor)" → "Okafor"; "Bob wants 6 recessed
 *     lights" (no lead-in) → null;
 *   - extractServiceAddress needs a house number + street word, so a bare
 *     "zip 78745" was thrown away.
 *
 * Target: shared/quote-flow/quick-quote-prefill.ts (+ customer-dedupe.ts).
 */
// deno-lint-ignore no-explicit-any
let prefill: any;
// deno-lint-ignore no-explicit-any
let dedupe: any;
beforeAll(() => {
  prefill = require("../../shared/quote-flow/quick-quote-prefill");
  dedupe = require("../../shared/quote-flow/customer-dedupe");
});

describe("REQ-386 m17 extractCustomerName — the full name wins over a surname or household lead-in", () => {
  test("'for the Gutierrez family. Maria Gutierrez, …' → 'Maria Gutierrez'", () => {
    expect(
      prefill.extractCustomerName(
        "Master bath gut for the Gutierrez family. Maria Gutierrez, (512) 555-0188, maria.g@example.com, zip 78745, $28,000",
      ),
    ).toBe("Maria Gutierrez");
  });
  test("'para Okafor (Daniel Okafor)' → 'Daniel Okafor'", () => {
    expect(
      prefill.extractCustomerName(
        "Cocina para Okafor (Daniel Okafor), $46,500 todo incluido",
      ),
    ).toBe("Daniel Okafor");
  });
  test("a lone household lead-in with no full name stays as it was", () => {
    expect(
      prefill.extractCustomerName("fence for the Smith family, $1,200"),
    ).toBe("Smith family");
    expect(
      prefill.extractCustomerName("patio para la familia Nguyen, $3,700"),
    ).toBe("Familia Nguyen");
  });
  test("an unrelated capitalised pair never replaces the lead-in name", () => {
    expect(
      prefill.extractCustomerName(
        "Kitchen Remodel for Okafor, Home Depot cabinets, $9,000",
      ),
    ).toBe("Okafor");
  });
});

describe("REQ-386 m17 extractCustomerName — '<Name> wants / needs / asked' names the customer", () => {
  test("'Need a quote: Bob wants 6 recessed lights' → 'Bob'", () => {
    expect(
      prefill.extractCustomerName(
        "Need a quote: Bob wants 6 recessed lights kitchen $900",
      ),
    ).toBe("Bob");
  });
  test("'Maria Lopez needs …' / 'Carlos asked …' / ES 'Ana quiere …'", () => {
    expect(prefill.extractCustomerName("Maria Lopez needs a new roof, $9,000"))
      .toBe("Maria Lopez");
    expect(prefill.extractCustomerName("Carlos asked for a deck quote"))
      .toBe("Carlos");
    expect(prefill.extractCustomerName("Ana Ruiz quiere pintar la sala"))
      .toBe("Ana Ruiz");
  });
  test("a pronoun or a job word before the verb is never a name", () => {
    expect(prefill.extractCustomerName("I need 6 recessed lights")).toBeNull();
    expect(prefill.extractCustomerName("She wants a deck, $2,000"))
      .toBeNull();
    expect(prefill.extractCustomerName("The kitchen needs paint")).toBeNull();
  });
});

describe("REQ-386 m17 extractServiceAddress — a bare ZIP is kept", () => {
  test("'zip 78745' → '78745'", () => {
    expect(
      prefill.extractServiceAddress(
        "Master bath gut for Maria Gutierrez, zip 78745, $28,000",
      ),
    ).toBe("78745");
    expect(prefill.extractServiceAddress("código postal 78704, techo"))
      .toBe("78704");
  });
  test("'Austin, TX 78745' keeps the city and state with the ZIP", () => {
    expect(
      prefill.extractServiceAddress("deck for Bob in Austin, TX 78745, $900"),
    ).toBe("Austin, TX 78745");
  });
  test("a street address still wins; a number alone is never a ZIP", () => {
    expect(
      prefill.extractServiceAddress("412 Oak St Austin TX 78704, zip 78704"),
    ).toBe("412 Oak St Austin TX 78704");
    expect(prefill.extractServiceAddress("on Monday 78704")).toBeNull();
    expect(prefill.extractServiceAddress("12000 sq ft warehouse")).toBeNull();
  });
});

describe("REQ-386 m17 findCustomerNamedInText — a known customer's name typed as a word", () => {
  const list = [
    { id: "c-bob", name: "Bob" },
    { id: "c-maria", name: "María López" },
  ];
  test("'Bob wants …' finds the existing Bob", () => {
    expect(
      dedupe.findCustomerNamedInText(list, "quote: Bob wants 6 lights")?.id,
    ).toBe("c-bob");
  });
  test("accent-blind whole-name match; never a lowercase word or a part", () => {
    expect(
      dedupe.findCustomerNamedInText(list, "paint for Maria Lopez")?.id,
    ).toBe("c-maria");
    expect(dedupe.findCustomerNamedInText(list, "bob the roof")).toBeNull();
    expect(dedupe.findCustomerNamedInText(list, "Bobby wants lights"))
      .toBeNull();
    expect(dedupe.findCustomerNamedInText(list, "for Maria, $900"))
      .toBeNull();
  });
  test("two customers named in the text → null (never a guess)", () => {
    expect(
      dedupe.findCustomerNamedInText(list, "Bob and María López, $900"),
    ).toBeNull();
  });
});
