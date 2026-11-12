/**
 * REQ-648 (demo-loop cycle 5, M3 + c4-m28) — the customer's demo link starts before the islands.
 *
 * Every page change in the app is a full document load (pill-carry.ts). The page's link used to
 * open in the overlay island's effect (DemoModeOverlay.tsx, effect 2) — only once ALL of the page's
 * island code was in (Fresh boots every island from one module script, and a module graph runs
 * only when every module of it has loaded), Preact had hydrated, and the overlay had seeded its
 * demo from the carry. On a slow dev server (a VM compiling the next route cold) that took seconds,
 * and all that time the stage held the page the customer had left ("Loading their next page…") —
 * and the presenter's arrow, sent against it, landed on the wrong item of her new page.
 *
 * `_app.tsx` now puts a small module script of its own in the head of every signed-in page
 * (demo-early.ts: this module and the link's own — nothing of any island — so it runs while the
 * islands load). When this browser tab was in a demo a moment ago (the carry) `startEarlyLink`
 * opens the link at once — the socket, the recorder and the sender the overlay would have made —
 * names the browser tab on the welcome's claim (the stage holding that tab between two pages
 * follows it at once, REQ-436), and answers a stage with the page's snapshot as soon as the
 * document is parsed (a stage's resync too). Until the overlay is there it keeps what the overlay
 * will want of what the link hears — the link's status, each presenter's presence and last pointer,
 * an end — and says `leaving` if the page goes first (REQ-391, as the overlay does).
 *
 * The overlay takes it over (`takeEarlyLink`, then `adopt` with the very options it would have
 * opened a link with): its handlers from then on, what was heard handed on, one socket per page.
 * The slot is the overlay's once it looked: an early script that runs later opens nothing. A link
 * nobody took over EARLY_ADOPT_MS after the page loaded is closed: a page is never mirrored
 * without the overlay's pill on it.
 */
import {
  connectDemo,
  type DemoLink,
  type DemoLinkOptions,
  type LinkStatus,
  type PeerFrom,
} from "./transport.ts";
import {
  createMirrorSender,
  type MirrorSender,
} from "../../../shared/demo-mode/mirror.ts";
import {
  type PeerMessage,
  STAGE_PATH,
} from "../../../shared/demo-mode/protocol.ts";
import {
  createRecorder,
  type Recorder,
  type RecorderOptions,
} from "./mirror-record.ts";
import { carriedDemo } from "./pill-carry.ts";
import { demoTabKey } from "./tab-key.ts";
import { type LeaveHintHost, watchLeaveHint } from "./leave-hint.ts";

/** where the early link waits for the overlay: a global — the early script and the overlay's
 *  island are two module graphs (in a build, two entries) */
export const EARLY_SLOT = "__pmDemoEarly";

/** an early link nobody took over this long after the page loaded is closed (its overlay found no
 *  demo, or never came): no page is mirrored without the pill on it */
export const EARLY_ADOPT_MS = 15_000;

export interface EarlyLink {
  /** the demo it was opened for (the carried one) */
  readonly demoId: string;
  readonly sender: MirrorSender;
  readonly recorder: Recorder;
  readonly link: DemoLink;
  /** REQ-305 — the overlay's own reaction to every frame this page sends: its pointers move with
   *  the page */
  onFrame(fn: () => void): void;
  /** the overlay takes the link over with the options it would have opened one with: its handlers
   *  from now on, and — on the next microtask, once the overlay holds the link — what the link
   *  heard before them. The same link comes back. */
  adopt(o: DemoLinkOptions): DemoLink;
  /** let go of everything (another demo's link, or nobody took it: never kept) */
  close(): void;
}

type Store = Parameters<typeof carriedDemo>[0];

/** the window as the early link needs it */
export interface EarlyHost extends LeaveHintHost {
  top?: unknown;
  self?: unknown;
  location: { href: string; origin: string; pathname: string };
}

export interface EarlyEnv {
  host: EarlyHost;
  doc: Document;
  /** the tab's sessionStorage: the carry and the browser tab's key */
  store: Store;
  now?: () => number;
  /** jest hands in its own recorder options (a fake observer, no timers) */
  record?: Omit<RecorderOptions, "emit">;
}

type Slot = { [EARLY_SLOT]?: EarlyLink | "taken" };

/** the early script's work: the link for the demo this tab was in a moment ago, or null (no such
 *  demo, a staff page, a page in a frame, the stage itself, or the overlay already looked) */
export function startEarlyLink(env: EarlyEnv): EarlyLink | null {
  const slot = env.host as unknown as Slot;
  if (slot[EARLY_SLOT] !== undefined) return null;
  if (
    env.host.top !== env.host.self ||
    env.host.location.pathname === STAGE_PATH
  ) return null;
  const carried = carriedDemo(env.store, (env.now ?? Date.now)());
  if (!carried || carried.demo.role !== "viewer") return null;
  const early = openEarly(env, carried.demo.id, () => {
    if (slot[EARLY_SLOT] === early) slot[EARLY_SLOT] = "taken";
  });
  slot[EARLY_SLOT] = early;
  return early;
}

/** the overlay's look: the early link opened for `demoId`, if there is one (another demo's is
 *  closed — never two sockets); from now on the slot is the overlay's */
export function takeEarlyLink(host: object, demoId: string): EarlyLink | null {
  const slot = host as Slot;
  const had = slot[EARLY_SLOT];
  slot[EARLY_SLOT] = "taken";
  if (!had || had === "taken") return null;
  if (had.demoId === demoId) return had;
  had.close();
  return null;
}

function openEarly(
  env: EarlyEnv,
  demoId: string,
  orphaned: () => void,
): EarlyLink {
  const { doc, host } = env;
  /** the overlay's options once it took the link over */
  let mine: DemoLinkOptions | null = null;
  let frameHook: (() => void) | null = null;
  let closed = false;
  // what the link heard before the overlay was there
  let status: LinkStatus = "connecting";
  const presence = new Map<string, boolean>();
  const pointers = new Map<string, [PeerMessage, PeerFrom]>();
  let ended: Parameters<DemoLinkOptions["onEnded"]> | null = null;

  let link: DemoLink | null = null;
  // REQ-242 / REQ-391 — the overlay's sender and recorder, made here: frames stamped with the
  // deploy's clock, sent over the link
  const sender = createMirrorSender({
    send: (m) => link?.send(m),
    clock: () => link?.now() ?? Date.now(),
  });
  const recorder = createRecorder(doc, {
    ...env.record,
    emit: (f) => {
      void sender.push(f);
      frameHook?.();
    },
  });
  /** the whole page for a stage — once the document is parsed (this script may run before) */
  let parsing = false;
  const parsed = () => {
    doc.removeEventListener("DOMContentLoaded", parsed);
    parsing = false;
    if (!closed) recorder.snapshot();
  };
  const snapshot = () => {
    if (closed) return;
    if (doc.readyState !== "loading") return recorder.snapshot();
    if (parsing) return;
    parsing = true;
    doc.addEventListener("DOMContentLoaded", parsed);
  };

  link = connectDemo({
    sessionId: demoId,
    role: "viewer",
    // REQ-436 — the browser tab's key: the stage holding this tab between pages follows it
    tab: demoTabKey(env.store),
    hasFocus: () => typeof doc.hasFocus === "function" && doc.hasFocus(),
    onStatus: (s) => {
      if (mine) return mine.onStatus(s);
      status = s;
      // nobody watching: nothing to record
      if (s !== "direct" && s !== "relay") recorder.pause();
    },
    onPeerOnline: (cid) => {
      if (mine) return mine.onPeerOnline(cid);
      snapshot(); // REQ-242 — a stage is here (it joined, or asked): the whole page
    },
    onPeer: (m, from) => {
      if (mine) return mine.onPeer(m, from);
      if (from.role !== "presenter") return;
      const pid = from.pid ?? "";
      if (m.k === "resync") snapshot();
      else if (m.k === "move" || m.k === "click") pointers.set(pid, [m, from]);
      else if (m.k === "leave") pointers.delete(pid);
    },
    onPresence: (pid, online) => {
      if (mine) return mine.onPresence?.(pid, online);
      presence.set(pid, online);
      if (!online) pointers.delete(pid);
    },
    onEnded: (by, reason, pid) => {
      if (mine) return mine.onEnded(by, reason, pid);
      ended = [by, reason, pid];
    },
  });

  // REQ-391 — the page goes before the overlay took the link: it says why, and its pointer goes
  const hint = watchLeaveHint(host);
  const onHide = () => {
    link?.leaving(hint.why());
    link?.send({ k: "leave" });
  };
  host.addEventListener("pagehide", onHide);
  // nobody took it over EARLY_ADOPT_MS after the page loaded: closed
  let orphanTimer: ReturnType<typeof setTimeout> | null = null;
  const onLoad = () => {
    host.removeEventListener("load", onLoad);
    if (mine || closed) return;
    orphanTimer = setTimeout(() => {
      orphanTimer = null;
      if (mine || closed) return;
      early.close();
      orphaned();
    }, EARLY_ADOPT_MS);
  };
  if (doc.readyState === "complete") onLoad();
  else host.addEventListener("load", onLoad);
  let watching = true;
  const stopEarly = () => {
    if (!watching) return;
    watching = false;
    host.removeEventListener("pagehide", onHide);
    host.removeEventListener("load", onLoad);
    if (orphanTimer !== null) clearTimeout(orphanTimer);
    orphanTimer = null;
    hint.stop();
  };

  const early: EarlyLink = {
    demoId,
    sender,
    recorder,
    link,
    onFrame(fn) {
      frameHook = fn;
    },
    adopt(o) {
      if (mine) return link!;
      mine = o;
      stopEarly(); // the overlay says `leaving` itself from now on
      queueMicrotask(() => {
        if (mine !== o || closed) return;
        for (const [pid, online] of presence) o.onPresence?.(pid, online);
        if (status !== "connecting") o.onStatus(status);
        for (const [m, from] of pointers.values()) o.onPeer(m, from);
        if (ended) o.onEnded(...ended);
        presence.clear();
        pointers.clear();
        ended = null;
      });
      return link!;
    },
    close() {
      if (closed) return;
      closed = true;
      stopEarly();
      doc.removeEventListener("DOMContentLoaded", parsed);
      recorder.stop();
      link?.close();
    },
  };
  return early;
}
