/**
 * REQ-823 (demo-loop cycle dm1, M2) — the customer signed out of this browser. The app says so in
 * the tab that does it with a window event (`pm:logout`: DashSidebar fires it BEFORE the session
 * dies — its logout and its account switch), and this module tells the browser's other tabs on a
 * BroadcastChannel (they share the sign-in's cookie, so their session is dead too). Every overlay
 * that hears it says `leaving("signout")` on its demo link and closes it: the stage says the
 * customer signed out at once and follows no other tab of the dead session.
 *
 * REQ-834 (demo-loop cycle dm2, M1) — a sign-out is a moment, not the page's fate: the customer
 * signs out in one tab and back in, and her other tabs (never reloaded, their cookie now the new
 * live session) must rejoin. `signoutGate` holds a page's demo asks only for SIGNOUT_HOLD_MS after
 * a sign-out (the redirect and the backend's session delete); after that the server decides (a
 * dead session's ask fails; a signed-in-again one gets its demo). A page that mounts with a
 * session says `{k:"signin"}` on the same channel, and a held page lets go at once and asks again.
 */
export const SIGNOUT_EVENT = "pm:logout";
const CHANNEL = "pm:demo-signout";
/** REQ-834 — how long after a sign-out a page asks for no demo (then the server decides) */
export const SIGNOUT_HOLD_MS = 5_000;

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
  /** REQ-834 — another tab of the browser says it signed in */
  onSignin?: () => void;
  /** REQ-834 — this page has a session: say `signin` to the browser's other tabs at once */
  sayIn?: boolean;
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
    else if (m?.k === "signin") opts.onSignin?.();
  };
  win.addEventListener(SIGNOUT_EVENT, here);
  chan?.addEventListener("message", there);
  if (opts.sayIn) {
    try {
      chan?.postMessage({ k: "signin" });
    } catch { /* a closed channel: the others' hold runs out by itself */ }
  }
  return () => {
    win.removeEventListener(SIGNOUT_EVENT, here);
    chan?.removeEventListener("message", there);
    chan?.close();
  };
}

export interface SignoutGate {
  /** a sign-out was heard under SIGNOUT_HOLD_MS ago and no sign-in since: ask for no demo */
  holds(): boolean;
  stop(): void;
}

/**
 * REQ-834 — the overlay's sign-out latch, time-boxed: `out` runs on a sign-out (this tab's or
 * another's); `holds()` is true for SIGNOUT_HOLD_MS after it; a sign-in said by another tab
 * since lifts it at once and runs `back` (ask again now). Says `signin` on mount: the page that
 * calls it has a session.
 */
export function signoutGate(
  o: Omit<Opts, "onSignin" | "sayIn"> & {
    out: () => void;
    back: () => void;
    /** test seam; defaults to Date.now */
    clock?: () => number;
  },
): SignoutGate {
  const clock = o.clock ?? (() => Date.now());
  let at: number | null = null;
  const stop = onSignout(() => {
    at = clock();
    o.out();
  }, {
    win: o.win,
    channel: o.channel,
    sayIn: true,
    onSignin: () => {
      if (at === null) return;
      at = null;
      o.back();
    },
  });
  return {
    holds: () => at !== null && clock() - at < SIGNOUT_HOLD_MS,
    stop,
  };
}
