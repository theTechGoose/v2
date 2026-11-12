/**
 * REQ-388 (demo-loop cycle 2, M23) — a pricing answer offers the draft; it
 * never writes one.
 *
 * Pair 7 asked "what should i charge to move a shower drain … explain how you
 * got the number, and also cuánto cobro por piso radiante …?" and the chat
 * wrote a draft quote whose line item was the whole question. Now the answer
 * carries the offer on its payload (`draftOffer`: the job's title and the
 * Market price); the chat shows it as a "Draft a quote at $X" button on the
 * newest message, and the button sends those words — which the server reads
 * as the ask (chat-routing `parseDraftRequest`) and drafts from this same
 * offer. Both sides use `liveDraftOffer`, so the server honours exactly the
 * offer the chat shows.
 */

export interface DraftOffer {
  /** The quote's title and line ("Move a shower drain 18 inches on a slab
   *  foundation"). */
  title: string;
  /** The price the button names (the Market tier), INTEGER CENTS. */
  amountCents: number;
  /** The tier's label ("Market"), for the reply's words. */
  tier?: string;
}

/** The offer on a message payload, if it carries a usable one. */
export function draftOfferOf(payload: unknown): DraftOffer | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = (payload as { draftOffer?: unknown }).draftOffer;
  if (!raw || typeof raw !== "object") return undefined;
  const { title, amountCents, tier } = raw as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim()) return undefined;
  if (
    typeof amountCents !== "number" || !Number.isFinite(amountCents) ||
    amountCents <= 0
  ) {
    return undefined;
  }
  return {
    title: title.trim(),
    amountCents: Math.round(amountCents),
    ...(typeof tier === "string" && tier.trim() ? { tier: tier.trim() } : {}),
  };
}

/** The message fields the rule reads. */
export interface OfferMessage {
  id: string;
  role: string;
  /** The island's messages may omit it; the server's always say "text". */
  kind?: string;
  payload?: unknown;
}

/** The offer still standing: the thread's NEWEST message is the assistant's
 *  pricing answer carrying it, and the conversation has no quote yet. A new
 *  question, the drafted card or a bound quote retires it. */
export function liveDraftOffer(
  messages: readonly OfferMessage[],
  boundQuoteId: string | null | undefined,
): { id: string; offer: DraftOffer } | undefined {
  if (boundQuoteId) return undefined;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || last.kind !== "text") {
    return undefined;
  }
  const offer = draftOfferOf(last.payload);
  return offer ? { id: last.id, offer } : undefined;
}

/** "$1,500" — cents only when there are any ("$3,100.50"). */
export function offerAmount(cents: number): string {
  const dollars = cents / 100;
  return "$" + dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
