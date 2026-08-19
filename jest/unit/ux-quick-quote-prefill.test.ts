/**
 * UX-04 / UX-32 — deterministic halves of "the assistant is deaf to what the
 * user already typed" (ux-problems.md).
 *
 *   UX-04 "The quick-quote line '…para la familia Nguyen, $3,700 todo
 *          incluido' is followed by a price screen starting at $0 ('¿Cuál es
 *          el precio?') and a customer screen asking '¿Para quién es esto?'
 *          — both answers were in the sentence. The $-amount is plain-regex
 *          extractable even without an LLM."
 *   UX-32 "The facturar flow ignores what the app already knows. It opens
 *          with a cold '¿De qué trabajo es la factura?' instead of offering
 *          the just-accepted job as a chip ('¿La factura es del patio de
 *          María — $3,700?'); the typed '$3,700' is ignored (picker at $0,
 *          same as UX-04)."
 *
 * Both findings are [LLM-caveat] on the QUALITY of name extraction, but the
 * $-amount and the "para <Name>" candidate are plain-regex extractable — this
 * file pins exactly that deterministic half (P-10/P-20/P-26 precedent: pin
 * the regex-extractable part; leave LLM-quality to nothing).
 *
 * ----------------------------------------------------------------------------
 * EXPECTED EXPORT CONTRACT for the green agent — NEW module
 * shared/quote-flow/quick-quote-prefill.ts (missing today, so this file REDs
 * with "Cannot find module" until the green phase creates it):
 *
 *   export interface QuickQuotePrefill {
 *     priceCents: number | null;
 *     customerName: string | null;
 *   }
 *   export function extractPriceCents(raw: string): number | null
 *     - "$3,700"        → 370000   (commas as thousands separators)
 *     - "$1,850.50"     → 185050   (up to 2 decimals)
 *     - "$3700"         → 370000
 *     - "3700 dólares"  → 370000   (number + currency word: dólares/dolares/
 *                                    dollars/usd/pesos, case-insensitive)
 *     - bare "3700" with no $ and no currency word → null (quantities like
 *       "20x15" / "6 paneles" must never become a price)
 *     - several amounts → the LARGEST wins (deposit vs. total)
 *     - none / zero → null
 *   export function extractCustomerName(raw: string): string | null
 *     - candidate = the run of Capitalized tokens (Unicode letters, ' and -)
 *       after "para"/"for" (+ optional article el/la/los/las/the); the run
 *       stops at a comma, a digit, a "$" or a lowercase token.
 *     - ES household form: "para la familia Nguyen" → "Familia Nguyen"
 *       (the household word is kept, capitalized).
 *     - EN postfix form: "for the Smith family" → "Smith family".
 *     - no "para"/"for" phrase → null.
 *   export function extractQuickQuotePrefill(raw: string): QuickQuotePrefill
 *     - = { priceCents: extractPriceCents(raw),
 *           customerName: extractCustomerName(raw) }
 *   export function acceptedJobChipLabel(
 *     job: { jobName: string; customerName?: string | null; totalCents: number },
 *     lang: "en" | "es",
 *   ): string
 *     - the label for the accepted-job chip the facturar flow must offer:
 *       contains the jobName verbatim, the customer name when present, and
 *       the formatted total ("$3,700"; cents kept only when non-zero:
 *       "$1,850.50"); ES copy is about a factura, EN about an invoice;
 *       never renders "$0".
 *
 * ----------------------------------------------------------------------------
 * WIRING SITES (all verified against today's source):
 *
 *   PRICE PREFILL (UX-04):
 *   - front-end/islands/AsstChat.tsx:2208-2225 `submitJobDetails(raw)` — the
 *     typed quick-quote sentence lands here (stashed as pendingJobDetailsRaw,
 *     then setPriceCaptureOpen(true)). extractQuickQuotePrefill(trimmed) must
 *     run here and seed the price state.
 *   - front-end/islands/AsstChat.tsx:4510-4518 — the price step's
 *     `<MoneyInput autoFocus={!suggestPricing} onChange={setPriceCents}
 *     onSubmit …>` passes NO initialCents, so the picker always opens at $0.
 *     MoneyInput ALREADY supports seeding: front-end/islands/MoneyInput.tsx:
 *     20-47 (`initialCents` prop → display "3,700" + cents state).
 *   - front-end/islands/AsstChat.tsx:3011-3037 startKnownPriceFlow /
 *     startQuickQuoteFlow (flow entries), :1680-1703 onPriceContinue (the
 *     seeded cents must flow through unchanged).
 *
 *   CUSTOMER CANDIDATE (UX-04):
 *   - front-end/islands/AsstChat.tsx:7173-7203 CustomerStepPanel props — no
 *     initial-name seed exists today (`createName` starts ""; the create-form
 *     name input is :7342-7350). The extracted candidate must prefill it.
 *     Call sites: :4390-4396 (invoice flow) and :6314 (terms wizard).
 *
 *   FACTURAR CHIP (UX-32):
 *   - front-end/islands/AsstChat.tsx:3061-3070 startInvoiceFlow — the flow's
 *     first bubble is chipReply("invoiceDone", lang) ("…¿De qué trabajo es la
 *     factura?", shared/quote-flow/starter-chips.ts:43-45) rendered at
 *     AsstChat.tsx:4043-4055. The accepted-job chip (label from
 *     acceptedJobChipLabel) must be offered on this step. Data source: the
 *     user's accepted quotes — status "approved" is the canonical accepted
 *     state (backend/src/paperwork/entrypoints/public-controller/mod.ts:481-
 *     483); the audit verified /api/jobs returns [] for an approved quote
 *     with an auto-created draft contract (UX-02), so quotes are the source.
 *
 * Phones used: none (pure unit).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("UX-04 extractPriceCents — the $-amount in the typed sentence", () => {
  let mod: any;
  beforeAll(() => {
    // RED today: module does not exist → "Cannot find module".
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("UX-04 '$3,700 todo incluido' → 370000 cents (the audit's exact sentence)", () => {
    expect(
      mod.extractPriceCents(
        "Instalación de patio de adoquines 20x15 para la familia Nguyen, $3,700 todo incluido",
      ),
    ).toBe(370000);
  });

  it("UX-04 '$1,850.50' keeps its cents → 185050", () => {
    expect(mod.extractPriceCents("Repintar la sala, $1,850.50 con material")).toBe(
      185050,
    );
  });

  it("UX-04 '$3700' without a thousands comma → 370000", () => {
    expect(mod.extractPriceCents("Cambio de techo $3700")).toBe(370000);
  });

  it("UX-04 '3700 dólares' (currency word, no $) → 370000", () => {
    expect(mod.extractPriceCents("Cerca nueva, 3700 dólares todo incluido")).toBe(
      370000,
    );
  });

  it("UX-04 bare numbers / dimensions are NOT prices (20x15, 6 paneles → null)", () => {
    expect(
      mod.extractPriceCents("Instalación de patio de adoquines 20x15, 6 paneles"),
    ).toBeNull();
  });

  it("UX-04 several amounts → the largest wins ($500 anticipo, $3,700 total)", () => {
    expect(
      mod.extractPriceCents("Patio nuevo — $500 de anticipo, $3,700 en total"),
    ).toBe(370000);
  });

  it("UX-04 no amount at all → null", () => {
    expect(mod.extractPriceCents("Reparar la cerca del patio trasero")).toBeNull();
  });
});

describe("UX-04 extractCustomerName — the 'para <Name>' candidate", () => {
  let mod: any;
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("UX-04 'para la familia Nguyen, $3,700' → 'Familia Nguyen'", () => {
    expect(
      mod.extractCustomerName(
        "Instalación de patio de adoquines 20x15 para la familia Nguyen, $3,700 todo incluido",
      ),
    ).toBe("Familia Nguyen");
  });

  it("UX-04 'para María Nguyen' → 'María Nguyen' (accented capitals included)", () => {
    expect(
      mod.extractCustomerName("Pintar la sala para María Nguyen, $2,000"),
    ).toBe("María Nguyen");
  });

  it("UX-04 EN 'for John Smith, $1,200 all in' → 'John Smith'", () => {
    expect(mod.extractCustomerName("Deck repair for John Smith, $1,200 all in"))
      .toBe("John Smith");
  });

  it("UX-04 the name run stops at the amount (no '$' or digits leak in)", () => {
    const name = mod.extractCustomerName("Techo nuevo para Ana López $4,500");
    expect(name).toBe("Ana López");
  });

  it("UX-04 no 'para/for <Name>' phrase → null (never a hallucinated name)", () => {
    expect(
      mod.extractCustomerName("Reparar la cerca del patio, $500"),
    ).toBeNull();
  });
});

describe("UX-04 extractQuickQuotePrefill — both halves in one call", () => {
  let mod: any;
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("UX-04 the audit sentence yields BOTH the price and the name", () => {
    const got = mod.extractQuickQuotePrefill(
      "Instalación de patio de adoquines 20x15 para la familia Nguyen, $3,700 todo incluido",
    );
    expect(got).toEqual({ priceCents: 370000, customerName: "Familia Nguyen" });
  });

  it("UX-04 a sentence with neither yields both nulls (prefill never invents)", () => {
    const got = mod.extractQuickQuotePrefill("Reparar la puerta del garaje");
    expect(got).toEqual({ priceCents: null, customerName: null });
  });
});

describe("UX-32 acceptedJobChipLabel — the facturar flow's job chip", () => {
  let mod: any;
  const JOB = {
    jobName: "Patio de adoquines",
    customerName: "María Nguyen",
    totalCents: 370000,
  };
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("UX-32 ES chip names the job, the customer, and the $3,700 total — and is about a factura", () => {
    const label = String(mod.acceptedJobChipLabel(JOB, "es"));
    expect(label).toContain("Patio de adoquines");
    expect(label).toContain("María");
    expect(label).toContain("$3,700");
    expect(label).toMatch(/factur/i);
    expect(label).not.toMatch(/\$0\b/);
  });

  it("UX-32 EN chip is about an invoice and carries the same facts", () => {
    const label = String(mod.acceptedJobChipLabel(JOB, "en"));
    expect(label).toContain("Patio de adoquines");
    expect(label).toContain("$3,700");
    expect(label).toMatch(/invoice/i);
  });

  it("UX-32 whole-dollar totals render without '.00'; cents survive when real", () => {
    const whole = String(mod.acceptedJobChipLabel(JOB, "es"));
    expect(whole).not.toContain("$3,700.00");
    const withCents = String(
      mod.acceptedJobChipLabel({ ...JOB, totalCents: 185050 }, "es"),
    );
    expect(withCents).toContain("$1,850.50");
  });

  it("UX-32 a missing customer name degrades gracefully (job + amount only)", () => {
    const label = String(
      mod.acceptedJobChipLabel(
        { jobName: "Patio de adoquines", customerName: null, totalCents: 370000 },
        "es",
      ),
    );
    expect(label).toContain("Patio de adoquines");
    expect(label).toContain("$3,700");
  });
});
