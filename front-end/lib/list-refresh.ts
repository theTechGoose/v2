/**
 * REQ-321 (demo-loop cycle 1, issue M14) — a list page re-reads the server
 * while it is open: every `ms` through REQ-221's scheduler (which waits while
 * the tab is hidden and catches up once when it is shown again) AND on the
 * window's `focus` (coming back from another window does not change the
 * document's visibility, so the scheduler alone would miss it).
 *
 * /quotes used to list once in a mount-time effect, so a quote the customer
 * signed in another tab stayed "Out for response" until a manual reload.
 * The mount fetch stays the island's own; this only re-runs it.
 */
import { type PollEnv, startPoll } from "./poll.ts";

export interface ListRefreshEnv {
  env?: Partial<PollEnv>;
  /** the window whose focus re-reads; null where there is none (SSR) */
  win?: {
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
  } | null;
}

/** re-run `fn` every `ms` and on window focus; returns the stop function */
export function startListRefresh(
  fn: () => unknown,
  ms: number,
  opts: ListRefreshEnv = {},
): () => void {
  const win = opts.win === undefined
    ? (typeof globalThis.addEventListener === "function" ? globalThis : null)
    : opts.win;
  let stopped = false;
  let inFlight = false;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    let result: unknown;
    try {
      result = fn();
    } catch {
      inFlight = false;
      return;
    }
    return Promise.resolve(result).catch(() => {}).finally(() => {
      inFlight = false;
    });
  };
  const stopPoll = startPoll(run, ms, { env: opts.env });
  const onFocus = () => {
    run();
  };
  win?.addEventListener("focus", onFocus);
  return () => {
    stopped = true;
    stopPoll();
    win?.removeEventListener("focus", onFocus);
  };
}
