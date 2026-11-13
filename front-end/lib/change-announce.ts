/**
 * REQ-493 (demo-loop cycle 3, issue m7) — a client action taken in THIS
 * browser reaches the owner's other tabs at once.
 *
 * The demo's customers signed "in person" on the owner's device (the /q tab
 * that "Open as customer" opened) and went back to the app tab: it still said
 * "Sent". That tab's polls may be backed off to 60 s (REQ-424 — nobody
 * touched it), and a headless tab, or a window beside the signing one, never
 * fires focus or visibilitychange. So the public pages announce what the
 * customer just did on the `pm:changes` BroadcastChannel — the quote they
 * signed or declined, the invoice they claimed — and the owner's change feed
 * (lib/change-feed.ts) hands it to the page that shows that document.
 *
 * No imports on purpose: the public pages load this and nothing of the
 * owner's feed. Ids only, and a BroadcastChannel never leaves this browser's
 * origin.
 */

/** the documents a change can name — Notification.entityType's union */
export type ChangeEntity = "quote" | "invoice" | "customer" | "conversation";

/** one document the client (or the owner, elsewhere) moved */
export interface EntityChange {
  entityType: ChangeEntity;
  entityId: string;
  /** the notification type that announced it, when a notification did */
  type?: string;
}

export const CHANGE_CHANNEL = "pm:changes";

const ENTITY_TYPES: readonly string[] = [
  "quote",
  "invoice",
  "customer",
  "conversation",
];

/** `x` as a change, or null when it is none (junk on the channel, a
 *  notification about a payment or a message, which names no document) */
export function asChange(x: unknown): EntityChange | null {
  if (!x || typeof x !== "object") return null;
  const { entityType, entityId, type } = x as Record<string, unknown>;
  if (typeof entityType !== "string" || !ENTITY_TYPES.includes(entityType)) {
    return null;
  }
  if (typeof entityId !== "string" || entityId === "") return null;
  return {
    entityType: entityType as ChangeEntity,
    entityId,
    ...(typeof type === "string" && type ? { type } : {}),
  };
}

/** what this module needs of a BroadcastChannel */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

type OpenChannel = (name: string) => ChannelLike | null;

const browserChannel: OpenChannel = (name) =>
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel(name) as unknown as ChannelLike
    : null;

let openChannel: OpenChannel = browserChannel;

function closeQuietly(ch: ChannelLike | null) {
  try {
    ch?.close();
  } catch { /* already closed */ }
}

/** REQ-754 (demo-loop cycle 5v1, M5): this tab (this document's JS realm).
 *  The owner's own writes are announced marked with it, so the tab that
 *  wrote does not re-read what it already has; the other tabs do. */
const THIS_TAB = Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Tell the owner's other tabs in this browser. Best-effort: where there is
 *  no channel (SSR, an old browser, a blocked context) it does nothing. A
 *  message already posted is delivered after this side closes. `fromThisTab`
 *  (an owner write, REQ-754) keeps this tab's own listeners from hearing it. */
export function announceChange(
  change: EntityChange,
  opts: { fromThisTab?: boolean } = {},
): void {
  const c = asChange(change);
  if (!c) return;
  let ch: ChannelLike | null = null;
  try {
    ch = openChannel(CHANGE_CHANNEL);
    ch?.postMessage(opts.fromThisTab ? { ...c, tab: THIS_TAB } : c);
  } catch { /* no channel here */ }
  closeQuietly(ch);
}

/** Hear what the other tabs announce (never this tab's own posts); returns
 *  the stop function, which closes the channel. */
export function listenChanges(
  fn: (change: EntityChange) => void,
): () => void {
  let ch: ChannelLike | null = null;
  try {
    ch = openChannel(CHANGE_CHANNEL);
  } catch {
    ch = null;
  }
  if (!ch) return () => {};
  ch.onmessage = (e) => {
    // REQ-754: this tab's own write — it already has the answer
    if ((e?.data as { tab?: unknown } | null)?.tab === THIS_TAB) return;
    const c = asChange(e?.data);
    if (c) fn(c);
  };
  return () => {
    if (!ch) return;
    ch.onmessage = null;
    closeQuietly(ch);
    ch = null;
  };
}

/** test seam — swap the channel factory; no argument restores the browser's */
export function _setChangeChannelForTest(open?: OpenChannel): void {
  openChannel = open ?? browserChannel;
}
