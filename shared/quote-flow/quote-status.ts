/**
 * Quote status lifecycle (raw-plan p10):
 *   draft → (send) → sent → (customer views) → viewed → (customer signs) → accepted
 *
 * Forward-only; `accepted` is terminal. Owner actions never demote a quote.
 * The quote IS the agreement — accepting it is the one signature ceremony,
 * so there is no separate contract lifecycle.
 */

export const QUOTE_STATUS_FLOW = [
  "draft",
  "sent",
  "viewed",
  "accepted",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUS_FLOW)[number];
export type QuoteEvent = "send" | "customer_viewed" | "customer_signed";

function rank(status: QuoteStatus): number {
  return QUOTE_STATUS_FLOW.indexOf(status);
}

/** The status an event lands the quote on — never moves backwards. */
export function statusOnEvent(
  current: QuoteStatus,
  event: QuoteEvent,
): QuoteStatus {
  const target: QuoteStatus = event === "send"
    ? "sent"
    : event === "customer_viewed"
    ? "viewed"
    : "accepted";
  return rank(target) > rank(current) ? target : current;
}

/** Only forward movement along the flow is legal; accepted is terminal. */
export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  if (from === "accepted") return false;
  return rank(to) > rank(from);
}

/**
 * The quote's "accepted" property: the customer signed the agreement.
 * True on the terminal `accepted` status or a persisted acceptance stamp.
 */
export function isAccepted(
  quote: { status?: string | null; acceptedAt?: string | null },
): boolean {
  return quote.status === "accepted" || Boolean(quote.acceptedAt);
}

const BADGE_LABELS: Record<"en" | "es", Record<QuoteStatus, string>> = {
  en: { draft: "Draft", sent: "Sent", viewed: "Viewed", accepted: "Accepted" },
  es: {
    draft: "Borrador",
    sent: "Enviada",
    viewed: "Vista",
    accepted: "Aceptada",
  },
};

export function badgeLabel(
  status: QuoteStatus,
  lang: "en" | "es" = "en",
): string {
  return BADGE_LABELS[lang][status];
}
