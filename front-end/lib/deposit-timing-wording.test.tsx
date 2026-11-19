/**
 * REQ-1048 (LOOP-007 cycle 2, q2-32) — "Deposit timing contradicts itself:
 * '30% upfront' vs 'Due a week after signing' vs 'pay now'".
 *
 * REQ-954 made the deposit invoice's stored net-7 due date the one deposit
 * deadline on the quote / email / PDF ("Due a week after signing" before the
 * signature, "Due Nov 26" after). Two surfaces still word it on their own:
 *
 *  1. the payment step's "Deposit + balance" sub-line (TERMS_WIZARD_V1's
 *     deposit_bal option, the AsstChat fallback keys, the assistant demo and
 *     the 50/50 option, which bills its first half on the same net-7) says
 *     "30% upfront" / "por adelantado" — i.e. at signing;
 *  2. the signed banner "Next: pay the $X due →" names no date, while the
 *     schedule right below says "Due Nov 26".
 */
import { assert } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";
import { computeMilestones } from "../components/doc-parts.tsx";
import { TERMS_WIZARD_V1 } from "../../shared/quote-flow/wizard-terms.ts";
import { shortDate } from "../../shared/documents/linked-view.ts";
import { depositBalanceSubVars } from "./payment-split.ts";
import { tFor } from "./i18n.ts";

const TERM = "Deposit 30% + balance";
const TOTAL = 8_400_00;
const DEPOSIT_DUE = "2026-11-26";

/** "upfront" = before the work, at signing — the opposite of net-7. */
const UPFRONT: Record<"en" | "es", RegExp> = {
  en: /up[\s-]?front/i,
  es: /por adelantado/i,
};

function paymentStepSubs(lang: "en" | "es"): Record<string, string> {
  const step = TERMS_WIZARD_V1.steps.find((s) => s.id === "payment_terms");
  assert(step, "TERMS_WIZARD_V1 has a payment_terms step");
  const out: Record<string, string> = {};
  const withAmounts = depositBalanceSubVars(TOTAL, TERM);
  const noAmounts = depositBalanceSubVars(undefined, TERM);
  for (const id of ["deposit_bal", "50_50"]) {
    const opt = step.options.find((o) => o.id === id);
    assert(opt, `the payment step has the ${id} option`);
    if (opt.sub) out[`${id}.sub`] = tFor(lang, opt.sub, noAmounts);
    if (opt.subAmounts) {
      out[`${id}.subAmounts`] = tFor(lang, opt.subAmounts, withAmounts);
    }
  }
  // the AsstChat fallback picker and the assistant demo word the same option
  for (
    const key of [
      "asstChat.terms.payment.depositBalanceSub",
      "asstChat.terms.payment.depositBalanceSubAmounts",
      "asstChat.terms.payment.fiftyFiftySub",
      "assistantDemo.wiz.optDepositSub",
      "assistantDemo.wiz.optHalfSub",
    ]
  ) out[key] = tFor(lang, key, withAmounts);
  return out;
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1048 (LOOP-007 q2-32) [${lang}]: the payment step's deposit sub-lines never promise the deposit "upfront" while the quote's deposit row says it is due a week after signing`, () => {
    const rows = computeMilestones(
      TOTAL / 100,
      [{ stepId: "payment_terms", label: "Payment", value: TERM }],
      lang,
    );
    const depositRow = rows[0];
    assert(depositRow, "a deposit + balance schedule has a deposit row");
    const week = tFor(lang, "quoteDoc.milestone.weekAfterSigning");
    assert(
      depositRow.when === week,
      `pre-sign deposit row reads "${week}": ${JSON.stringify(depositRow)}`,
    );
    const subs = paymentStepSubs(lang);
    const contradicting = Object.entries(subs).filter(([, v]) =>
      UPFRONT[lang].test(v)
    );
    assert(
      contradicting.length === 0,
      `the quote says the deposit is "${week}", but the payment step says:\n${
        contradicting.map(([k, v]) => `  ${k} = "${v}"`).join("\n")
      }`,
    );
  });
}

function signedDepositQuote(): QuotePublic {
  return {
    id: "q-1048",
    number: "Q-032",
    version: 1,
    state: "accepted",
    status: "accepted",
    acceptedAt: "2026-11-19T15:00:00.000Z",
    acceptedName: "Dana Whitfield",
    customer: { name: "Dana Whitfield", email: "dana@example.com" },
    contractor: { name: "Maria Castro", businessName: "Castro Remodeling" },
    summary: "Kitchen remodel",
    estimatedTotal: TOTAL,
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: TOTAL,
    }],
    terms: [{ stepId: "payment_terms", label: "Payment", value: TERM }],
    invoices: [{
      id: "inv-1048",
      number: "INV-001",
      status: "sent",
      amountCents: 2_520_00,
      paidCents: 0,
      balanceCents: 2_520_00,
      dueDate: DEPOSIT_DUE,
      url: "/i/inv-1048",
    }],
  } as QuotePublic;
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1048 (LOOP-007 q2-32) [${lang}]: the signed banner's "pay the deposit" step names the same due date as the deposit schedule row`, () => {
    const html = renderToString(
      <QuoteDoc quote={signedDepositQuote()} lang={lang} />,
    );
    const doc = new DOMParser().parseFromString(
      `<html><body>${html}</body></html>`,
      "text/html",
    )!;
    const short = shortDate(DEPOSIT_DUE, lang, false); // "Nov 26" / "26 nov"
    const schedule = (doc.querySelector(".ctr__milestones")?.textContent ?? "")
      .replace(/\s+/g, " ");
    assert(
      schedule.toLowerCase().includes(short.toLowerCase()),
      `the schedule names the deposit's due date "${short}": "${schedule}"`,
    );
    const pay = doc.querySelector("[data-cy='quote-signed-banner-pay']");
    assert(pay, "the signed banner links the deposit to pay");
    const text = (pay.textContent ?? "").replace(/\s+/g, " ").trim();
    assert(
      text.toLowerCase().includes(short.toLowerCase()),
      `the banner's next step names the deposit's due date "${short}" like the schedule does; it says: "${text}"`,
    );
  });
}
