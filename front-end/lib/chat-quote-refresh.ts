/**
 * REQ-262 (demo M25) — a chat turn that changed the bound quote's job details
 * (the assistant's update_job_details) flags its assistant reply with
 * `payload.quoteUpdated = <quoteId>`. Returns that id so the chat island can
 * re-read the quote; undefined when the turn changed nothing.
 */
export interface TurnMessageLike {
  role?: string;
  payload?: unknown;
}

export function quoteUpdatedBy(
  msgs: readonly TurnMessageLike[] | undefined | null,
): string | undefined {
  for (const m of msgs ?? []) {
    if (m?.role !== "assistant") continue;
    const id = (m.payload as { quoteUpdated?: unknown } | undefined)
      ?.quoteUpdated;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}
