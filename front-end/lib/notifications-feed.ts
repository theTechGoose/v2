/**
 * REQ-299 (demo cycle 1, issue p4 "heavy polling") — the one client-side copy of the user's
 * latest notifications (`GET /notifications?limit=10`).
 *
 * Before: DashboardPage fetched the list on load for its Activity panel and DashTopbar fetched it
 * every 10 s for its ticker, each into its own state — two fetchers of one resource, and the panel
 * went stale while the ticker moved. Now the topbar's poll refreshes THIS feed and both islands
 * read it: one request per period, and the panel follows the ticker.
 *
 *   - `readNotifications()`       the last list (empty until a refresh resolves)
 *   - `refreshNotifications()`    single-flight fetch; concurrent callers share one request;
 *                                 a failure keeps the last list and rejects the caller
 *   - `subscribeNotifications(fn)` fires on every resolved refresh
 */
import { dashboardClient, type Notification } from "../clients/dashboard.ts";

type Fetcher = () => Promise<Notification[]>;
type Listener = (items: Notification[]) => void;

const DEFAULT_FETCHER: Fetcher = () => dashboardClient.notifications(10);

let fetcher: Fetcher = DEFAULT_FETCHER;
let items: Notification[] = [];
let inflight: Promise<Notification[]> | null = null;
const listeners = new Set<Listener>();

export function readNotifications(): Notification[] {
  return items;
}

export function refreshNotifications(): Promise<Notification[]> {
  if (inflight) return inflight;
  inflight = fetcher().then((next) => {
    items = Array.isArray(next) ? next : [];
    for (const l of [...listeners]) l(items);
    return items;
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

export function subscribeNotifications(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** test seam — swap the fetcher; `keep` leaves the cached list in place */
export function _resetNotificationsForTest(
  stub?: Fetcher,
  opts: { keep?: boolean } = {},
): void {
  fetcher = stub ?? DEFAULT_FETCHER;
  inflight = null;
  if (!opts.keep) {
    items = [];
    listeners.clear();
  }
}
