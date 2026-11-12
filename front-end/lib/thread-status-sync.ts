/**
 * REQ-369 (demo-loop cycle 1, demo issue m2) — the open chat and the
 * conversation list show ONE status for the thread.
 *
 * Both name it with the same rule (`threadStatus` in
 * shared/quote-flow/chat-header.ts), but their inputs refresh at different
 * times: AsstChat holds the thread and its quote row; AsstThreads polls
 * GET /agents/conversations, where the server applies the rule to the quote
 * row. The demo saw the list a step behind ("Drafting" under "Quote locked",
 * "Quote sent" under "Quote accepted"). So:
 *  - the chat PUSHES its thread's status the moment it changes
 *    (THREAD_STATUS_EVENT): the list shows it on that row at once, and
 *    refreshes now — not at its next poll — when the server's row is missing
 *    (a thread that just started) or behind;
 *  - the list HANDS BACK the server's status when it differs from the
 *    chat's (THREAD_SERVER_STATUS_EVENT) — the customer signed or declined
 *    on the public page while the chat sat open — and the chat re-reads its
 *    quote row, so the header, the cards and the list move together.
 */
import type { ThreadStatus } from "../../shared/quote-flow/chat-header.ts";

/** AsstChat → AsstThreads: this thread's status, as the header names it. */
export const THREAD_STATUS_EVENT = "pm:asst-thread-status";
/** AsstThreads → AsstChat: the server names this thread differently. */
export const THREAD_SERVER_STATUS_EVENT = "pm:asst-thread-server-status";

export interface ThreadStatusDetail {
  conversationId: string;
  status: ThreadStatus;
}

let latest: ThreadStatusDetail | null = null;

/** The chat's push: dispatch it, and keep it for a list that hydrates after
 *  the chat did (islands mount in any order). Browser-only — called from an
 *  effect. */
export function publishThreadStatus(detail: ThreadStatusDetail): void {
  latest = detail;
  globalThis.dispatchEvent(
    new CustomEvent<ThreadStatusDetail>(THREAD_STATUS_EVENT, { detail }),
  );
}

/** The chat's latest push, if it came before the list was listening. */
export function latestThreadStatus(): ThreadStatusDetail | null {
  return latest;
}

/** A conversation-list row, as much of it as the sync reads. */
interface ListRow {
  id: string;
  threadStatus?: ThreadStatus | null;
}

/** The status the list shows on a row: the open chat's live one on its own
 *  thread (so the row and the header never disagree), the server's on the
 *  others. */
export function listStatusFor(
  row: ListRow,
  live?: ThreadStatusDetail | null,
): ThreadStatus {
  if (live && live.conversationId === row.id) return live.status;
  return row.threadStatus ?? "none";
}

/** A pushed status the list cannot show from what it fetched: the row is
 *  missing (a thread just started) or the server's status is behind. */
export function listNeedsRefresh(
  rows: readonly ListRow[],
  pushed: ThreadStatusDetail,
): boolean {
  const row = rows.find((r) => r.id === pushed.conversationId);
  return !row || row.threadStatus !== pushed.status;
}

/** The server's status for the open chat's thread, when it differs from the
 *  chat's — the chat should re-read its quote. */
export function serverDisagreement(
  rows: readonly ListRow[],
  live?: ThreadStatusDetail | null,
): ThreadStatus | undefined {
  if (!live) return undefined;
  const server = rows.find((r) => r.id === live.conversationId)?.threadStatus;
  return server && server !== live.status ? server : undefined;
}
