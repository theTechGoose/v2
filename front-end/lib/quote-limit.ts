/**
 * REQ-778 (demo-loop cycle dv1, issue d8): Raphael — "The free plan limit is
 * five quotes." REQ-766's QuoteAllowance refuses the sixth quote of the month
 * on Monster Free: POST /quotes answers 402 `{ ok:false, reason:"quote_limit",
 * limit, used }` and GET /quotes/allowance gives the same answer up front.
 * These read that answer and word it, so the New quote path and /quotes say
 * the limit and how to lift it instead of "POST /quotes failed: 402".
 */
import { ApiError } from "./api.ts";
import { type Lang, tFor } from "./i18n.ts";

export interface QuoteLimit {
  limit: number;
  used: number;
}

/** The refusal in an allowance answer (GET /quotes/allowance or a 402 body); null when allowed. */
export function quoteLimitOf(body: unknown): QuoteLimit | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.ok !== false || b.reason !== "quote_limit") return null;
  if (typeof b.limit !== "number" || typeof b.used !== "number") return null;
  return { limit: b.limit, used: b.used };
}

/** A thrown POST /quotes error that is the monthly cap, else null. */
export function quoteLimitFromError(err: unknown): QuoteLimit | null {
  if (!(err instanceof ApiError) || err.status !== 402) return null;
  return quoteLimitOf(err.body);
}

/** "You've made your 5 quotes for this month on Monster Free. …" (en/es). */
export function quoteLimitMessage(lang: Lang, limit: number): string {
  return tFor(lang, "quoteLimit.message", { limit });
}

/** Where the plan is changed (Settings → Billing, REQ-127). */
export const QUOTE_LIMIT_UPGRADE_HREF = "/settings?tab=billing";
