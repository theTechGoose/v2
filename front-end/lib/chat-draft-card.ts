/**
 * REQ-660 (demo-loop cycle 5, M24) — what a chat quote card shows.
 *
 * A card's payload is a snapshot of the quote at the moment it was appended.
 * A correction made through revise_quote changes the quote and replies with
 * text (`payload.quoteUpdated`) — it appends no new card — so a draft card
 * that read its own snapshot kept "Total $532.50 · Lock it in" while the
 * quote was $8,700. Lock it in always locks the quote as it is now, so the
 * draft card it sits on must show the quote as it is now.
 *
 * - A draft card is superseded by ANY later card for the same quote (a newer
 *   draft, or one that moved past draft): Lock it in lives on the newest card
 *   only.
 * - The newest draft card of the quote the chat has loaded renders that
 *   quote's live lines and total; every other card keeps its snapshot (a
 *   locked / sent card records what was locked or sent).
 */

export interface CardLineItem {
  description: string;
  amountCents: number;
}

export interface CardPayloadLike {
  status?: string;
  quoteId?: string;
  lineItems?: CardLineItem[];
  totalCents?: number;
}

export interface CardMessageLike {
  kind?: string;
  payload?: unknown;
}

export interface LiveQuoteLike {
  id?: string;
  lineItems?: {
    description: string;
    descriptionByLang?: Record<string, string>;
    quantity?: number;
    price?: number;
  }[];
  estimatedTotal?: number;
}

export interface DraftCardView {
  superseded: boolean;
  lineItems: CardLineItem[];
  totalCents: number;
}

const payloadOf = (
  m: CardMessageLike | undefined,
): CardPayloadLike => ((m?.payload ?? {}) as CardPayloadLike);

export function draftCardView(
  messages: readonly CardMessageLike[],
  card: CardMessageLike,
  live: LiveQuoteLike | null | undefined,
  lang?: string,
): DraftCardView {
  const payload = payloadOf(card);
  const isDraft = !!payload.quoteId && payload.status === "draft";
  const idx = messages.indexOf(card);
  const superseded = isDraft && idx >= 0 &&
    messages.slice(idx + 1).some((later) =>
      later.kind === "action_card" &&
      payloadOf(later).quoteId === payload.quoteId
    );

  const liveLines = live?.lineItems;
  if (
    isDraft && !superseded && live && live.id === payload.quoteId &&
    Array.isArray(liveLines) && liveLines.length > 0
  ) {
    const lineItems = liveLines.map((li) => ({
      description: (lang && li.descriptionByLang?.[lang]) || li.description,
      amountCents: Math.round((li.price ?? 0) * (li.quantity ?? 1)),
    }));
    const totalCents = typeof live.estimatedTotal === "number"
      ? live.estimatedTotal
      : lineItems.reduce((s, li) => s + li.amountCents, 0);
    return { superseded, lineItems, totalCents };
  }

  const lineItems = payload.lineItems ?? [];
  const totalCents = payload.totalCents ??
    lineItems.reduce((s, li) => s + (li.amountCents ?? 0), 0);
  return { superseded, lineItems, totalCents };
}
