/**
 * REQ-483 — demo-loop cycle 3, issues M40 + m18.
 *
 *   M40: "Onboarding's Zelle payment method not prefilled into New invoice
 *        'Payment instructions'" — NewInvoiceModal seeded the field from
 *        localStorage and contractDefaults.paymentInstructions only; the
 *        methods onboarding saves (identity.acceptedPaymentMethods) were
 *        never read, so the field came up empty.
 *   m18: "New invoice defaults to Net 30 ignoring settings and the quote" —
 *        `useState<number>(30)`; Settings' "Days to pay an invoice"
 *        (identity.invoiceNetDays) and the quote's payment terms were ignored.
 *        The "upon completion" sub-line also read as a contradiction.
 *
 * Pure helpers live in shared/documents/invoice-form.ts; the island wires them.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/invoice-form");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const ONBOARDED = {
  zelle: { enabled: true, handle: "5125550102" },
  cash: { enabled: true },
  venmo: { enabled: false, handle: "@nope" },
};

describe("REQ-483 M40 payment instructions from the accepted methods", () => {
  it("REQ-483 M40 the onboarding methods become 'Zelle: +1 (512) 555-0102 · Cash' (REQ-593 formats the number)", () => {
    const { paymentInstructionsFromMethods } = mod();
    expect(paymentInstructionsFromMethods(ONBOARDED, "en")).toBe(
      "Zelle: +1 (512) 555-0102 · Cash",
    );
    expect(paymentInstructionsFromMethods(ONBOARDED, "es")).toBe(
      "Zelle: +1 (512) 555-0102 · Efectivo",
    );
  });

  it("REQ-483 M40 every enabled method with its handle, disabled and blank ones left out", () => {
    const { paymentInstructionsFromMethods } = mod();
    expect(paymentInstructionsFromMethods({
      check: { enabled: true, mailTo: "1 Main St, Austin TX" },
      venmo: { enabled: true, handle: "@hans" },
      cashapp: { enabled: true, cashtag: "$hans" },
      paypal: { enabled: true, handle: "  " },
      ach: { enabled: true, routingNumber: "111", instructions: "Email me" },
      card: { enabled: false, instructions: "x" },
      other: { enabled: true, instructions: "Call me to arrange" },
    }, "en")).toBe(
      "Check: 1 Main St, Austin TX · Venmo: @hans · Cash App: $hans · PayPal · Bank transfer: Email me · Call me to arrange",
    );
    expect(paymentInstructionsFromMethods(undefined, "en")).toBe("");
    expect(paymentInstructionsFromMethods({}, "en")).toBe("");
    expect(paymentInstructionsFromMethods(null, "en")).toBe("");
  });

  it("REQ-483 M40 precedence: Settings' text, else the last typed, else the methods", () => {
    const { defaultPaymentInstructions } = mod();
    expect(defaultPaymentInstructions({
      settings: "",
      remembered: null,
      methods: ONBOARDED,
      lang: "en",
    })).toBe("Zelle: +1 (512) 555-0102 · Cash");
    expect(defaultPaymentInstructions({
      settings: "  Pay by check  ",
      remembered: "old",
      methods: ONBOARDED,
      lang: "en",
    })).toBe("  Pay by check  ");
    expect(defaultPaymentInstructions({
      settings: undefined,
      remembered: "Zelle me at 512",
      methods: ONBOARDED,
      lang: "en",
    })).toBe("Zelle me at 512");
    expect(defaultPaymentInstructions({ lang: "en" })).toBe("");
  });
});

describe("REQ-483 m18 the New invoice terms follow Settings and the quote", () => {
  const terms = (value: string) => [
    { stepId: "start_date", value: "Next week" },
    { stepId: "payment_terms", value },
  ];

  it("REQ-483 m18 with no quote: the account's days to pay (Settings), else 30", () => {
    const { defaultInvoiceNetDays } = mod();
    expect(defaultInvoiceNetDays(15, null)).toBe(15);
    expect(defaultInvoiceNetDays(7, undefined)).toBe(7);
    expect(defaultInvoiceNetDays(0, [])).toBe(0);
    expect(defaultInvoiceNetDays(undefined, null)).toBe(30);
    expect(defaultInvoiceNetDays(null, null)).toBe(30);
  });

  it("REQ-483 m18 from a quote: Due now → 0, Net N → N, upon completion → the account's days", () => {
    const { defaultInvoiceNetDays } = mod();
    expect(defaultInvoiceNetDays(30, terms("Due Now"))).toBe(0);
    expect(defaultInvoiceNetDays(30, terms("Net 15"))).toBe(15);
    expect(defaultInvoiceNetDays(30, terms("net-7"))).toBe(7);
    expect(defaultInvoiceNetDays(21, terms("Payment upon completion"))).toBe(
      21,
    );
    expect(defaultInvoiceNetDays(undefined, terms("Payment upon completion")))
      .toBe(30);
    // splits and free text are not a single due date — the account's days
    expect(defaultInvoiceNetDays(15, terms("50 / 50"))).toBe(15);
    expect(defaultInvoiceNetDays(15, terms("haggle in person"))).toBe(15);
    expect(defaultInvoiceNetDays(15, [{ stepId: "start_date", value: "x" }]))
      .toBe(15);
  });

  it("REQ-483 m18 a day count the picker has no preset for opens as custom terms", () => {
    const { isPresetNetDays } = mod();
    for (const n of [0, 7, 15, 30]) expect(isPresetNetDays(n)).toBe(true);
    for (const n of [21, 45, 60]) expect(isPresetNetDays(n)).toBe(false);
  });

  it("REQ-483 m18 the 'upon completion' sub-line says the bill goes out when the job is done and the customer then has {n} days (en + es)", () => {
    for (
      const k of [
        "termsWizard.paymentTerms.net15.sub",
        "asstChat.terms.payment.onCompletionSub",
      ]
    ) {
      expect(en[k]).toMatch(/when the job is done/i);
      expect(en[k]).toMatch(/\{n\} days to pay/);
      expect(en[k]).not.toMatch(/within \{n\} days of the job's completion/);
      expect(es[k]).toMatch(/al terminar el trabajo/i);
      expect(es[k]).toMatch(/\{n\} días para pagar/);
    }
  });
});

describe("REQ-483 the New invoice modal wires the defaults", () => {
  const src = read("front-end/islands/InvoicesPage.tsx");
  const modal = src.slice(
    src.indexOf("function NewInvoiceModal("),
    src.indexOf(
      "function pickCustomer(",
      src.indexOf("function NewInvoiceModal("),
    ),
  );

  it("REQ-483 m18 no hard-coded Net 30; the days come from defaultInvoiceNetDays(identity.invoiceNetDays, quote terms)", () => {
    expect(modal).not.toMatch(/useState<number>\(30\)/);
    expect(modal).not.toMatch(/dueDateFrom\(today, 30\)/);
    expect(modal).toMatch(/defaultInvoiceNetDays\(/);
    expect(modal).toMatch(/invoiceNetDays/);
    expect(modal).toMatch(/\.terms/);
  });

  it("REQ-483 M40 the payment instructions come from defaultPaymentInstructions with the identity's acceptedPaymentMethods", () => {
    expect(modal).toMatch(/defaultPaymentInstructions\(/);
    expect(modal).toMatch(/acceptedPaymentMethods/);
  });
});
