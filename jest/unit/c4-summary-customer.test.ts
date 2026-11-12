/**
 * REQ-576 — demo-loop cycle 4, issue m26: "Quote wizard asks again who quote
 * is for; two different flows for same task".
 *
 * Root cause (RCA m26, analyst LIKELY + skeptic UPHELD at ad104a19): the
 * customer the model wrote into the quote's summary ("Electrical outlet
 * installation — Bob Smith") was never read. The create_quote branch bound a
 * customer only from the user's typed facts, so a lowercase / partial name or
 * a missing "for" lead-in left the thread unbound and the lock CTA asked
 * "Is this for a business or a person?" for a saved customer.
 *
 * Target: shared/quote-flow/customer-dedupe.ts (+ the AsstChat customer step).
 */
import { readFileSync } from "fs";
import { join } from "path";

// deno-lint-ignore no-explicit-any
let dedupe: any;
beforeAll(() => {
  dedupe = require("../../shared/quote-flow/customer-dedupe");
});

describe("REQ-576 m26 customerNameFromSummary — the name after the summary's spaced dash", () => {
  test("'Electrical outlet installation — Bob Smith' → 'Bob Smith'", () => {
    expect(
      dedupe.customerNameFromSummary(
        "Electrical outlet installation — Bob Smith",
      ),
    ).toBe("Bob Smith");
  });
  test("en dash and spaced hyphen work too; accents are kept", () => {
    expect(dedupe.customerNameFromSummary("Pintura – María López")).toBe(
      "María López",
    );
    expect(dedupe.customerNameFromSummary("Fence repair - O'Neil")).toBe(
      "O'Neil",
    );
  });
  test("no dash, or a tail that is not name-shaped → null", () => {
    expect(dedupe.customerNameFromSummary("Quote: Interior paint")).toBeNull();
    expect(dedupe.customerNameFromSummary("Deck — 2 lines of work, $900"))
      .toBeNull();
    expect(dedupe.customerNameFromSummary("Roof — 412 Oak St")).toBeNull();
    expect(dedupe.customerNameFromSummary(null)).toBeNull();
    expect(dedupe.customerNameFromSummary("")).toBeNull();
  });
  test("a hyphenated word is not a dash ('Re-roof')", () => {
    expect(dedupe.customerNameFromSummary("Re-roof garage")).toBeNull();
  });
});

describe("REQ-576 m26 findCustomerNamedInSummary — only the account's own, only one", () => {
  const bob = { id: "c-bob", name: "Bob Smith" };
  const maria = { id: "c-maria", name: "María López" };
  test("matches the one customer whose whole name is the summary's tail, case- and accent-blind", () => {
    expect(
      dedupe.findCustomerNamedInSummary(
        [maria, bob],
        "Electrical outlet installation — bob smith",
      ),
    ).toBe(bob);
    expect(
      dedupe.findCustomerNamedInSummary([maria, bob], "Pintura — Maria Lopez"),
    ).toBe(maria);
  });
  test("two customers with that name → null (never a guess)", () => {
    expect(
      dedupe.findCustomerNamedInSummary(
        [bob, { id: "c-bob2", name: "Bob Smith" }],
        "Outlets — Bob Smith",
      ),
    ).toBeNull();
  });
  test("a name nobody has, or a partial name → null", () => {
    expect(dedupe.findCustomerNamedInSummary([bob], "Outlets — Ana Ruiz"))
      .toBeNull();
    expect(dedupe.findCustomerNamedInSummary([bob], "Outlets — Bob"))
      .toBeNull();
    expect(dedupe.findCustomerNamedInSummary([], "Outlets — Bob Smith"))
      .toBeNull();
  });
});

describe("REQ-576 m26 withSummaryCustomerName — the customer step's facts", () => {
  const empty = {
    customerName: null,
    customerPhone: null,
    customerEmail: null,
  };
  test("no typed name → the summary's name fills it (the step opens its create form prefilled)", () => {
    const out = dedupe.withSummaryCustomerName(
      empty,
      "Electrical outlet installation — Bob Smith",
    );
    expect(out.customerName).toBe("Bob Smith");
  });
  test("a typed name wins over the summary", () => {
    const out = dedupe.withSummaryCustomerName(
      { ...empty, customerName: "Robert Smith" },
      "Outlets — Bob Smith",
    );
    expect(out.customerName).toBe("Robert Smith");
  });
  test("no name in the summary → the same facts object back", () => {
    expect(dedupe.withSummaryCustomerName(empty, "Outlets")).toBe(empty);
  });
});

describe("REQ-576 m26 the chat's customer step reads the quote summary's customer", () => {
  const src = readFileSync(
    join(__dirname, "../../front-end/islands/AsstChat.tsx"),
    "utf8",
  );
  test("AsstChat derives the step's facts with withSummaryCustomerName(quoteFacts, quote?.summary)", () => {
    expect(src).toMatch(
      /withSummaryCustomerName\(\s*quoteFacts,\s*quote\?\.summary/,
    );
  });
  test("the CustomerStepPanel gets those facts (name + prefillFacts)", () => {
    expect(src).toMatch(/initialName=\{stepFacts\.customerName/);
    expect(src).toMatch(/prefillFacts=\{stepFacts\}/);
  });
});
