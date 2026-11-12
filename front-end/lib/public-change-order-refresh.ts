/**
 * REQ-398 (demo-loop cycle 2; M13's /co part) — the public change-order page
 * (/co/:id) re-reads its order while it is open.
 *
 * The page is SSR'd once. When the customer decides on another device (or the
 * owner's preview tab is open while the customer approves), the open tab kept
 * "Pending" until a manual reload. Now it polls
 * `GET /api/change-orders/:id/public` through REQ-221's scheduler and reloads
 * the moment the server's status or version differs from what the page shows:
 * the SSR route already renders every state, so a reload is the one correct
 * re-render (REQ-321's invoice pattern).
 */
import { type PollEnv, startPoll } from "./poll.ts";
import { browserStore, markSelfReload } from "./demo-mode/tab-claim.ts";

export interface ShownChangeOrder {
  status?: string;
  version?: number;
}

/** true when the server's order left the state the page shows */
export function changeOrderMoved(
  shown: ShownChangeOrder,
  fresh: ShownChangeOrder,
): boolean {
  if ((shown.status ?? "pending") !== (fresh.status ?? "pending")) return true;
  if (
    typeof shown.version === "number" && typeof fresh.version === "number" &&
    shown.version !== fresh.version
  ) return true;
  return false;
}

export const CHANGE_ORDER_REFRESH_MS = 10_000;

export interface ChangeOrderRefreshOptions {
  changeOrderId: string;
  /** read at every tick — the island's own decision moves this baseline */
  shown: () => ShownChangeOrder;
  /** test seams; default to the browser's fetch + location.reload */
  fetchJson?: (url: string) => Promise<unknown>;
  reload?: () => void;
  ms?: number;
  env?: Partial<PollEnv>;
}

async function browserFetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(String(r.status));
  return await r.json();
}

function browserReload() {
  // REQ-549 (cycle 4, S4) — the app reloads this tab, not the customer: the next page must not
  // take the demo stage for it
  markSelfReload(browserStore("session"));
  try {
    globalThis.location.reload();
  } catch { /* SSR-safe */ }
}

/** start re-reading the order; returns the stop function */
export function startChangeOrderRefresh(
  opts: ChangeOrderRefreshOptions,
): () => void {
  const fetchJson = opts.fetchJson ?? browserFetchJson;
  const reload = opts.reload ?? browserReload;
  const url = `/api/change-orders/${opts.changeOrderId}/public`;
  let stopped = false;
  const stop = startPoll(
    async () => {
      if (stopped) return;
      const fresh = await fetchJson(url);
      if (stopped || !fresh || typeof fresh !== "object") return;
      if (changeOrderMoved(opts.shown(), fresh as ShownChangeOrder)) {
        // one reload: stop first so a slow navigation never asks twice
        stopped = true;
        stop();
        reload();
      }
    },
    opts.ms ?? CHANGE_ORDER_REFRESH_MS,
    { env: opts.env },
  );
  return () => {
    stopped = true;
    stop();
  };
}
