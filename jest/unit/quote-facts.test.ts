/**
 * REQ-265 — demo issue ai-assistant-m1: "The assistant asks again for
 * details already typed. It asks for name, phone or email again, and doesn't
 * preselect the given start date or deposit. Evidence: '¿Para quién es esta?
 * Elige un cliente' after 'Cotización para Maria Lopez…'."
 *
 * Root cause (RCA ai-m1): the only fact ever carried from the typed sentence
 * into the terms wizard was a customer NAME, and only in the starter-chip
 * flow (extractQuickQuotePrefill → prefillCustomerName). Phone, email, start
 * date and deposit were never extracted, and the free-chat flow carried
 * nothing at all.
 *
 * The fix: one extraction (shared/quote-flow/quote-facts.ts) over the text
 * the user typed for this job — the quote's description and the thread's own
 * user messages, which BOTH flows persist — read by every wizard step.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;
beforeAll(() => {
  mod = require("../../shared/quote-flow/quote-facts");
});

/** 2026-11-11, local midnight — the day the demo ran. */
const TODAY = new Date(2026, 10, 11);

describe("REQ-265 extractQuoteFacts — what the user already typed", () => {
  test("the RCA's own sentence: name, phone, start date and half deposit", () => {
    const f = mod.extractQuoteFacts(
      "Quote for Maria Lopez 512-555-0199, paint 3 bedrooms, start Dec 1, half deposit",
      TODAY,
    );
    expect(f.customerName).toBe("Maria Lopez");
    expect(f.customerPhone).toBe("512-555-0199");
    expect(f.customerEmail).toBeNull();
    expect(f.startDate).toEqual({ iso: "2026-12-01", us: "12/01/2026" });
    expect(f.paymentTerms).toBe("50_50");
  });

  test("the demo's free-chat Spanish sentence (pair 2): the name after 'para'", () => {
    const f = mod.extractQuoteFacts(
      "Cotización para Maria Lopez: pintar 3 recámaras, empezamos el 1 de diciembre, 50% de anticipo",
      TODAY,
    );
    expect(f.customerName).toBe("Maria Lopez");
    expect(f.startDate).toEqual({ iso: "2026-12-01", us: "12/01/2026" });
    expect(f.paymentTerms).toBe("50_50");
  });

  test("email and a (512) 555-0199 phone", () => {
    const f = mod.extractQuoteFacts(
      "Deck repair for John Smith, (512) 555-0199, john.smith@example.com",
      TODAY,
    );
    expect(f.customerName).toBe("John Smith");
    expect(f.customerPhone).toBe("(512) 555-0199");
    expect(f.customerEmail).toBe("john.smith@example.com");
  });

  test("'I usually do 50% deposit' and '50/50' are the 50/50 terms; another deposit is deposit + balance", () => {
    expect(
      mod.extractQuoteFacts("I usually do 50% deposit", TODAY).paymentTerms,
    )
      .toBe("50_50");
    expect(mod.extractQuoteFacts("payment 50/50", TODAY).paymentTerms).toBe(
      "50_50",
    );
    expect(mod.extractQuoteFacts("la mitad por adelantado", TODAY).paymentTerms)
      .toBe("50_50");
    expect(mod.extractQuoteFacts("30/30/40 schedule", TODAY).paymentTerms).toBe(
      "30_30_40",
    );
    expect(mod.extractQuoteFacts("25% deposit to book", TODAY).paymentTerms)
      .toBe("deposit_bal");
    expect(mod.extractQuoteFacts("net 15", TODAY).paymentTerms).toBe("net_15");
  });

  test("start dates: month-name, numeric, a passed date rolls to next year", () => {
    expect(mod.extractQuoteFacts("starting on December 3rd", TODAY).startDate)
      .toEqual({ iso: "2026-12-03", us: "12/03/2026" });
    expect(mod.extractQuoteFacts("can start 1/15", TODAY).startDate).toEqual({
      iso: "2027-01-15",
      us: "01/15/2027",
    });
    expect(mod.extractQuoteFacts("start Mar 2, 2027", TODAY).startDate)
      .toEqual({ iso: "2027-03-02", us: "03/02/2027" });
    expect(mod.extractQuoteFacts("inicia el 5 de enero", TODAY).startDate)
      .toEqual({ iso: "2027-01-05", us: "01/05/2027" });
  });

  test("nothing typed → nothing invented", () => {
    const f = mod.extractQuoteFacts(
      "Paint 3 bedrooms, walls and ceilings, 2 coats, $3,700, takes 3 weeks",
      TODAY,
    );
    expect(f).toEqual({
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      startDate: null,
      paymentTerms: null,
      // REQ-343 / REQ-330 (M21): "takes 3 weeks" IS typed — the duration.
      duration: { n: 3, unit: "weeks" },
    });
    // a date that is not a START date is not taken
    expect(mod.extractQuoteFacts("finish by Dec 20", TODAY).startDate)
      .toBeNull();
    // a price is never a phone
    expect(mod.extractQuoteFacts("$1,250,000.00", TODAY).customerPhone)
      .toBeNull();
  });
});

describe("REQ-265 wizardPrefillFor — the wizard step's pre-selection", () => {
  const facts = () =>
    mod.extractQuoteFacts(
      "Quote for Maria Lopez 512-555-0199, start Dec 1, half deposit",
      TODAY,
    );

  test("start_date pre-selects 'Pick a date' with the typed date (ISO since REQ-495, the date picker's value)", () => {
    expect(mod.wizardPrefillFor("start_date", facts())).toEqual({
      optionId: "custom",
      customValue: "2026-12-01", // REQ-495: ISO, was MM/DD/YYYY
    });
  });

  test("payment_terms pre-selects the typed terms", () => {
    expect(mod.wizardPrefillFor("payment_terms", facts())).toEqual({
      optionId: "50_50",
    });
  });

  test("steps the sentence said nothing about stay un-selected", () => {
    expect(mod.wizardPrefillFor("wraps", facts())).toBeNull();
    expect(mod.wizardPrefillFor("warranty", facts())).toBeNull();
    const none = mod.extractQuoteFacts("Paint 3 bedrooms", TODAY);
    expect(mod.wizardPrefillFor("start_date", none)).toBeNull();
    expect(mod.wizardPrefillFor("payment_terms", none)).toBeNull();
  });
});

describe("REQ-265 the customer step — fill, or match an existing customer", () => {
  const facts = () =>
    mod.extractQuoteFacts(
      "Cotización para Maria Lopez 512-555-0199: pintar",
      TODAY,
    );

  test("an existing customer with the typed phone (any format) or name is the match", () => {
    const list = [
      { id: "a", name: "Hans Weber", phoneNumber: "+15125550100" },
      { id: "b", name: "María López", phoneNumber: "+15125550199" },
    ];
    expect(mod.matchPrefillCustomer(list, facts())?.id).toBe("b");
    expect(
      mod.matchPrefillCustomer([{ id: "c", name: "maria lopez" }], facts())?.id,
    ).toBe("c");
    expect(mod.matchPrefillCustomer(list.slice(0, 1), facts())).toBeNull();
  });

  test("a typed customer nobody has yet opens the create form, even when the account has customers (the demo's 'Elige un cliente')", () => {
    expect(mod.customerStepPrefillView("list", facts(), false)).toBe("form");
    expect(mod.customerStepPrefillView("list", facts(), true)).toBe("list");
    const none = mod.extractQuoteFacts("pintar 3 recámaras", TODAY);
    expect(mod.customerStepPrefillView("list", none, false)).toBe("list");
    expect(mod.customerStepPrefillView("form", none, false)).toBe("form");
  });
});

describe("REQ-265 the assistant reads the facts at every step", () => {
  const src = read("front-end/islands/AsstChat.tsx");

  test("facts come from what BOTH flows persist: the quote's description and the thread's user text", () => {
    expect(src).toMatch(
      /from "\.\.\/\.\.\/shared\/quote-flow\/quote-facts\.ts"/,
    );
    expect(src).toMatch(
      /quoteFactsSource\(\s*quote\?\.description,\s*messages/,
    );
    const fn = src.slice(src.indexOf("function quoteFactsSource("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/quoteDescription/);
    expect(body).toMatch(/role === "user"/);
  });

  test("the customer step is handed the name, phone and email", () => {
    const panel = src.slice(src.indexOf("<CustomerStepPanel"));
    const props = panel.slice(0, panel.indexOf("/>"));
    expect(props).toMatch(/initialName=\{quoteFacts\.customerName/);
    expect(props).toMatch(/initialPhone=\{quoteFacts\.customerPhone/);
    expect(props).toMatch(/initialEmail=\{quoteFacts\.customerEmail/);
    expect(props).toMatch(/prefillFacts=\{quoteFacts\}/);
  });

  test("an option step shows the pre-selection as a one-tap confirm", () => {
    expect(src).toMatch(/wizardPrefillFor\(\s*payload\.stepId/);
    expect(src).toMatch(/data-testid="wiz-prefill"/);
    expect(src).toMatch(/wiz-opt--prefill/);
  });

  test("both languages carry the copy", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const k of ["asstChat.wiz.fromMessage", "asstChat.wiz.usePrefill"]) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
    }
  });
});

/**
 * REQ-330 (demo cycle 1, M21): "Thinking 4 weeks" in the job message was
 * never offered on the duration ("wraps") step — wizardPrefillFor handled only
 * start_date and payment_terms. A typed duration is now a fact, offered as
 * the wizard's one-tap pre-selection in the wizard's language.
 */
describe("REQ-330 M21 extractDuration — the typed time to complete", () => {
  test("'Thinking 4 weeks' → 4 weeks, offered as a custom duration on the wraps step", () => {
    const f = mod.extractQuoteFacts(
      "Master bath gut for the Hendersons on Barton Hills Dr 78704. Thinking 4 weeks. Start Dec 1",
      TODAY,
    );
    expect(f.duration).toEqual({ n: 4, unit: "weeks" });
    expect(mod.wizardPrefillFor("wraps", f, "en")).toEqual({
      optionId: "custom",
      customValue: "4 weeks",
    });
    expect(mod.wizardPrefillFor("wraps", f, "es")).toEqual({
      optionId: "custom",
      customValue: "4 semanas",
    });
  });

  test("Spanish: '3 días' and 'dos semanas'", () => {
    expect(mod.extractDuration("Remodelar baño para la señora Gutierrez, 3 días")).toEqual({ n: 3, unit: "days" });
    expect(mod.extractDuration("tomará dos semanas de trabajo")).toEqual({ n: 2, unit: "weeks" });
    expect(mod.extractDuration("unos 2 meses")).toEqual({ n: 2, unit: "months" });
  });

  test("a duration that matches a preset pre-selects the preset", () => {
    const f = (s: string) => mod.extractQuoteFacts(s, TODAY);
    expect(mod.wizardPrefillFor("wraps", f("Paint 3 bedrooms, about 1 week"), "en")).toEqual({ optionId: "1_week" });
    expect(mod.wizardPrefillFor("wraps", f("Paint 3 bedrooms, 2 weeks"), "en")).toEqual({ optionId: "2_weeks" });
    expect(mod.wizardPrefillFor("wraps", f("Fix the faucet, one day job"), "en")).toEqual({ optionId: "1_day" });
  });

  test("a start offset or a warranty span is not a duration", () => {
    expect(mod.extractDuration("Paint 3 bedrooms, start in 2 weeks")).toBeNull();
    expect(mod.extractDuration("Paint 3 bedrooms, starting in 3 days")).toBeNull();
    expect(mod.extractDuration("Pintar, empezamos en 2 semanas")).toBeNull();
    expect(mod.extractDuration("Roof repair with a 2 week warranty")).toBeNull();
    expect(mod.extractDuration("Paint 3 bedrooms")).toBeNull();
    expect(mod.wizardPrefillFor("wraps", mod.extractQuoteFacts("Paint 3 bedrooms", TODAY), "en")).toBeNull();
  });

  test("the assistant hands the wraps step the wizard's language", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/wizardPrefillFor\(\s*payload\.stepId,\s*quoteFacts,\s*lang,?\s*\)/);
  });
});
