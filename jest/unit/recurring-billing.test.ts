/**
 * REQ-699 — demo-loop cycle 5, issue M20: "No monthly/recurring billing in
 * the quote flow; Subscriptions not linked to quotes".
 *
 * Pair 2 typed "Cotización para María López, 305-555-0144, corte de césped y
 * poda de setos, 4 visitas al mes, $180 al mes". The payment step had no
 * monthly option ("¿y cobro MENSUAL? No hay opción de mensual", fleet-1
 * stdout:406), the signature billed a one-time $180, and Campo → Suscripciones
 * said "0 ACTIVAS" (fleet-1 stdout:433).
 *
 * RCA (analyst FEATURE_GAP, skeptic UPHELD, at demo-fixes 2444608a): the
 * wizard's payment step (shared/quote-flow/wizard-terms.ts) only knew one-off
 * schedules; nothing outside backend/src/field used SubscriptionStore; the
 * money reader knew "$120 a month" was a recurring price but nothing acted on
 * it.
 *
 * This file pins the shared, dependency-free half: the recurring term (its
 * English base, its reading back, its en/es text), the money reader's `per`
 * flag, the quote-facts prefill that turns pair 2's words into the ask, the
 * wizard option, the money split that must never read a recurring term as a
 * percentage split, the copy, and the island / document / Field wiring.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const DICTS: Record<string, Record<string, string>> = {
  en: JSON.parse(read("lang/en.json")),
  es: JSON.parse(read("lang/es.json")),
};
/** The dictionaries' own lookup (tFor / backend t semantics). */
const t = (
  lang: string,
  key: string,
  vars?: Record<string, string | number>,
) =>
  (DICTS[lang]?.[key] ?? DICTS.en[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_m, k) => (vars && k in vars ? String(vars[k]) : `{${k}}`),
  );

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rec: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let money: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let facts: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wizard: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let split: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let termI18n: any;
beforeAll(() => {
  try {
    rec = require("../../shared/quote-flow/recurring-billing");
  } catch {
    rec = {};
  }
  money = require("../../shared/quote-flow/money-amounts");
  facts = require("../../shared/quote-flow/quote-facts");
  wizard = require("../../shared/quote-flow/wizard-terms");
  split = require("../../front-end/lib/payment-split");
  termI18n = require("../../front-end/lib/term-i18n");
});

/** Pair 2's job sentence, verbatim (fleet-1 stdout:395). */
const PAIR2 =
  "Cotización para María López, 305-555-0144, corte de césped y poda de setos, 4 visitas al mes, $180 al mes";
/** 2026-11-12 — the day cycle 5's demo ran. */
const TODAY = new Date(2026, 10, 12);

// ---------------------------------------------------------------------------
// The recurring term
// ---------------------------------------------------------------------------

describe("REQ-699 M20 the recurring term — one English base, read back, localized", () => {
  test("recurringTermValue writes the English base the quote stores", () => {
    expect(
      rec.recurringTermValue?.({ cadence: "monthly", amountCents: 18_000 }),
    )
      .toBe("Monthly · $180/mo");
    expect(rec.recurringTermValue({ cadence: "weekly", amountCents: 4_500 }))
      .toBe("Weekly · $45/wk");
    expect(rec.recurringTermValue({ cadence: "biweekly", amountCents: 9_000 }))
      .toBe("Every 2 weeks · $90/2 wks");
    expect(rec.recurringTermValue({ cadence: "monthly", amountCents: 18_050 }))
      .toBe("Monthly · $180.50/mo");
    expect(rec.recurringTermValue({ cadence: "monthly", amountCents: 120_000 }))
      .toBe("Monthly · $1,200/mo");
    expect(
      rec.recurringTermValue({
        cadence: "monthly",
        amountCents: 18_000,
        endDate: "2027-06-30",
      }),
    ).toBe("Monthly · $180/mo · until 2027-06-30");
  });

  test("parseRecurringTerm reads the base back — and the Spanish text, and a typed date", () => {
    expect(rec.parseRecurringTerm?.("Monthly · $180/mo")).toEqual({
      cadence: "monthly",
      amountCents: 18_000,
    });
    expect(rec.parseRecurringTerm("Monthly · $180/mo · until 2027-06-30"))
      .toEqual({
        cadence: "monthly",
        amountCents: 18_000,
        endDate: "2027-06-30",
      });
    expect(rec.parseRecurringTerm("Weekly · $1,098/wk")).toEqual({
      cadence: "weekly",
      amountCents: 109_800,
    });
    expect(rec.parseRecurringTerm("Every 2 weeks · $90/2 wks")).toEqual({
      cadence: "biweekly",
      amountCents: 9_000,
    });
    expect(rec.parseRecurringTerm("Mensual · $180/mes")).toEqual({
      cadence: "monthly",
      amountCents: 18_000,
    });
    expect(rec.parseRecurringTerm("Cada 2 semanas · $90/2 semanas")).toEqual({
      cadence: "biweekly",
      amountCents: 9_000,
    });
    expect(
      rec.parseRecurringTerm("Mensual · $180/mes · hasta el 30 jun 2027"),
    ).toEqual({
      cadence: "monthly",
      amountCents: 18_000,
      endDate: "2027-06-30",
    });
    expect(rec.parseRecurringTerm("Monthly · $180/mo · until Jun 30, 2027"))
      .toEqual({
        cadence: "monthly",
        amountCents: 18_000,
        endDate: "2027-06-30",
      });
  });

  test.each([
    "Net 15",
    "50/50",
    "30 / 30 / 40",
    "Due Now",
    "Payment upon completion",
    "Deposit + balance",
    "Monthly progress payments",
    "30% deposit / 40% at cabinets install / 30% at completion",
    "Monthly · $0/mo",
    "",
  ])("parseRecurringTerm(%p) is not a recurring term", (v) => {
    expect(rec.parseRecurringTerm?.(v)).toBeNull();
  });

  test("recurringTermText reads it in the reader's language", () => {
    const monthly = { cadence: "monthly", amountCents: 18_000 };
    expect(rec.recurringTermText?.(monthly, "en")).toBe("Monthly · $180/mo");
    expect(rec.recurringTermText(monthly, "es")).toBe("Mensual · $180/mes");
    expect(
      rec.recurringTermText({ cadence: "weekly", amountCents: 4_500 }, "es"),
    )
      .toBe("Semanal · $45/semana");
    expect(
      rec.recurringTermText({ cadence: "biweekly", amountCents: 9_000 }, "es"),
    ).toBe("Cada 2 semanas · $90/2 semanas");
    const ending = { ...monthly, endDate: "2027-06-30" };
    expect(rec.recurringTermText(ending, "en")).toBe(
      "Monthly · $180/mo · until Jun 30, 2027",
    );
    expect(rec.recurringTermText(ending, "es")).toBe(
      "Mensual · $180/mes · hasta el 30 jun 2027",
    );
  });

  test("localizeRecurringTerm: the stored value in a language; null for anything else", () => {
    expect(rec.localizeRecurringTerm?.("Monthly · $180/mo", "es")).toBe(
      "Mensual · $180/mes",
    );
    expect(rec.localizeRecurringTerm("Net 15", "es")).toBeNull();
    expect(rec.localizeRecurringTerm("2026-12-01", "en")).toBeNull();
  });

  test("recurringFromTerms reads the payment row of the quote's terms only", () => {
    expect(
      rec.recurringFromTerms?.([
        { stepId: "start_date", label: "Start", value: "Next week" },
        {
          stepId: "payment_terms",
          label: "Payment",
          value: "Monthly · $180/mo",
        },
      ]),
    ).toEqual({ cadence: "monthly", amountCents: 18_000 });
    expect(
      rec.recurringFromTerms([
        { stepId: "warranty", label: "Warranty", value: "Monthly · $180/mo" },
        { stepId: "payment_terms", label: "Payment", value: "50/50" },
      ]),
    ).toBeNull();
    expect(rec.recurringFromTerms(undefined)).toBeNull();
  });

  test("recurringScheduleRow: the agreement's payment schedule row", () => {
    const monthly = { cadence: "monthly", amountCents: 18_000 };
    expect(rec.recurringScheduleRow?.(monthly, "en")).toEqual({
      label: "Monthly",
      amount: 18_000,
      when: "Billed every month",
    });
    expect(
      rec.recurringScheduleRow({ ...monthly, endDate: "2027-06-30" }, "es"),
    ).toEqual({
      label: "Mensual",
      amount: 18_000,
      when: "Se cobra cada mes · hasta el 30 jun 2027",
    });
  });

  test("recurringAmountCents: the amount typed in the form", () => {
    expect(rec.recurringAmountCents?.("180")).toBe(18_000);
    expect(rec.recurringAmountCents("$180.50")).toBe(18_050);
    expect(rec.recurringAmountCents("1,200")).toBe(120_000);
    for (const bad of ["", "0", "abc", "-5", "1.234", "100001"]) {
      expect(rec.recurringAmountCents(bad)).toBeNull();
    }
  });

  test("recurringCadenceName: the form's chips read like the term they write", () => {
    expect(
      ["weekly", "biweekly", "monthly"].map((c) =>
        rec.recurringCadenceName?.(c, "en")
      ),
    ).toEqual(["Weekly", "Every 2 weeks", "Monthly"]);
    expect(
      ["weekly", "biweekly", "monthly"].map((c) =>
        rec.recurringCadenceName?.(c, "es")
      ),
    ).toEqual(["Semanal", "Cada 2 semanas", "Mensual"]);
    // the term opens with the same words
    expect(
      rec.recurringTermText(
        { cadence: "biweekly", amountCents: 9_000 },
        "es",
      ).startsWith(rec.recurringCadenceName?.("biweekly", "es")),
    ).toBe(true);
  });

  test("recurringPriceText: the price as the ask says it back", () => {
    expect(
      rec.recurringPriceText?.(
        { cadence: "monthly", amountCents: 18_000 },
        "es",
      ),
    ).toBe("$180 al mes");
    expect(
      rec.recurringPriceText({ cadence: "monthly", amountCents: 18_000 }, "en"),
    ).toBe("$180 a month");
    expect(
      rec.recurringPriceText({ cadence: "weekly", amountCents: 4_500 }, "en"),
    )
      .toBe("$45 a week");
    expect(
      rec.recurringPriceText({ cadence: "biweekly", amountCents: 9_000 }, "es"),
    ).toBe("$90 cada 2 semanas");
    expect(rec.recurringPriceText({ amountCents: 4_500 }, "en")).toBe(
      "$45 per visit",
    );
    expect(rec.recurringPriceText({ amountCents: 4_500 }, "es")).toBe(
      "$45 por visita",
    );
  });
});

// ---------------------------------------------------------------------------
// The money reader flags a price stated per period
// ---------------------------------------------------------------------------

describe("REQ-699 M20 moneyAmounts flags a price stated per period (`per`)", () => {
  test.each([
    ["$180 al mes", "monthly"],
    ["$180 a month", "monthly"],
    ["$180 per month", "monthly"],
    ["$180/mo", "monthly"],
    ["$180 monthly", "monthly"],
    ["$180 mensuales", "monthly"],
    ["$180 cada mes", "monthly"],
    ["$45 a week", "weekly"],
    ["$45/wk", "weekly"],
    ["$45 por semana", "weekly"],
    ["$45 a la semana", "weekly"],
    ["$45 semanal", "weekly"],
    ["$90 every 2 weeks", "biweekly"],
    ["$90 every other week", "biweekly"],
    ["$90 cada dos semanas", "biweekly"],
    ["$90 quincenal", "biweekly"],
    ["$90 biweekly", "biweekly"],
    ["$45 per visit", "visit"],
    ["$45 por visita", "visit"],
    ["$45 each visit", "visit"],
  ])("%p → per %p", (text, per) => {
    const [a] = money.moneyAmounts(text);
    expect(a?.per).toBe(per);
    expect(a?.rate).toBe(false);
  });

  test("a rate keeps its flag and no period; a bare price has neither", () => {
    expect(money.moneyAmounts("$65/hr")[0]).toMatchObject({ rate: true });
    expect(money.moneyAmounts("$65/hr")[0].per).toBeUndefined();
    expect(money.moneyAmounts("$4,500 for the deck")[0].per).toBeUndefined();
    expect(money.moneyAmounts("18 mil dólares")[0].per).toBeUndefined();
  });

  test("pair 2's sentence: one amount, $180, per month — '4 visitas' is no money", () => {
    const found = money.moneyAmounts(PAIR2);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      cents: 18_000,
      per: "monthly",
      rate: false,
    });
  });
});

// ---------------------------------------------------------------------------
// quote-facts: the message's monthly price becomes the payment step's ask
// ---------------------------------------------------------------------------

describe("REQ-699 M20 quote-facts — a price stated per period is a recurring prefill", () => {
  test("pair 2: '$180 al mes' → monthly $180, one tap posts the recurring option", () => {
    const f = facts.extractQuoteFacts(PAIR2, TODAY);
    expect(f.paymentTerms).toEqual({
      kind: "recurring",
      cadence: "monthly",
      amountCents: 18_000,
    });
    for (const lang of ["en", "es"]) {
      expect(facts.wizardPrefillFor("payment_terms", f, lang)).toEqual({
        optionId: "recurring",
        // the stored English base, whatever the UI language
        customValue: "Monthly · $180/mo",
        recurring: { cadence: "monthly", amountCents: 18_000 },
      });
    }
  });

  test("a per-visit price takes its cadence from the frequency the text states", () => {
    expect(
      facts.extractPaymentTerms("Lawn mowing at $45 per visit, every week"),
    ).toEqual({ kind: "recurring", cadence: "weekly", amountCents: 4_500 });
    expect(
      facts.extractPaymentTerms(
        "corte de césped, $45 por visita, cada dos semanas",
      ),
    ).toEqual({ kind: "recurring", cadence: "biweekly", amountCents: 4_500 });
    expect(
      facts.extractPaymentTerms("limpieza $120 por visita, 4 visitas al mes"),
    ).toEqual({ kind: "recurring", cadence: "weekly", amountCents: 12_000 });
  });

  test("a per-visit price with no frequency asks — the prefill opens the form, nothing invented", () => {
    const f = facts.extractQuoteFacts(
      "Lawn mowing for Bob, $45 per visit",
      TODAY,
    );
    expect(f.paymentTerms).toEqual({ kind: "recurring", amountCents: 4_500 });
    expect(facts.wizardPrefillFor("payment_terms", f, "en")).toEqual({
      optionId: "recurring",
      recurring: { amountCents: 4_500 },
    });
  });

  test("a stated split still wins, and a one-off price is not recurring", () => {
    expect(facts.extractPaymentTerms("half deposit, $180 a month")).toBe(
      "50_50",
    );
    expect(facts.extractPaymentTerms("Deck for Ana, $4,500")).toBeNull();
    expect(facts.extractPaymentTerms("$65/hr labor")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The wizard's payment step
// ---------------------------------------------------------------------------

describe("REQ-699 M20 the payment step offers Recurring (quote wizards only)", () => {
  const payment = (spec: { steps: { id: string; options: unknown[] }[] }) =>
    spec.steps.find((s) => s.id === "payment_terms") as {
      options: {
        id: string;
        isCustom?: boolean;
        label: string;
        sub?: string;
      }[];
    };

  test("the quote wizard: Recurring is a custom option right before Custom", () => {
    const opts = payment(wizard.TERMS_WIZARD_V1).options;
    expect(opts.map((o) => o.id)).toEqual([
      "due_now",
      "net_15",
      "50_50",
      "30_30_40",
      "deposit_bal",
      "recurring",
      "custom",
    ]);
    const r = opts.find((o) => o.id === "recurring")!;
    expect(r.isCustom).toBe(true);
    expect(rec.RECURRING_OPTION_ID).toBe("recurring");
    expect(t("en", r.label)).toBe("Recurring");
    expect(t("es", r.label)).toBe("Recurrente");
    expect(r.sub && DICTS.en[r.sub] && DICTS.es[r.sub]).toBeTruthy();
  });

  test("the service wizard shares the step; the invoice wizard bills done work once — no Recurring", () => {
    expect(payment(wizard.TERMS_WIZARD_SERVICE_V1)).toBe(
      payment(wizard.TERMS_WIZARD_V1),
    );
    const inv = payment(wizard.INVOICE_WIZARD_V1).options.map((o) => o.id);
    expect(inv).toEqual([
      "due_now",
      "net_15",
      "50_50",
      "30_30_40",
      "deposit_bal",
      "custom",
    ]);
  });

  test("termFromPick stores the canonical English base — and drops a value that is no schedule", () => {
    const pick = (customValue: string) =>
      wizard.termFromPick(
        { stepId: "payment_terms", optionId: "recurring", customValue },
        t,
      );
    expect(pick("Monthly · $180/mo")).toEqual({
      stepId: "payment_terms",
      label: "Payment",
      value: "Monthly · $180/mo",
    });
    expect(pick("Mensual · $180/mes · hasta el 30 jun 2027")?.value).toBe(
      "Monthly · $180/mo · until 2027-06-30",
    );
    expect(pick("every so often")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The agreement: never a one-off split, the row in the reader's language
// ---------------------------------------------------------------------------

describe("REQ-699 M20 the agreement reads a recurring term as one", () => {
  test("computePaymentSplit never reads a recurring term as a percentage split", () => {
    // "$1,098/2 wks" splits on "," and "/" into 98 and 2 — a 98/2 split
    expect(split.computePaymentSplit("Every 2 weeks · $1,098/2 wks", 109_800))
      .toEqual([{ role: "full", pct: 100, amountCents: 109_800 }]);
    expect(split.computePaymentSplit("Monthly · $180/mo", 18_000)).toEqual([
      { role: "full", pct: 100, amountCents: 18_000 },
    ]);
    // the one-off terms are untouched
    expect(split.computePaymentSplit("50/50", 18_000)).toHaveLength(2);
  });

  test("localizeTermValue: the payment row in the reader's language (dates too)", () => {
    expect(termI18n.localizeTermValue("Monthly · $180/mo", "es")).toBe(
      "Mensual · $180/mes",
    );
    expect(
      termI18n.localizeTermValue("Monthly · $180/mo · until 2027-06-30", "en"),
    ).toBe("Monthly · $180/mo · until Jun 30, 2027");
    expect(
      termI18n.localizeTermValue(
        "Every 2 weeks · $90/2 wks · until 2027-06-30",
        "es",
      ),
    ).toBe("Cada 2 semanas · $90/2 semanas · hasta el 30 jun 2027");
    // the other terms are untouched
    expect(termI18n.localizeTermValue("Next week", "es")).toBe(
      t("es", "quoteDoc.termValue.nextWeek"),
    );
  });
});

// ---------------------------------------------------------------------------
// The copy — en and es in sync
// ---------------------------------------------------------------------------

const KEYS = [
  "termsWizard.paymentTerms.recurring.label",
  "termsWizard.paymentTerms.recurring.sub",
  "asstChat.recurring.ask",
  "asstChat.recurring.every.weekly",
  "asstChat.recurring.every.biweekly",
  "asstChat.recurring.every.monthly",
  "asstChat.recurring.every.schedule",
  "asstChat.recurring.bill",
  "asstChat.recurring.cadence",
  "asstChat.recurring.amount",
  "asstChat.recurring.end",
  "asstChat.recurring.note",
  "asstChat.recurring.use",
  "field.subs.fromQuote",
  "signedConfirm.email.bodyRecurringClause",
  "acceptQuote.signed.recurring",
];

describe("REQ-699 M20 the copy, en and es", () => {
  test.each(KEYS)("%s exists in en and es, translated", (key) => {
    expect(typeof DICTS.en[key]).toBe("string");
    expect(typeof DICTS.es[key]).toBe("string");
    expect(DICTS.en[key].trim()).not.toBe("");
    expect(DICTS.es[key]).not.toBe(DICTS.en[key]);
    // same placeholders on both sides
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    expect(vars(DICTS.es[key])).toEqual(vars(DICTS.en[key]));
  });

  test("pair 2's ask reads in Spanish: '$180 al mes' — once, or every month?", () => {
    const ask = (lang: "en" | "es") =>
      t(lang, "asstChat.recurring.ask", {
        price: rec.recurringPriceText?.(
          { cadence: "monthly", amountCents: 18_000 },
          lang,
        ),
        every: t(lang, "asstChat.recurring.every.monthly"),
      });
    expect(ask("es")).toBe(
      "Dijiste $180 al mes. ¿Lo cobras una sola vez o cada mes?",
    );
    expect(ask("en")).toBe(
      "You said $180 a month. Bill it once, or every month?",
    );
  });
});

// ---------------------------------------------------------------------------
// Wiring — the island, the form, the documents, Field and the customer card
// ---------------------------------------------------------------------------

describe("REQ-699 M20 wiring", () => {
  const FORM = "front-end/components/RecurringPaymentForm.tsx";

  test("the chat island routes the Recurring option to its form and asks from the message", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /import RecurringPaymentForm from "\.\.\/components\/RecurringPaymentForm\.tsx"/,
    );
    expect(src).toMatch(
      /opt\.id === RECURRING_OPTION_ID[\s\S]{0,200}setRecurringPick\(/,
    );
    expect(src).toMatch(
      /<RecurringPaymentForm[\s\S]{0,1500}customValue: value/,
    );
    expect(src).toContain('"asstChat.recurring.ask"');
    expect(src).toContain('"asstChat.recurring.bill"');
  });

  test("the form submits the English base, from the cadence chips, the amount and an optional end", () => {
    expect(exists(FORM)).toBe(true);
    const src = exists(FORM) ? read(FORM) : "";
    expect(src).toContain("recurringTermValue(");
    // the chips say what the preview and the agreement say ("Every 2 weeks",
    // not the Field page's "Every two weeks")
    expect(src).toContain("recurringCadenceName(");
    expect(src).not.toMatch(/field\.subs\.(?:weekly|biweekly|monthly)/);
    expect(src).toContain('"asstChat.recurring.end"');
    expect(src).toContain('"asstChat.recurring.note"');
    expect(src).toMatch(/type="date"/);
  });

  test("the agreement, the PDF and the term localizers read the recurring term", () => {
    expect(read("front-end/components/doc-parts.tsx")).toContain(
      "recurringScheduleRow(",
    );
    const pdf = read(
      "backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts",
    );
    expect(pdf).toContain("recurringScheduleRow(");
    expect(pdf).toContain("localizeRecurringTerm(");
    expect(
      read(
        "backend/src/paperwork/domain/coordinators/render-invoice-pdf/mod.ts",
      ),
    ).toContain("localizeRecurringTerm(");
  });

  test("Field → Subscriptions and the customer card show the quote's billing", () => {
    const subs = read("front-end/islands/FieldSubscriptionsPage.tsx");
    expect(subs).toMatch(/s\.billing/);
    expect(subs).toContain('"field.subs.fromQuote"');
    expect(subs).toMatch(/\/quotes\?open=\$\{s\.quoteId\}/);
    expect(read("front-end/islands/ClientsBoard.tsx")).toMatch(/s\.billing/);
    expect(read("front-end/clients/field.ts")).toMatch(
      /billing\?: \{ es: string; en: string \}/,
    );
  });
});
