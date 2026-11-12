/**
 * REQ-665 — demo-loop cycle 5, issue m47: "'Payment: 100 / 0' with no units
 * on the agreement".
 *
 * Root cause (RCA m47, at 2444608a): the custom payment picker in
 * AsstChat.tsx submits termLabel()'s preview string, and termLabel joined
 * splits as bare numbers (`v.splits.join(" / ")`, terms-i18n.ts:66). That
 * unitless "100 / 0" was stored as the payment term and printed on the
 * checklist, the sidebar and the signed agreement — readable as $100 / $0.
 */
import {
  isDueNowTermValue,
  termLabel,
} from "../../shared/quote-flow/terms-i18n";
import { computePaymentSplit } from "../../front-end/lib/payment-split";
import { localizeTermValue } from "../../front-end/lib/term-i18n";
import { defaultInvoiceNetDays } from "../../shared/documents/invoice-form";

const pay = (splits: number[], lang: "en" | "es") =>
  termLabel({ kind: "payment", value: { splits } }, lang);

describe("REQ-665 (m47) termLabel — splits read as worded percentages", () => {
  it("REQ-665 100/0 is the 'paid in full upfront' preset (Due Now), never '100 / 0'", () => {
    expect(pay([100, 0], "en")).toBe("Due Now");
    expect(pay([100, 0], "es")).toBe("Pago inmediato");
  });

  it("REQ-665 0/100 is the 'Payment upon completion' preset", () => {
    expect(pay([0, 100], "en")).toBe("Payment upon completion");
    expect(pay([0, 100], "es")).toBe("Pago al finalizar");
  });

  it("REQ-665 two payments name the deposit and the balance", () => {
    expect(pay([50, 50], "en")).toBe("50% upfront, 50% on completion");
    expect(pay([30, 70], "en")).toBe("30% upfront, 70% on completion");
    expect(pay([30, 70], "es")).toBe("30% por adelantado, 70% al terminar");
  });

  it("REQ-665 three or more payments carry a % on every share", () => {
    expect(pay([30, 40, 30], "en")).toBe("30% / 40% / 30%");
    expect(pay([25, 25, 25, 25], "es")).toBe("25% / 25% / 25% / 25%");
  });

  it("REQ-665 no split label is a bare number list", () => {
    for (const s of [[100, 0], [0, 100], [50, 50], [30, 40, 30]]) {
      for (const lang of ["en", "es"] as const) {
        expect(pay(s, lang)).not.toMatch(/^\d+( \/ \d+)+$/);
      }
    }
  });
});

describe("REQ-665 (m47) the money still reads the worded label right", () => {
  it("REQ-665 '50% upfront, 50% on completion' bills two halves", () => {
    const parts = computePaymentSplit(pay([50, 50], "en"), 100_00);
    expect(parts.map((p) => [p.role, p.amountCents])).toEqual([
      ["deposit", 50_00],
      ["completion", 50_00],
    ]);
    expect(
      computePaymentSplit(pay([30, 70], "es"), 100_00).map((p) =>
        p.amountCents
      ),
    ).toEqual([30_00, 70_00]);
  });

  it("REQ-665 '30% / 40% / 30%' bills three milestones", () => {
    expect(
      computePaymentSplit(pay([30, 40, 30], "en"), 1_000_00).map((p) =>
        p.amountCents
      ),
    ).toEqual([300_00, 400_00, 300_00]);
  });

  it("REQ-665 100/0 bills ONE full payment (never a $0 balance invoice)", () => {
    for (const lang of ["en", "es"] as const) {
      const parts = computePaymentSplit(pay([100, 0], lang), 500_00);
      expect(parts).toEqual([{ role: "full", pct: 100, amountCents: 500_00 }]);
    }
  });

  it("REQ-665 the Spanish 'Pago inmediato' is due now, like 'Due Now'", () => {
    expect(isDueNowTermValue("Due Now")).toBe(true);
    expect(isDueNowTermValue("Due now")).toBe(true);
    expect(isDueNowTermValue("Pago inmediato")).toBe(true);
    expect(isDueNowTermValue("Payment upon completion")).toBe(false);
    expect(isDueNowTermValue(undefined)).toBe(false);
    const terms = [{ stepId: "payment_terms", value: pay([100, 0], "es") }];
    expect(defaultInvoiceNetDays(30, terms)).toBe(0);
  });
});

describe("REQ-665 (m47) a Spanish reader of an English-stored split", () => {
  it("REQ-665 localizeTermValue words the deposit and balance in Spanish", () => {
    expect(localizeTermValue("50% upfront, 50% on completion", "es")).toBe(
      "50% por adelantado, 50% al terminar",
    );
    expect(localizeTermValue("30% / 40% / 30%", "es")).toBe("30% / 40% / 30%");
    expect(localizeTermValue("50% upfront, 50% on completion", "en")).toBe(
      "50% upfront, 50% on completion",
    );
  });
});
