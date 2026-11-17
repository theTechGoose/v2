/**
 * REQ-493 (demo-loop cycle 3, issue m7) — the owner pages' change feed: an
 * open page follows what the client did.
 *
 * The demo: after the customer signed, the assistant chat kept its "sent"
 * card and "GATHERING A LITTLE MORE INFO" (pairs 1, 4, 7) and the open
 * /quotes panel kept "Sent" with "Edit → Version 3" (pair 5); /invoices kept a
 * claimed invoice "Enviada" while the topbar chip already said the client
 * paid (pair 9). There is no push channel. What every owner page DOES poll is
 * the topbar's notifications feed (REQ-299: 10 s, backing off to 60 s idle,
 * REQ-424), and every client action that moves a document lands there naming
 * it — a signature (quote_accepted), a decline, a payment claim, a confirmed
 * or card payment, a change-order decision. So this module reads that feed as
 * changes, with no request of its own:
 *
 *  - `changesBetween(prev, next, since)` — a refresh's entries the previous
 *    list did not have, as `{ entityType, entityId, type }`, one per
 *    document. The first list a page sees has no previous one: only what was
 *    created after the page started (`since`) counts.
 *  - `subscribeChanges(fn)` — one call per batch: a feed refresh with new
 *    entries, or an announcement from another tab of this browser
 *    (lib/change-announce.ts: the customer signing in person on the owner's
 *    device reaches the app tab at once).
 *  - a window focus asks the feed now, debounced like REQ-299's catch-up
 *    (`CATCHUP_MIN_MS`): coming back to the window is never a stale page.
 *  - `followChanges(match, reread)` — the islands' way in: re-read when a
 *    batch names what the page shows; one read at a time, and one more after
 *    it when a matching change landed during it.
 */
import { CATCHUP_MIN_MS } from "./poll.ts";
import {
  refreshNotifications,
  subscribeNotifications,
} from "./notifications-feed.ts";
import {
  asChange,
  type ChangeEntity,
  type EntityChange,
  listenChanges,
} from "./change-announce.ts";

export type { ChangeEntity, EntityChange };

/** as much of a notification as the diff reads */
export interface NotificationLike {
  id?: string;
  type?: string;
  entityType?: string;
  entityId?: string;
  createdAt?: string;
}

/** The entries of `next` that `prev` did not have, naming a document, as
 *  changes — one per document (the newest entry's type). `prev` null is the
 *  first list this page sees: then only entries created at or after `since`
 *  (the page's start) count, so an event between the page's load and the
 *  topbar's first tick is still a change and an older one is not. */
export function changesBetween(
  prev: readonly NotificationLike[] | null,
  next: readonly NotificationLike[],
  since: number,
): EntityChange[] {
  const seen = new Set((prev ?? []).map((n) => n?.id));
  const named = new Set<string>();
  const out: EntityChange[] = [];
  for (const n of next) {
    if (!n?.id || seen.has(n.id)) continue;
    if (prev === null && !(Date.parse(n.createdAt ?? "") >= since)) continue;
    const c = asChange({
      entityType: n.entityType,
      entityId: n.entityId,
      type: n.type,
    });
    if (!c) continue;
    const key = `${c.entityType}:${c.entityId}`;
    if (named.has(key)) continue;
    named.add(key);
    out.push(c);
  }
  return out;
}

/** a quote or an invoice — what the owner's document pages show */
export function isDocChange(c: EntityChange): boolean {
  return c.entityType === "quote" || c.entityType === "invoice";
}

type Batch = (changes: EntityChange[]) => void;

interface WindowLike {
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

export interface ChangeFeedEnv {
  /** the clock the focus debounce reads */
  now: () => number;
  /** when this page started — the first list's cut-off (epoch ms) */
  since: number;
  /** the notifications feed: hear its lists, and ask it now */
  subscribeFeed: (
    fn: (items: readonly NotificationLike[]) => void,
  ) => () => void;
  refreshFeed: () => Promise<unknown>;
  /** the window whose focus asks the feed; null where there is none (SSR) */
  win: WindowLike | null;
}

/** the navigation's start: anything created after it may be missing from
 *  what the page rendered and read on mount */
function pageStart(): number {
  const origin = (globalThis as { performance?: { timeOrigin?: number } })
    .performance?.timeOrigin;
  return typeof origin === "number" && origin > 0 ? origin : Date.now();
}

function browserEnv(): ChangeFeedEnv {
  return {
    now: () => Date.now(),
    since: pageStart(),
    subscribeFeed: subscribeNotifications,
    refreshFeed: refreshNotifications,
    win: typeof globalThis.addEventListener === "function"
      ? globalThis as unknown as WindowLike
      : null,
  };
}

let env: ChangeFeedEnv = browserEnv();
const followers = new Set<Batch>();
/** the last list the feed resolved; null until this page saw one */
let prev: readonly NotificationLike[] | null = null;
/** when the feed last resolved a list or was last asked (focus debounce) */
let lastFresh = -Infinity;
let detach: (() => void) | null = null;

function emit(changes: EntityChange[]) {
  if (changes.length === 0) return;
  for (const fn of [...followers]) {
    try {
      fn(changes);
    } catch { /* one island's failure never stops the others */ }
  }
}

function attach(): () => void {
  const unfeed = env.subscribeFeed((items) => {
    lastFresh = env.now();
    const next = Array.isArray(items) ? items : [];
    const changes = changesBetween(prev, next, env.since);
    prev = next;
    emit(changes);
  });
  // REQ-563 (demo-loop cycle 4, m3): a change another tab announced (the
  // customer signed on /q) also asks the notifications feed now — the
  // topbar's ticker reads that feed, and kept "Quote sent to …" for up to its
  // 60 s idle poll after the page itself had moved on.
  const unlisten = listenChanges((c) => {
    emit([c]);
    lastFresh = env.now();
    env.refreshFeed().catch(() => {/* the topbar's poll retries */});
  });
  const onFocus = () => {
    if (env.now() - lastFresh < CATCHUP_MIN_MS) return;
    lastFresh = env.now();
    env.refreshFeed().catch(() => {/* the topbar's poll retries */});
  };
  const win = env.win;
  win?.addEventListener("focus", onFocus);
  return () => {
    unfeed();
    unlisten();
    win?.removeEventListener("focus", onFocus);
  };
}

/** Hear the changes, one call per batch; returns the stop function. The feed
 *  attaches with the first follower and lets go with the last. */
export function subscribeChanges(fn: Batch): () => void {
  followers.add(fn);
  if (!detach) detach = attach();
  return () => {
    followers.delete(fn);
    if (followers.size === 0 && detach) {
      const d = detach;
      detach = null;
      d();
    }
  };
}

/** Re-read what the page shows when a batch has a change `match` accepts.
 *  One read at a time: changes that land during a read re-read once more
 *  after it, so the last answer is never older than the last change. A
 *  failed read is dropped (the next change retries). Returns stop(). */
export function followChanges(
  match: (c: EntityChange) => boolean,
  reread: () => unknown,
): () => void {
  let stopped = false;
  let reading = false;
  let again = false;
  const run = () => {
    if (stopped) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    again = false;
    let result: unknown;
    try {
      result = reread();
    } catch {
      result = undefined;
    }
    Promise.resolve(result).catch(() => {}).finally(() => {
      reading = false;
      if (again && !stopped) run();
    });
  };
  const unsubscribe = subscribeChanges((changes) => {
    if (changes.some((c) => match(c))) run();
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}

/** test seam — let go of the feed, forget its lists and followers, and swap
 *  the environment (defaults: the browser's) */
export function _resetChangeFeedForTest(
  over: Partial<ChangeFeedEnv> = {},
): void {
  if (detach) {
    const d = detach;
    detach = null;
    d();
  }
  followers.clear();
  prev = null;
  lastFresh = -Infinity;
  env = { ...browserEnv(), ...over };
}
