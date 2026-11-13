/**
 * REQ-803 — the pure rules for a business's OWN Square account: what an access token looks
 * like (and the in-process fake's `EAAAfake_<name>`), how it is shown (never whole), which
 * Square host an environment talks to, the checkout's name and the way back to the invoice,
 * and when a Square order counts as paid. Shared by the backend (the connect endpoint, the
 * checkout, the return) and the front-end (the settings card's own checks).
 *
 * The money never touches DocuMonster: every call runs on the business's own token, so the
 * payment settles in the business's Square balance — no OAuth platform app, no fee.
 */
export const SQUARE_PRODUCTION_API = "https://connect.squareup.com";
export const SQUARE_SANDBOX_API = "https://connect.squareupsandbox.com";
/** the Square-Version header every call sends */
export const SQUARE_VERSION = "2025-01-23";
/** the in-process fake's checkout page, through the app's /api proxy (off the real deploy) */
export const FAKE_SQUARE_CHECKOUT = "/api/dev/square/checkout";

export type SquareEnvironment = "production" | "sandbox";

export function squareApiBase(env: SquareEnvironment): string {
  return env === "sandbox" ? SQUARE_SANDBOX_API : SQUARE_PRODUCTION_API;
}

const FAKE_RE = /^EAAAfake_[A-Za-z0-9_-]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;

export type SquareTokenProblem = "token_invalid" | "app_id_not_token";

/** A personal access token (production `EAAA…` / legacy `sq0atp-…`, or a sandbox one), or the
 *  fake. An application id (`sq0idp-`) or application secret (`sq0csp-`) is not a token. */
export function squareTokenInfo(
  raw: string | undefined | null,
): { ok: true; fake: boolean } | { ok: false; reason: SquareTokenProblem } {
  const t = (raw ?? "").trim();
  if (FAKE_RE.test(t)) return { ok: true, fake: true };
  if (/^sq0(?:idp|csp|idb|csb)-/.test(t)) {
    return { ok: false, reason: "app_id_not_token" };
  }
  if (t.startsWith("EAAAfake_") || !TOKEN_RE.test(t)) {
    return { ok: false, reason: "token_invalid" };
  }
  return { ok: true, fake: false };
}

/** `EAAAl0ng…WXYZ` → `EAAA••••WXYZ`: which token, never the token. */
export function maskSquareToken(raw: string | undefined | null): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  return `${t.slice(0, 4)}••••${t.slice(-4)}`;
}

/** What the customer reads on Square's checkout: "Invoice INV-001 · Acme Roofing". */
export function squareCheckoutName(
  number: string | undefined,
  business: string | undefined,
): string {
  const head = number?.trim() ? `Invoice ${number.trim()}` : "Invoice";
  return business?.trim() ? `${head} · ${business.trim()}` : head;
}

/** Where Square sends the customer back: the invoice, flagged so the page checks the order. */
export function squareReturnUrl(origin: string, invoiceId: string): string {
  return `${origin.replace(/\/+$/, "")}/i/${
    encodeURIComponent(invoiceId)
  }?square=return`;
}

interface Money {
  amount?: number;
  currency?: string;
}
/** The slice of Square's Order (GET /v2/orders/{id}) this app reads. */
export interface SquareOrderLike {
  id?: string;
  state?: string;
  total_money?: Money;
  total_tip_money?: Money;
  net_amount_due_money?: Money;
  tenders?: Array<{
    id?: string;
    type?: string;
    payment_id?: string;
    amount_money?: Money;
    tip_money?: Money;
  }>;
}

export type SquareOrderPayment =
  | { paid: true; paymentId: string; amountCents: number }
  | { paid: false; reason: "open" | "canceled" | "no_tender" };

/**
 * A Square order is paid when it is COMPLETED with a tender, or when its tenders cover it
 * (nothing left due — a payment-link order can stay OPEN after it is paid). The reference is
 * the first tender's payment id (the tender id when Square leaves `payment_id` out). The
 * amount is the order's total WITHOUT any tip: a tip is the business's, not the invoice's.
 */
export function squareOrderPayment(
  order: SquareOrderLike | undefined | null,
): SquareOrderPayment {
  if (!order) return { paid: false, reason: "open" };
  if (order.state === "CANCELED") return { paid: false, reason: "canceled" };
  const tenders = (order.tenders ?? []).filter((t) => t.payment_id || t.id);
  const total = Math.round(order.total_money?.amount ?? 0);
  const tip = Math.round(order.total_tip_money?.amount ?? 0);
  const tendered = tenders.reduce(
    (s, t) => s + Math.round(t.amount_money?.amount ?? 0),
    0,
  );
  const due = order.net_amount_due_money?.amount;
  const covered = tenders.length > 0 &&
    (due === 0 || (typeof due !== "number" && tendered >= total));
  if (order.state === "COMPLETED" || covered) {
    if (!tenders.length) return { paid: false, reason: "no_tender" };
    const first = tenders[0];
    return {
      paid: true,
      paymentId: String(first.payment_id || first.id),
      amountCents: Math.max(0, total - tip),
    };
  }
  return { paid: false, reason: "open" };
}

/** GET /invoices/:id/square — what the public invoice needs to offer the Square checkout. */
export interface SquareConfig {
  available: boolean;
  provider?: "square";
  environment?: SquareEnvironment;
  fake?: boolean;
  merchantName?: string;
  /** INTEGER CENTS — the balance the checkout will be asked for */
  amountCents?: number;
  currency?: string;
  version?: number;
}
