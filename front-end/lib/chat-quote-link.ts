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
  /** REQ-701 (cycle 5, M21): the answer to "¿dónde le contesto?" — the link
   *  opens the quote's "Questions from the client" (#questions). */
  questions?: true;
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

/** REQ-462 (demo-loop cycle 3, M26): the chat's edit of a change order by
 *  its number (`changeOrderEdit`) links the order's quote, whose panel lists
 *  it with Edit / Withdraw. An unknown number names no quote. */
const EDIT_LINKABLE = new Set([
  "updated",
  "withdrawn",
  "approved",
  "no_change",
  "needs_amount",
  "ask",
]);

const LINKABLE_BY_KEY: Record<string, Set<string>> = {
  quoteRevision: LINKABLE,
  changeOrder: LINKABLE,
  changeOrderEdit: EDIT_LINKABLE,
};

export function chatQuoteLink(payload: unknown): ChatQuoteLink | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  // REQ-701: AnswerInquiries names the quote whose question is waiting.
  const inquiry = p.inquiry as Record<string, unknown> | undefined;
  if (
    inquiry && typeof inquiry === "object" && inquiry.kind === "open" &&
    typeof inquiry.quoteId === "string" && inquiry.quoteId
  ) {
    return {
      quoteId: inquiry.quoteId,
      ...(typeof inquiry.quoteNumber === "string" && inquiry.quoteNumber
        ? { quoteNumber: inquiry.quoteNumber }
        : {}),
      publish: false,
      questions: true,
    };
  }
  for (const [key, linkable] of Object.entries(LINKABLE_BY_KEY)) {
    const outcome = p[key];
    if (!outcome || typeof outcome !== "object") continue;
    const { kind, quoteId, quoteNumber } = outcome as Record<string, unknown>;
    if (typeof kind !== "string" || !linkable.has(kind)) continue;
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

/**
 * REQ-456 (demo-loop cycle 3, M25) — a reply that created a change order
 * names it ("CO-001") and links the customer's approval page, so the
 * contractor can copy the link or open it as the customer. The demo saw only
 * "Open Q-001" and took "send it to her" as ignored.
 */
export interface ChatChangeOrderLink {
  changeOrderId: string;
  number?: string;
  /** Origin-free "/co/<id>[?lang=xx]". */
  path: string;
}

export function chatChangeOrderLink(
  payload: unknown,
): ChatChangeOrderLink | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const outcome = (payload as Record<string, unknown>).changeOrder;
  if (!outcome || typeof outcome !== "object") return undefined;
  const { kind, changeOrderId, changeOrderNumber, approvalPath } =
    outcome as Record<string, unknown>;
  if (kind !== "change_order") return undefined;
  if (typeof changeOrderId !== "string" || !changeOrderId) return undefined;
  const own = `/co/${encodeURIComponent(changeOrderId)}`;
  const path = typeof approvalPath === "string" &&
      (approvalPath === own || approvalPath.startsWith(`${own}?`))
    ? approvalPath
    : own;
  return {
    changeOrderId,
    number: typeof changeOrderNumber === "string" && changeOrderNumber
      ? changeOrderNumber
      : undefined,
    path,
  };
}
