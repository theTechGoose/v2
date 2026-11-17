/**
 * REQ-213 — the flip card's pure rules (the CRM's pay card, ppwk-crm REQ-010, ported): the
 * brand off the leading digits, the Luhn check, the number and expiry as they are typed, the
 * draft's validity, the Stripe PaymentMethod form, and the server's answer told apart.
 */
export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "none";

export function digitsOf(s: string): string {
  return (s ?? "").replace(/\D+/g, "");
}

export function brandOf(digits: string): CardBrand {
  const d = digitsOf(digits);
  if (/^4/.test(d)) return "visa";
  if (/^(5[1-5]|5$|2(22[1-9]|2[3-9]|[3-6]|7[01]|720))/.test(d)) {
    return "mastercard";
  }
  if (/^3[47]/.test(d)) return "amex";
  if (/^(6011|65|64[4-9]|622)/.test(d)) return "discover";
  return "none";
}

export function luhnValid(digits: string): boolean {
  const d = digitsOf(digits);
  if (!d.length) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function numberLengthFor(brand: CardBrand): number {
  return brand === "amex" ? 15 : 16;
}

export function cvcLengthFor(brand: CardBrand): 3 | 4 {
  return brand === "amex" ? 4 : 3;
}

/** "#### #### #### ####" — Amex "#### ###### #####"; never past the brand's length. */
export function formatCardNumber(raw: string): string {
  const brand = brandOf(raw);
  const d = digitsOf(raw).slice(0, numberLengthFor(brand));
  const groups = brand === "amex" ? [4, 6, 5] : [4, 4, 4, 4];
  const out: string[] = [];
  let at = 0;
  for (const g of groups) {
    if (at >= d.length) break;
    out.push(d.slice(at, at + g));
    at += g;
  }
  return out.join(" ");
}

/** MM/YY as it is typed: "1" → "1", "12" → "12/", "1234" → "12/34". */
export function formatExpiry(raw: string): string {
  const d = digitsOf(raw).slice(0, 4);
  if (d.length < 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

export function parseExpiry(
  s: string,
  now: Date = new Date(),
): { month: number; year: number } | null {
  const m = /^(\d{2})\/(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const year = 2000 + Number(m[2]);
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  if (year < y || (year === y && month < mo)) return null;
  return { month, year };
}

export interface CardDraft {
  number: string;
  holder: string;
  expiry: string;
  cvc: string;
}
export type CardField = "number" | "holder" | "expiry" | "cvc";

export function cardDraftValid(
  d: CardDraft,
  now: Date = new Date(),
): { ok: true } | { ok: false; field: CardField } {
  const digits = digitsOf(d.number);
  const brand = brandOf(digits);
  if (digits.length !== numberLengthFor(brand) || !luhnValid(digits)) {
    return { ok: false, field: "number" };
  }
  if (!d.holder?.trim()) return { ok: false, field: "holder" };
  if (!parseExpiry(d.expiry, now)) return { ok: false, field: "expiry" };
  if (digitsOf(d.cvc).length !== cvcLengthFor(brand)) {
    return { ok: false, field: "cvc" };
  }
  return { ok: true };
}

/** The body of `POST /v1/payment_methods` (Stripe's form encoding) — the card and the holder. */
export function paymentMethodForm(d: CardDraft): URLSearchParams {
  const exp = parseExpiry(d.expiry, new Date(0)) ?? { month: 0, year: 0 };
  const f = new URLSearchParams();
  f.set("type", "card");
  f.set("card[number]", digitsOf(d.number));
  f.set("card[exp_month]", String(exp.month));
  f.set("card[exp_year]", String(exp.year));
  f.set("card[cvc]", digitsOf(d.cvc));
  f.set("billing_details[name]", d.holder.trim());
  return f;
}

export type CardPayDecision =
  | { kind: "paid"; paymentIntentId: string; balanceCents: number }
  | { kind: "requires_action"; paymentIntentId: string; clientSecret: string }
  | { kind: "declined"; message: string }
  | { kind: "stale_balance"; balanceCents: number; version?: number }
  | { kind: "already_paid" }
  | { kind: "error"; reason: string };

/** What the charge endpoint answered (REQ-213), by status and body. */
export function cardPayDecision(
  status: number,
  body: unknown,
): CardPayDecision {
  const b = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  if (status === 200 && b.ok === true && b.status === "succeeded") {
    return {
      kind: "paid",
      paymentIntentId: String(b.paymentIntentId ?? ""),
      balanceCents: Number(b.balanceCents ?? 0),
    };
  }
  if (status === 200 && b.status === "requires_action") {
    return {
      kind: "requires_action",
      paymentIntentId: String(b.paymentIntentId ?? ""),
      clientSecret: String(b.clientSecret ?? ""),
    };
  }
  if (status === 402) {
    return { kind: "declined", message: String(b.message ?? "") };
  }
  if (status === 409 && b.reason === "stale_balance") {
    return {
      kind: "stale_balance",
      balanceCents: Number(b.balanceCents ?? 0),
      ...(typeof b.version === "number" ? { version: b.version } : {}),
    };
  }
  if (status === 409 && b.reason === "already_paid") {
    return { kind: "already_paid" };
  }
  return {
    kind: "error",
    reason: typeof b.reason === "string" ? b.reason : String(status),
  };
}
