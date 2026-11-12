/**
 * REQ-331 — demo-loop cycle 1, issues m7 + m44: "the assistant asks again
 * for details already given (customer, start day)" and "a duplicate customer
 * is easy to create from the chat's '+ New customer'; the AI asks
 * Business/Person for an existing customer".
 *
 * Root cause (RCA m7/m44, commit 4da03589):
 *   - extractCustomerName needs a Capitalized run right after "for/para":
 *     "quote for customer x", "para la señora López", "this is María" → null;
 *   - extractServiceAddress only knows "<number> <Street> <St>": the ES
 *     "calle Elm 512" and a number-less "on Oak St 78704" → null;
 *   - extractStartDate has no weekday words: "empezar el lunes" → null, so
 *     the start_date step asks again;
 *   - nothing looks an existing customer up by phone / email / folded name
 *     before `create_new` makes a second row.
 *
 * Targets: shared/quote-flow/quick-quote-prefill.ts, quote-facts.ts and
 * the new customer-dedupe.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prefill: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let facts: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dedupe: any;
beforeAll(() => {
  prefill = require("../../shared/quote-flow/quick-quote-prefill");
  facts = require("../../shared/quote-flow/quote-facts");
  dedupe = require("../../shared/quote-flow/customer-dedupe");
});

/** 2026-11-11 — a Wednesday, the day the demo ran. */
const TODAY = new Date(2026, 10, 11);

describe("REQ-331 extractCustomerName — lowercase connectors and honorifics", () => {
  test("'for customer <Name>' (m44's exact phrasing) names the customer", () => {
    expect(
      prefill.extractCustomerName(
        "quote for customer Maria Lopez, paint 3 rooms",
      ),
    )
      .toBe("Maria Lopez");
  });
  test("'para el cliente <Name>'", () => {
    expect(
      prefill.extractCustomerName(
        "cotización para el cliente Juan Pérez, $900",
      ),
    )
      .toBe("Juan Pérez");
  });
  test("'para la señora <Name>' / 'for Mrs. <Name>' drop the honorific", () => {
    expect(prefill.extractCustomerName("pintar la sala para la señora López"))
      .toBe("López");
    expect(
      prefill.extractCustomerName("deck repair for Mrs. Henderson, $2,000"),
    )
      .toBe("Henderson");
  });
  test("'for the Hendersons' keeps the household name", () => {
    expect(
      prefill.extractCustomerName("fence for the Hendersons, 512-555-0199"),
    )
      .toBe("Hendersons");
  });
  test("'this is <Name>' / 'es para <Name>' name the customer", () => {
    expect(prefill.extractCustomerName("this is Maria Lopez, roof patch $450"))
      .toBe("Maria Lopez");
    expect(prefill.extractCustomerName("es para Carlos Ruiz, techo $450"))
      .toBe("Carlos Ruiz");
  });
  test("a single lowercase name right after 'customer' is still the customer", () => {
    expect(prefill.extractCustomerName("quote for customer x")).toBe("X");
  });
  test("still null without a name phrase; a plain 'for' before a job word stays null", () => {
    expect(prefill.extractCustomerName("quote for painting 3 rooms"))
      .toBeNull();
    expect(prefill.extractCustomerName("$900 roof patch")).toBeNull();
  });
});

describe("REQ-331 extractServiceAddress — ES street-first and number-less forms", () => {
  test("'calle Elm 512' (street word, name, number) is the address", () => {
    expect(
      prefill.extractServiceAddress("pintar la casa en calle Elm 512, $900"),
    )
      .toBe("Calle Elm 512");
  });
  test("'calle Elm 512, Austin TX 78704' keeps the city / state / ZIP", () => {
    expect(
      prefill.extractServiceAddress("calle Elm 512, Austin TX 78704, pintura"),
    )
      .toBe("Calle Elm 512, Austin TX 78704");
  });
  test("number-less 'on <Street> <Zip>'", () => {
    expect(prefill.extractServiceAddress("fence on Oak St 78704, $1,200"))
      .toBe("Oak St 78704");
    expect(
      prefill.extractServiceAddress("deck on Barton Hills Dr Austin 78704"),
    )
      .toBe("Barton Hills Dr Austin 78704");
  });
  test("the US form still wins and nothing is invented", () => {
    expect(
      prefill.extractServiceAddress("for Maria Lopez, 412 Oak St Austin, $350"),
    )
      .toBe("412 Oak St Austin");
    expect(prefill.extractServiceAddress("6 paneles on the roof")).toBeNull();
    expect(prefill.extractServiceAddress("on Monday 78704")).toBeNull();
  });
});

describe("REQ-331 extractStartDate — weekday words", () => {
  test("'empezar el lunes' (pair 6: 'I already said lunes!') is next Monday", () => {
    expect(facts.extractStartDate("pintar 3 cuartos, empezar el lunes", TODAY))
      .toEqual({ iso: "2026-11-16", us: "11/16/2026" });
  });
  test("'start next Monday' / 'starting Friday' / 'this Saturday'", () => {
    expect(facts.extractStartDate("start next Monday", TODAY).iso).toBe(
      "2026-11-16",
    );
    expect(facts.extractStartDate("starting Friday, half deposit", TODAY).iso)
      .toBe("2026-11-13");
    expect(facts.extractStartDate("begin this Saturday", TODAY).iso).toBe(
      "2026-11-14",
    );
  });
  test("today's own weekday means next week's (never a date in the past)", () => {
    // TODAY is a Wednesday.
    expect(facts.extractStartDate("comenzamos el miércoles", TODAY).iso)
      .toBe("2026-11-18");
    expect(facts.extractStartDate("start Wednesday", TODAY).iso).toBe(
      "2026-11-18",
    );
  });
  test("'start tomorrow' / 'empezamos mañana'", () => {
    expect(facts.extractStartDate("start tomorrow", TODAY).iso).toBe(
      "2026-11-12",
    );
    expect(facts.extractStartDate("empezamos mañana", TODAY).iso).toBe(
      "2026-11-12",
    );
  });
  test("a weekday with no start word is not a start date", () => {
    expect(facts.extractStartDate("call me Monday about the roof", TODAY))
      .toBeNull();
  });
  test("feeds wizardPrefillFor('start_date') as the picker's custom value", () => {
    const f = facts.extractQuoteFacts(
      "Cotización para María López, empezar el lunes",
      TODAY,
    );
    expect(facts.wizardPrefillFor("start_date", f))
      .toEqual({ optionId: "custom", customValue: "11/16/2026" });
  });
});

const CUSTOMERS = [
  {
    id: "c1",
    name: "María López",
    email: "maria@example.com",
    phoneNumber: "(512) 555-0199",
  },
  {
    id: "c2",
    name: "Tom Henderson",
    email: "tom@example.com",
    phoneNumber: "+15125550100",
  },
  { id: "c3", name: "x", phoneNumber: "512-555-0333" },
];

describe("REQ-331 findExistingCustomer — the same-owner customer a create would duplicate", () => {
  test("by phone, formatting- and country-code-blind", () => {
    expect(
      dedupe.findExistingCustomer(CUSTOMERS, {
        name: "Somebody",
        phoneNumber: "+1 512 555 0199",
      })?.id,
    )
      .toBe("c1");
    expect(
      dedupe.findExistingCustomer(CUSTOMERS, {
        name: "T",
        phoneNumber: "512.555.0100",
      })?.id,
    )
      .toBe("c2");
  });
  test("by email, case-blind", () => {
    expect(
      dedupe.findExistingCustomer(CUSTOMERS, {
        name: "Someone",
        email: " TOM@Example.com ",
      })?.id,
    )
      .toBe("c2");
  });
  test("by name, accent- and case-blind (m44: 'x' already existed as C-001)", () => {
    expect(dedupe.findExistingCustomer(CUSTOMERS, { name: "maria lopez" })?.id)
      .toBe("c1");
    expect(dedupe.findExistingCustomer(CUSTOMERS, { name: "X" })?.id).toBe(
      "c3",
    );
  });
  test("a partial name while typing is not a match; a new contact is not a match", () => {
    expect(dedupe.findExistingCustomer(CUSTOMERS, { name: "Mar" })).toBeNull();
    expect(
      dedupe.findExistingCustomer(CUSTOMERS, {
        name: "Ana Ruiz",
        phoneNumber: "512-555-0777",
      }),
    )
      .toBeNull();
    expect(dedupe.findExistingCustomer(CUSTOMERS, { name: "" })).toBeNull();
    expect(dedupe.findExistingCustomer(null, { name: "x" })).toBeNull();
  });
  test("a phone or email match wins over a different name (same person, retyped)", () => {
    expect(
      dedupe.findExistingCustomer(CUSTOMERS, {
        name: "Maria L.",
        phoneNumber: "5125550199",
      })?.id,
    )
      .toBe("c1");
  });
});

describe("REQ-331 knownCustomerForStep — the one-tap 'Use <name> ✓ / change' candidate", () => {
  test("the chat-bound customer wins", () => {
    const f = facts.extractQuoteFacts("Quote for Tom Henderson", TODAY);
    expect(
      dedupe.knownCustomerForStep(
        { id: "c1", name: "María López" },
        CUSTOMERS,
        f,
      ),
    )
      .toEqual({
        source: "bound",
        customer: { id: "c1", name: "María López" },
      });
  });
  test("otherwise the existing customer the typed facts name", () => {
    const f = facts.extractQuoteFacts(
      "Cotización para María López, pintar 3 cuartos",
      TODAY,
    );
    const k = dedupe.knownCustomerForStep(undefined, CUSTOMERS, f);
    expect(k?.source).toBe("match");
    expect(k?.customer.id).toBe("c1");
  });
  test("nobody known → null (the list / form as before)", () => {
    const f = facts.extractQuoteFacts("Quote for Ana Ruiz", TODAY);
    expect(dedupe.knownCustomerForStep(undefined, CUSTOMERS, f)).toBeNull();
    expect(dedupe.knownCustomerForStep(undefined, null, f)).toBeNull();
  });
});
