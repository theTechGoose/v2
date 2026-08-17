/**
 * Quote status lifecycle (raw-plan p10):
 *   draft → (send) → sent → (customer views) → viewed → (customer signs) → approved
 *
 * Forward-only; `approved` is terminal. Owner actions never demote a quote.
 */

export const QUOTE_STATUS_FLOW = ["draft", "sent", "viewed", "approved"] as const;

export type QuoteStatus = (typeof QUOTE_STATUS_FLOW)[number];
export type QuoteEvent = "send" | "customer_viewed" | "customer_signed";

function rank(status: QuoteStatus): number {
  return QUOTE_STATUS_FLOW.indexOf(status);
}

/** The status an event lands the quote on — never moves backwards. */
export function statusOnEvent(current: QuoteStatus, event: QuoteEvent): QuoteStatus {
  const target: QuoteStatus = event === "send"
    ? "sent"
    : event === "customer_viewed"
    ? "viewed"
    : "approved";
  return rank(target) > rank(current) ? target : current;
}

/** Only forward movement along the flow is legal; approved is terminal. */
export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  if (from === "approved") return false;
  return rank(to) > rank(from);
}

const BADGE_LABELS: Record<"en" | "es", Record<QuoteStatus, string>> = {
  en: { draft: "Draft", sent: "Sent", viewed: "Viewed", approved: "Approved" },
  es: { draft: "Borrador", sent: "Enviada", viewed: "Vista", approved: "Aprobada" },
};

export function badgeLabel(status: QuoteStatus, lang: "en" | "es" = "en"): string {
  return BADGE_LABELS[lang][status];
}
