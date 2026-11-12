/**
 * REQ-301 (demo cycle 1, M18) — the moment Demo makes this browser the customer (the overlay's
 * impersonation, a cookie swap for every tab), every /admin tab of the same browser must know:
 * a window event for this tab, a BroadcastChannel for the others. A stale /admin locks itself
 * at once instead of printing the 403 its next call would get.
 */
export const DEMO_IMPERSONATING_EVENT = "pm:demo-impersonating";
const CHANNEL = "pm:demo-mode";

export interface ImpersonationDetail {
  targetUserId: string;
  targetName: string;
}

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
  dispatchEvent(e: Event): boolean;
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

export function announceImpersonation(
  d: ImpersonationDetail,
  opts: Opts = {},
): void {
  const win = opts.win ?? (globalThis as unknown as WinLike);
  win.dispatchEvent(new CustomEvent(DEMO_IMPERSONATING_EVENT, { detail: d }));
  const chan = (opts.channel ?? defaultChannel)();
  if (!chan) return;
  try {
    chan.postMessage({ k: "impersonating", ...d });
  } finally {
    chan.close();
  }
}

/** hear an impersonation from this tab or any other of the browser; returns unsubscribe */
export function onImpersonation(
  fn: (d: ImpersonationDetail) => void,
  opts: Opts = {},
): () => void {
  const win = opts.win ?? (globalThis as unknown as WinLike);
  const onEvent = (e: Event) => {
    const d = (e as CustomEvent).detail as ImpersonationDetail | undefined;
    if (d?.targetUserId !== undefined) fn(d);
  };
  const onMessage = (e: { data: unknown }) => {
    const m = e.data as
      | ({ k?: string } & Partial<ImpersonationDetail>)
      | null;
    if (m?.k !== "impersonating") return;
    fn({ targetUserId: m.targetUserId ?? "", targetName: m.targetName ?? "" });
  };
  win.addEventListener(DEMO_IMPERSONATING_EVENT, onEvent);
  const chan = (opts.channel ?? defaultChannel)();
  chan?.addEventListener("message", onMessage);
  return () => {
    win.removeEventListener(DEMO_IMPERSONATING_EVENT, onEvent);
    chan?.removeEventListener("message", onMessage);
    chan?.close();
  };
}
