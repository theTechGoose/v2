/**
 * REQ-823 (demo-loop cycle dm1, M2) — the customer signed out of this browser. The app says so in
 * the tab that does it with a window event (`pm:logout`: DashSidebar fires it BEFORE the session
 * dies — its logout and its account switch), and this module tells the browser's other tabs on a
 * BroadcastChannel (they share the sign-in's cookie, so their session is dead too). Every overlay
 * that hears it says `leaving("signout")` on its demo link and closes it: the stage says the
 * customer signed out at once and follows no other tab of the dead session.
 */
export const SIGNOUT_EVENT = "pm:logout";
const CHANNEL = "pm:demo-signout";

interface ChannelLike {
  postMessage(m: unknown): void;
  addEventListener(type: "message", fn: (e: { data: unknown }) => void): void;
  removeEventListener(
    type: "message",
    fn: (e: { data: unknown }) => void,
  ): void;
  close(): void;
}
interface WinLike {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}
interface Opts {
  win?: WinLike;
  /** the cross-tab channel; null when the runtime has none */
  channel?: () => ChannelLike | null;
}

const defaultChannel = (): ChannelLike | null =>
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(CHANNEL) as unknown as ChannelLike;

/** hear the sign-out of this tab (told on to the browser's other tabs) or of another tab of the
 *  browser; returns unsubscribe */
export function onSignout(fn: () => void, opts: Opts = {}): () => void {
  const win = opts.win ?? (globalThis as unknown as WinLike);
  const chan = (opts.channel ?? defaultChannel)();
  const here = () => {
    try {
      chan?.postMessage({ k: "signout" });
    } catch { /* a closed channel: this tab still hears it */ }
    fn();
  };
  const there = (e: { data: unknown }) => {
    const m = e.data as { k?: string } | null;
    if (m?.k === "signout") fn();
  };
  win.addEventListener(SIGNOUT_EVENT, here);
  chan?.addEventListener("message", there);
  return () => {
    win.removeEventListener(SIGNOUT_EVENT, here);
    chan?.removeEventListener("message", there);
    chan?.close();
  };
}
