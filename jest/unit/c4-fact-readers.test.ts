/**
 * REQ-575 — demo-loop cycle 4, issues M3 ("the assistant drops or misreads
 * details from the message: client name, dates, duration, amount, phone")
 * and M13 ("the assistant's prices are far too low").
 *
 * Root cause (RCA M3 + M13, analyst CONFIRMED/LIKELY, skeptic UPHELD at
 * ad104a19): the deterministic fact readers in shared/quote-flow miss common
 * phrasings, and the wizard / price picker / suggest-prices floor prefill
 * only from them:
 *   - extractPriceCents knows "$N" and "N dólares" only — "como 18 mil?",
 *     "18k", "~$23k labor … $9.5k cabinets" read as nothing or as $23 + $9.50
 *     (the k/mil reader lived only in backend stated-price, REQ-445);
 *   - parseDateAt reads a weekday word before a month-day: "we start monday
 *     nov 23" → next Monday (Nov 16); "la próxima semana" is no date at all;
 *   - DURATION_RE drops "y media / and a half": "Dos semanas y media" → 2;
 *   - extractCustomerName needs "for/para <Name>": "cliente Juan Pérez" and
 *     "de la señora Tran" → null; "for the Hendersons" never upgrades to
 *     "Carol Henderson" (the fold is not plural-tolerant), and AsstChat read
 *     the quote description before the user's own turns;
 *   - a typed phone that is not a usable number ("555") was dropped silently.
 *
 * Phrasings are the demo's own (pairs 7, 9, 10; fleet-6/8/9 stdout) plus the
 * neighbouring ways a contractor says the same thing.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prefill: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let facts: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let money: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let durationInput: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let completion: any;
beforeAll(() => {
  prefill = require("../../shared/quote-flow/quick-quote-prefill");
  facts = require("../../shared/quote-flow/quote-facts");
  durationInput = require("../../shared/quote-flow/duration-input");
  completion = require("../../shared/quote-flow/completion-schedule");
  try {
    money = require("../../shared/quote-flow/money-amounts");
  } catch {
    money = {};
  }
});

/** 2026-11-12 — a Thursday, the day cycle 4's demo ran. */
const TODAY = new Date(2026, 10, 12);
const day = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return { iso, us: `${m}/${d}/${y}` };
};

// ---------------------------------------------------------------------------
// Amounts — one money reader for the client and the server
// ---------------------------------------------------------------------------

/** Pair 7's Q-002, typed after "Just give me a quick quote." (fleet-6
 *  stdout:49/245) — the report quotes its ending verbatim. */
const PAIR7_Q2 =
  "Baño principal de la señora Tran en Round Rock, 512-555-0144: quitar la tina, regadera nueva con banca, piso radiante. " +
  "Dos semanas y media. Ponle precio, no sé, como 18 mil?";
/** Pair 7's stated costs on the kitchen gut (fleet-6 stdout:51/162/218). */
const PAIR7_COSTS =
  "my crew is 3 guys x 3 weeks x $65/hr = ~$23k labor alone, cabinets are $9.5k";

describe("REQ-575 M3 extractPriceCents — k / mil / thousand amounts", () => {
  test("pair 7's '…Ponle precio, no sé, como 18 mil?' is $18,000 (the picker showed $0.00)", () => {
    expect(prefill.extractPriceCents(PAIR7_Q2)).toBe(1_800_000);
    expect(prefill.extractQuickQuotePrefill(PAIR7_Q2).priceCents).toBe(
      1_800_000,
    );
  });
  test.each([
    ["18k", 1_800_000],
    ["Roof replacement, $18k", 1_800_000],
    ["deck, around $9.5k all in", 950_000],
    ["kitchen, 18 thousand", 1_800_000],
    ["bathroom, 18 grand", 1_800_000],
    ["cerca nueva, 18 mil dólares", 1_800_000],
    ["como 18 mil", 1_800_000],
  ])("REQ-575 '%s' → %i cents", (text, cents) => {
    expect(prefill.extractPriceCents(text)).toBe(cents);
  });
  test("a size or a rating is never money: '6 mil vapor barrier', '12k btu', '2k sq ft'", () => {
    expect(prefill.extractPriceCents("6 mil vapor barrier under the slab"))
      .toBeNull();
    expect(prefill.extractPriceCents("install a 12k btu mini split"))
      .toBeNull();
    expect(prefill.extractPriceCents("repaint a 2k sq ft house")).toBeNull();
  });
});

describe("REQ-575 M13 extractPriceCents — stated costs add up; a rate is not an amount", () => {
  test("pair 7's '$65/hr = ~$23k labor alone, cabinets are $9.5k' is $32,500 (it read $97.50)", () => {
    expect(prefill.extractPriceCents(PAIR7_COSTS)).toBe(3_250_000);
  });
  test.each([
    "$65/hr",
    "labor at $65 an hour",
    "$40 a foot for cedar",
    "$40/ft",
    "tile at $5 per sq ft",
    "$3.50/sqft",
    "65 dólares la hora",
    "$45 por hora",
  ])("REQ-575 a rate alone is no price: '%s' → null", (text) => {
    expect(prefill.extractPriceCents(text)).toBeNull();
  });
  test("a rate beside a job amount: the job amount stands", () => {
    expect(prefill.extractPriceCents("fence $4,800 ($40 a foot), gate $650"))
      .toBe(545_000);
  });
});

describe("REQ-575 shared/quote-flow/money-amounts.ts — the reader moved out of the backend", () => {
  test("moneyAmounts reads every form, in order, each once, and marks rates", () => {
    expect(typeof money.moneyAmounts).toBe("function");
    const got = money.moneyAmounts(PAIR7_COSTS).map((
      a: { cents: number; rate: boolean },
    ) => [a.cents, a.rate]);
    expect(got).toEqual([[6_500, true], [2_300_000, false], [950_000, false]]);
  });
  test("the backend's stated-price reads money through the shared module", () => {
    const src = read("backend/src/agents/domain/business/stated-price/mod.ts");
    expect(src).toMatch(/from "#quote-flow\/money-amounts\.ts"/);
    expect(src).not.toMatch(/const MONEY_PATTERNS/);
  });
  test("quick-quote-prefill reads money through the shared module", () => {
    const src = read("shared/quote-flow/quick-quote-prefill.ts");
    expect(src).toMatch(/from "\.\/money-amounts\.ts"/);
  });
});

// ---------------------------------------------------------------------------
// Start date
// ---------------------------------------------------------------------------

describe("REQ-575 M3 extractStartDate — an explicit date after the weekday wins", () => {
  test("pair 7's 'we start monday nov 23…' is Nov 23 (the card said Nov 16)", () => {
    expect(
      facts.extractStartDate(
        "we start monday nov 23. and I want a 50% deposit upfront, rest when done. is 50% normal in texas?",
        TODAY,
      ),
    ).toEqual(day("2026-11-23"));
  });
  test.each([
    ["start Monday, November 30", "2026-11-30"],
    ["starting monday the 30th of november", "2026-11-30"],
    ["empezamos el lunes 23 de noviembre", "2026-11-23"],
    ["start monday 11/30", "2026-11-30"],
    ["empezamos el lunes 23", "2026-11-23"],
    ["start Monday the 23rd", "2026-11-23"],
  ])("REQ-575 '%s' → %s", (text, iso) => {
    expect(facts.extractStartDate(text, TODAY)).toEqual(day(iso));
  });
  test("a bare number after the weekday that is not that weekday's date stays the weekday", () => {
    expect(facts.extractStartDate("we start monday 3 guys", TODAY))
      .toEqual(day("2026-11-16"));
    expect(facts.extractStartDate("start Monday 8 am", TODAY))
      .toEqual(day("2026-11-16"));
    expect(facts.extractStartDate("empezar el lunes", TODAY))
      .toEqual(day("2026-11-16"));
  });
  test("a typed weekday the explicit date does not fall on is flagged, the date still wins", () => {
    const d = facts.extractStartDate("start monday nov 24", TODAY);
    expect(d.iso).toBe("2026-11-24");
    expect(d.weekdayMismatch).toBe(true);
    expect(facts.extractStartDate("start monday nov 23", TODAY).weekdayMismatch)
      .toBeFalsy();
  });
});

describe("REQ-575 M3 extractStartDate — relative starts", () => {
  test.each([
    ["oops no, empezamos la próxima semana, no el próximo mes", "next_week"],
    ["fix start to next week + 2.5 weeks", "next_week"],
    ["we start next week", "next_week"],
    ["empezamos la semana que viene", "next_week"],
    ["start next month", "next_month"],
    ["empezamos el mes que viene", "next_month"],
    ["we can start right away", "asap"],
    ["empezamos de inmediato", "asap"],
  ])("REQ-575 '%s' → the %s option", (text, preset) => {
    const d = facts.extractStartDate(text, TODAY);
    expect(d?.preset).toBe(preset);
    const f = facts.extractQuoteFacts(text, TODAY);
    expect(facts.wizardPrefillFor("start_date", f)).toEqual({
      optionId: preset,
    });
  });
  test("'start in 2 weeks' / 'empezamos en 3 días' are dates counted from today", () => {
    expect(facts.extractStartDate("start in 2 weeks", TODAY)).toEqual(
      day("2026-11-26"),
    );
    expect(facts.extractStartDate("empezamos en 3 días", TODAY)).toEqual(
      day("2026-11-15"),
    );
    const f = facts.extractQuoteFacts("start in 2 weeks", TODAY);
    expect(facts.wizardPrefillFor("start_date", f)).toEqual({
      optionId: "custom",
      customValue: "2026-11-26",
    });
  });
});

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

describe("REQ-575 M3 extractDuration — halves are kept", () => {
  test("pair 7's 'Dos semanas y media' is 2.5 weeks (the card said 2 weeks)", () => {
    expect(facts.extractDuration(PAIR7_Q2)).toEqual({ n: 2.5, unit: "weeks" });
  });
  test.each([
    ["two and a half weeks", 2.5, "weeks"],
    ["2 and a half weeks", 2.5, "weeks"],
    ["about 2.5 weeks", 2.5, "weeks"],
    ["unas 2,5 semanas", 2.5, "weeks"],
    ["2½ weeks", 2.5, "weeks"],
    ["a week and a half", 1.5, "weeks"],
    ["una semana y media", 1.5, "weeks"],
    ["un mes y medio", 1.5, "months"],
    ["3 días y medio", 3.5, "days"],
    ["dos semanas", 2, "weeks"],
    ["Thinking 4 weeks", 4, "weeks"],
  ])("REQ-575 '%s' → %d %s", (text, n, unit) => {
    expect(facts.extractDuration(text)).toEqual({ n, unit });
  });
  test("the wraps step offers the half in the wizard's language", () => {
    const f = facts.extractQuoteFacts(PAIR7_Q2, TODAY);
    expect(facts.wizardPrefillFor("wraps", f, "es")).toEqual({
      optionId: "custom",
      customValue: "2.5 semanas",
    });
    expect(facts.wizardPrefillFor("wraps", f, "en")).toEqual({
      optionId: "custom",
      customValue: "2.5 weeks",
    });
  });
  test("the custom picker (whole numbers only, REQ-390) opens on the same length in a whole unit", () => {
    expect(durationInput.wholeDuration({ n: 2.5, unit: "weeks" })).toEqual({
      n: 18,
      unit: "days",
    });
    expect(durationInput.wholeDuration({ n: 1.5, unit: "months" })).toEqual({
      n: 45,
      unit: "days",
    });
    expect(durationInput.wholeDuration({ n: 3.5, unit: "days" })).toEqual({
      n: 4,
      unit: "days",
    });
    expect(durationInput.wholeDuration({ n: 4, unit: "weeks" })).toEqual({
      n: 4,
      unit: "weeks",
    });
    const chat = read("front-end/islands/AsstChat.tsx");
    expect(chat).toMatch(
      /<CustomDurationPickerForm[\s\S]{0,300}initial=\{quoteFacts\.duration &&\s*wholeDuration\(quoteFacts\.duration\)\}/,
    );
  });
  test("a half-week term schedules the bill on the right day: 2.5 weeks from Nov 12 is Nov 30", () => {
    expect(
      completion.completionFromTerms({
        terms: [
          { stepId: "start_date", value: "2026-11-12" },
          { stepId: "wraps", value: "2.5 semanas" },
        ],
        today: new Date("2026-11-12T15:00:00Z"),
      }),
    ).toBe("2026-11-30");
  });
});

// ---------------------------------------------------------------------------
// Customer name
// ---------------------------------------------------------------------------

describe("REQ-575 M3 extractCustomerName — 'cliente <Name>' and 'la señora <Name>' with no 'para'", () => {
  test("pair 9's 'Sacar muebles viejos de un garaje, 450 dólares, cliente Juan Pérez 5125550199' → Juan Pérez", () => {
    expect(
      prefill.extractCustomerName(
        "Sacar muebles viejos de un garaje, 450 dólares, cliente Juan Pérez 5125550199",
      ),
    ).toBe("Juan Pérez");
  });
  test("pair 7's Q-002 'Baño principal de la señora Tran…' → Tran", () => {
    expect(prefill.extractCustomerName(PAIR7_Q2)).toBe("Tran");
  });
  test.each([
    ["client: Mary Jones, 512-555-0101, gutter cleaning", "Mary Jones"],
    ["Customer is Bob Smith, install 3 outlets", "Bob Smith"],
    ["clienta Ana López, pintar la sala", "Ana López"],
    ["Mrs. Henderson's deck needs new boards", "Henderson"],
    ["Mr. Okafor, bathroom remodel", "Okafor"],
    ["Sra. Nguyen quiere un patio nuevo", "Nguyen"],
  ])("REQ-575 '%s' → %s", (text, name) => {
    expect(prefill.extractCustomerName(text)).toBe(name);
  });
  test.each([
    "El cliente quiere pintar la sala",
    "the customer wants 6 recessed lights",
    "la señora quiere 5 luces LED debajo de los gabinetes",
    "deck at 1800 Barton Hills Dr Austin",
    "Don't forget the gate latch",
  ])("REQ-575 no name in '%s'", (text) => {
    expect(prefill.extractCustomerName(text)).toBeNull();
  });
});

describe("REQ-575 M3 a household lead-in gives way to the full name (plural-tolerant)", () => {
  test("pair 7's 'Kitchen gut for the Hendersons. Carol Henderson, …' → Carol Henderson", () => {
    expect(
      prefill.extractCustomerName(
        "Kitchen gut for the Hendersons. Carol Henderson, 512-555-0188, Ridgewood Dr Austin",
      ),
    ).toBe("Carol Henderson");
    expect(
      prefill.extractCustomerName(
        "fence for the Joneses — Mary Jones 512-555-0101",
      ),
    ).toBe("Mary Jones");
  });
  test("with no full name typed, the household stays", () => {
    expect(
      prefill.extractCustomerName("fence for the Hendersons, 512-555-0199"),
    ).toBe("Hendersons");
  });
});

describe("REQ-575 M3 the facts read the user's own turns before the quote description", () => {
  test("factsSourceText puts what the user typed first", () => {
    expect(
      facts.factsSourceText("Kitchen for Bob", [
        "cotización para Roberto Gómez, cocina",
        "",
      ]),
    ).toBe("cotización para Roberto Gómez, cocina\nKitchen for Bob");
    const f = facts.extractQuoteFacts(
      facts.factsSourceText("Kitchen for Bob", [
        "cotización para Roberto Gómez, cocina",
      ]),
      TODAY,
    );
    expect(f.customerName).toBe("Roberto Gómez");
  });
  test("AsstChat's quoteFactsSource goes through it", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    const fn = chat.slice(chat.indexOf("function quoteFactsSource("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/factsSourceText\(\s*quoteDescription/);
    expect(body).toMatch(/role === "user"/);
  });
});

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

describe("REQ-575 M3 a typed phone that is not a usable number is named, never dropped silently", () => {
  test.each([
    ["Install 3 outlets for Bob Smith, phone 555, $-200", "555"],
    ["tel: 555-0123", "555-0123"],
    ["su teléfono es 512 555", "512 555"],
    ["cell 51255501", "51255501"],
    ["his number is 555", "555"],
  ])("REQ-575 '%s' → %s", (text, bad) => {
    expect(facts.extractUnusablePhone(text)).toBe(bad);
    const f = facts.extractQuoteFacts(text, TODAY);
    expect(f.customerPhone).toBeNull();
    expect(f.unusablePhone).toBe(bad);
  });
  test.each([
    "phone 512-555-0199",
    "Bob (512) 555-0199",
    "3 outlets at 555 Main St",
    "phone repair, screen cracked",
  ])("REQ-575 nothing to name in '%s'", (text) => {
    expect(facts.extractUnusablePhone(text)).toBeNull();
    expect(facts.extractQuoteFacts(text, TODAY)).not.toHaveProperty(
      "unusablePhone",
    );
  });
  test("the customer form says so under the phone box, in both languages", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    const panel = chat.slice(chat.indexOf("function CustomerStepPanel("));
    expect(panel).toMatch(/prefillFacts\?\.unusablePhone/);
    expect(panel).toMatch(/data-cy="cust-phone-unusable"/);
    expect(panel).toMatch(/"asstChat\.customerStep\.phoneUnusable"/);
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const k = "asstChat.customerStep.phoneUnusable";
    expect(en[k]).toMatch(/\{phone\}/);
    expect(es[k]).toMatch(/\{phone\}/);
    expect(en[k]).not.toBe(es[k]);
  });
});

describe("REQ-575 M3 the start-date pre-selection names a weekday the date does not fall on", () => {
  test("weekdayLabel names the day a date falls on, in the wizard's language", () => {
    expect(facts.weekdayLabel("2026-11-24", "en")).toBe("Tuesday");
    expect(facts.weekdayLabel("2026-11-24", "es")).toBe("martes");
    expect(facts.weekdayLabel("2026-11-23", "en")).toBe("Monday");
  });
  test("the prefill row shows the note, in both languages", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    expect(chat).toMatch(/weekdayMismatch/);
    expect(chat).toMatch(/data-testid="wiz-prefill-weekday"/);
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const k = "asstChat.wiz.weekdayMismatch";
    expect(en[k]).toMatch(/\{weekday\}/);
    expect(es[k]).toMatch(/\{weekday\}/);
    expect(en[k]).not.toBe(es[k]);
  });
});
