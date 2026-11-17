/**
 * REQ-678 (demo-loop cycle 5, c3-m60): "'Deposit + balance' never asks the
 * amount". After "Deposit + balance" the terms wizard asks how much upfront —
 * one of DEPOSIT_PCT_CHOICES or a custom dollar amount — and stores the answer
 * as ONE English term value:
 *
 *   "Deposit 30% + balance"     a share of the total
 *   "Deposit $500 + balance"    a fixed dollar deposit
 *
 * computePaymentSplit (front-end/lib/payment-split.ts) parses it, so the
 * preview, /q, the PDF and the invoices bill the same deposit. A plain
 * "Deposit + balance" (older quotes) keeps its 20% default.
 *
 * Dependency-free: imported by payment-split (and through it the backend),
 * the shared wizard rule (termFromPick), the island and the Jest unit suite.
 * Translation is injected.
 */

/** The chips the picker offers, in percent of the total. */
export const DEPOSIT_PCT_CHOICES = [10, 20, 30, 50] as const;

export type DepositAmount = { pct: number } | { cents: number };

type Translate = (
  lang: "en" | "es",
  key: string,
  vars?: Record<string, string | number>,
) => string;

const DEPOSIT_RE =
  /^deposit\s+(?:(\d+(?:\.\d+)?)\s*%|\$\s*(\d[\d,]*(?:\.\d{1,2})?))\s*\+\s*balance$/i;

/** "$500" / "$1,500.50" — whole dollars drop the cents. */
function dollars(cents: number): string {
  const whole = cents % 100 === 0;
  return "$" + (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

/** The amount as it reads inside the term: "30%" or "$500". */
export function depositAmountText(d: DepositAmount): string {
  return "pct" in d ? `${d.pct}%` : dollars(d.cents);
}

/** The stored English term value for a picked deposit. */
export function depositTermValue(d: DepositAmount): string {
  return `Deposit ${depositAmountText(d)} + balance`;
}

/**
 * The deposit a stored term names, or null when the value is not an
 * amount-carrying deposit term (plain "Deposit + balance", "50 / 50", free
 * text) or the amount is out of range (a share outside (0, 100), $0).
 */
export function parseDepositTerm(
  value: string | null | undefined,
): DepositAmount | null {
  const m = DEPOSIT_RE.exec((value ?? "").trim());
  if (!m) return null;
  if (m[1] !== undefined) {
    const pct = Number(m[1]);
    return pct > 0 && pct < 100 ? { pct } : null;
  }
  const cents = Math.round(Number(m[2].replace(/,/g, "")) * 100);
  return cents > 0 ? { cents } : null;
}

/** A pick's customValue in its canonical stored form, or null if it is not
 *  a deposit amount. */
export function normalizeDepositTerm(
  value: string | null | undefined,
): string | null {
  const d = parseDepositTerm(value);
  return d ? depositTermValue(d) : null;
}

/** True for the wizard option that opens the amount picker: the payment
 *  step's "Deposit + balance" (flagged in the spec; an older thread's emitted
 *  option carries only the id). */
export function isDepositPickerOption(
  stepId: string | undefined,
  option: { id: string; amountPicker?: string },
): boolean {
  if (stepId !== "payment_terms") return false;
  return option.amountPicker === "deposit" || option.id === "deposit_bal";
}

export interface DepositChoice {
  pct: number;
  /** the stored term value this chip submits */
  value: string;
  /** whole-dollar deposit / balance — only with a positive total */
  deposit?: string;
  balance?: string;
}

/** The picker's chips — each names its dollars once the total is known. */
export function depositChoices(
  totalCents: number | null | undefined,
): DepositChoice[] {
  const total = typeof totalCents === "number" && totalCents > 0
    ? totalCents
    : 0;
  const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
  return DEPOSIT_PCT_CHOICES.map((pct) => {
    const value = depositTermValue({ pct });
    if (!total) return { pct, value };
    const dep = Math.round((total * pct) / 100);
    return { pct, value, deposit: usd(dep), balance: usd(total - dep) };
  });
}

/** A stored deposit term in `lang` ("Depósito 30% + saldo"), or null when
 *  the value carries no amount (the caller's own map handles it). */
export function localizeDepositTerm(
  value: string,
  lang: "en" | "es",
  t: Translate,
): string | null {
  const d = parseDepositTerm(value);
  if (!d) return null;
  return t(lang, "termsWizard.paymentTerms.depositBalance.value", {
    amount: depositAmountText(d),
  });
}
