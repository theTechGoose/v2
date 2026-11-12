/**
 * REQ-315 (demo-loop cycle 1, m49) — a chat reply that changed (or tried to
 * change) a quote links back to it.
 *
 * The change-order coordinator (REQ-238) and the revise coordinator put
 * their outcome on the assistant reply's payload (`changeOrder` /
 * `quoteRevision`), each carrying the quote's id and number when they found
 * one. The demo saw a bare text bubble — "Open the quote and tap Publish
 * revision" with nothing to tap. This reads the outcome into one link: to
 * publish when a revision is waiting, to the quote otherwise.
 */
export interface ChatQuoteLink {
  quoteId: string;
  quoteNumber?: string;
  /** A pending revision is waiting — the link says to publish it. */
  publish: boolean;
}

/** Outcomes that name one quote. Asks and misses (`ambiguous`, `none`,
 *  `ask_customer`) have nothing to open. */
const LINKABLE = new Set([
  "pending_revision",
  "draft_updated",
  "change_order",
  "needs_invoice",
  "locked",
  "no_such_line",
]);

export function chatQuoteLink(payload: unknown): ChatQuoteLink | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  for (const key of ["quoteRevision", "changeOrder"]) {
    const outcome = p[key];
    if (!outcome || typeof outcome !== "object") continue;
    const { kind, quoteId, quoteNumber } = outcome as Record<string, unknown>;
    if (typeof kind !== "string" || !LINKABLE.has(kind)) continue;
    if (typeof quoteId !== "string" || !quoteId) continue;
    return {
      quoteId,
      ...(typeof quoteNumber === "string" && quoteNumber
        ? { quoteNumber }
        : {}),
      publish: kind === "pending_revision",
    };
  }
  return undefined;
}
