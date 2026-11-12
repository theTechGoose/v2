/**
 * REQ-153 — demo mode's overlay, mounted once in _app.tsx for every request with a session.
 *
 * It asks `GET /demo-mode/active` on load, every 5 s while this side is not connected to the
 * other (and the tab is visible), and at once when /admin opens a demo in this tab. Every ask
 * carries the page this app is on; the server keeps it 20 s. The customer is never asked:
 *
 *   - the presenter (the super admin) is made the customer (impersonation) and sent to the STAGE
 *     (REQ-187, `/demo/stage`), which shows the customer's screen in a frame — the first thing the
 *     presenter sees is what the customer sees;
 *   - the customer's app joins on its own the moment its poll sees the demo (AMENDMENT —
 *     auto-join): the pill says "{name} is guiding you" with End.
 *
 * REQ-242 — the customer's screen is the truth, mirrored: while a presenter is connected this side
 * RECORDS its document (mirror-record.ts — a snapshot when a presenter joins or a stage asks for
 * one, then every change) and sends it as `dom` chunks; nobody watching, the recorder is paused;
 * the link closed, it stops. It draws each presenter's pointer on the element they point at (the
 * mirrored node's id and the point's place in its box; the fraction of this viewport, REQ-188,
 * when the element is not here) plus a loud expanding wave where they clicked, above the app with
 * pointer events off: a click there is never an action here. Its own pointer goes out the same
 * way, and a `leave` when the page goes. A presenter who leaves takes their pointer along. In any
 * nested frame (an app page embedded in a page) and on the stage itself this island is inert.
 *
 * REQ-214 — several staff may present at once: one pointer per presenter, each in that
 * presenter's colour with their name on it; the pill names them all with their colour dots.
 *
 * REQ-305 — each presenter's last anchor is kept and placed again whenever this page moves under
 * it (a scroll of any scroller, a resize, a change of the page): the arrow follows the element
 * they point at, and sits on the window's edge pointing outside when that element is out of view.
 * This side's resting pointer goes out again after every snapshot (a stage that was just handed
 * one has not seen it), and whenever the page moved under the still cursor so that another
 * element (or another spot of it) is under it now.
 *
 * REQ-232 — only opening the demo here (the started event) moves a staff page onto the stage. Any
 * other staff page — another window of the same account, /admin after "Return to your account" —
 * says "Guiding {name}" with "Back to the demo" and never moves on its own. Every customer tab is
 * its own connection: the tab claims the stage when it is in front, gets focus or is clicked, so
 * the stage shows the tab the customer is using. The pill says plainly whether the demo is live —
 * Connected / Connecting… — never how the bytes travel.
 * REQ-235 — the end is said and stays: End asks first (EndDemo); when the demo ends the pill
 * turns at once into a notice of who ended it ("{name} ended the demo", "You ended the demo"),
 * kept until dismissed or a new demo starts. On /admin it says what a stage handed over on its
 * way there (`?demo=ended&by=…`), once.
 * REQ-298 (demo-loop cycle 1, M5 + M17) — a restart is said: a demo that arrives while the ended
 * notice is up, or within 30 s of an end, puts "{name} started a new demo" in the pill (with a
 * pulse) for a few seconds before the plain "is guiding you" line — never a silent replacement.
 * REQ-391 (demo-loop cycle 2, M4 + m21) — as the page goes it tells the stage why (navigating to
 * another page of the app, or closing — leave-hint.ts), and every mirrored frame carries its push
 * time on the deploy's clock, so the stage can say how late it is.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { t } from "../lib/i18n.ts";
import {
  DEMO_OPENING_EVENT,
  DEMO_STARTED_EVENT,
  demoModeClient,
  type DemoStarted,
} from "../clients/demo-mode.ts";
import { adminClient } from "../clients/admin.ts";
import { announceImpersonation } from "../lib/demo-mode/impersonation-signal.ts";
import {
  ACTIVE_POLL_MS,
  ACTIVE_REASK_MS,
  ACTIVE_WAIT_MS,
  type Anchor,
  fracToPoint,
  type PeerMessage,
  type Presenter,
  type Role,
  sameAnchor,
  STAGE_PATH,
} from "../../shared/demo-mode/protocol.ts";
import {
  anchorAt,
  createTouchFade,
  TOUCH_REST_MS,
} from "../lib/demo-mode/pointer-anchor.ts";
import {
  createMirrorSender,
  type MirrorSender,
} from "../../shared/demo-mode/mirror.ts";
import {
  type RestartNotice,
  restartNotice,
  startedText,
} from "../../shared/demo-mode/restart.ts";
import {
  ARROW_BOX,
  MOVE_GAP_DIRECT_MS,
  MOVE_GAP_RELAY_MS,
  moveThrottle,
  newerMove,
  placeIn,
  type Pt,
} from "../../shared/demo-mode/motion.ts";
import { type ActivePoll, activePoll } from "../lib/demo-mode/active-poll.ts";
import { handCursor, sessionStore } from "../lib/demo-mode/cursor-handoff.ts";
import {
  connectDemo,
  type DemoLink,
  type LinkStatus,
  type PeerFrom,
} from "../lib/demo-mode/transport.ts";
import {
  createRecorder,
  type Recorder,
} from "../lib/demo-mode/mirror-record.ts";
import {
  type LeaveHintHost,
  watchLeaveHint,
} from "../lib/demo-mode/leave-hint.ts";
import PeerPointer, {
  type PointerCmd,
} from "../components/demo-mode/PeerPointer.tsx";
import PresenterChips from "../components/demo-mode/PresenterChips.tsx";
import EndDemo from "../components/demo-mode/EndDemo.tsx";
import {
  ADMIN_PATH,
  type EndedNotice,
  endedText,
  readEndedNotice,
  whoEnded,
} from "../../shared/demo-mode/ended.ts";
import {
  bandBackground,
  clearPillRoom,
  CONTROL_SELECTOR,
  countsAsPage,
  coversView,
  dockPill,
  PAGE_MEDIA_SELECTOR,
  PILL_BAND_GAP,
  PILL_COMPACT_MAX_W,
  PILL_FONT,
  PILL_MARGIN,
  PILL_MOVE_MS,
  pillHome,
  pillOverflows,
  pillStore,
  recallPillOpen,
  rememberPillOpen,
  samplePoints,
  setPillRoom,
} from "../../shared/demo-mode/pill.ts";
import { pillCopy } from "../../shared/demo-mode/pill-copy.ts";
import type { PillFace, Rect } from "../../shared/demo-mode/protocol.ts";

interface Demo {
  id: string;
  role: Role;
  presenterName: string;
  targetName: string;
  targetUserId: string;
  /** REQ-214 — everyone presenting, each with a name and a colour */
  presenters: Presenter[];
}

/** the same demo, with the same presenters (a roster change re-renders, a poll's echo does not) */
const sameDemo = (a: Demo | null, b: Demo) =>
  a?.id === b.id &&
  JSON.stringify(a.presenters) === JSON.stringify(b.presenters);

const Z = 2147483000;
/** REQ-379 (M28) — the pill lets a click through to the page; its buttons take theirs */
const HIT = "pointer-events:auto";

const here = () => globalThis.location.pathname + globalThis.location.search;
/** REQ-379 — how often the pill looks for a dialog over its home (it never hunts for a spot) */
const PILL_CHECK_MS = 700;

/**
 * REQ-300 (demo M20) — an open dialog's backdrop: a fixed box over the whole view under the view's
 * centre (the demo's own chrome not counted). REQ-379 — while it is up, a pill whose home has the
 * dialog's content under it docks at the top-left (`dockPill`) instead of staying frozen over it.
 */
function dialogBackdropUp(): boolean {
  const view = { w: globalThis.innerWidth, h: globalThis.innerHeight };
  return document.elementsFromPoint(view.w / 2, view.h / 2)
    .filter((el) => !el.closest("[data-demo-overlay]"))
    .some((el) =>
      el !== document.documentElement && el !== document.body &&
      getComputedStyle(el).position === "fixed" &&
      coversView(el.getBoundingClientRect(), view)
    );
}

/**
 * REQ-440 (demo-loop cycle 3, m2) — the backgrounds under the pill's band, innermost first (the
 * page's element at the band's left foot, up to <html>): the band is painted in the first opaque
 * one, so a document that scrolls ends at the band's edge instead of running under the pill.
 */
function bandColors(view: { h: number }): string[] {
  const at = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(1, view.h - 1)
      .find((el) => !el.closest("[data-demo-overlay]"))
    : undefined;
  const out: string[] = [];
  for (let n: Element | null = at ?? document.body; n; n = n.parentElement) {
    out.push(getComputedStyle(n).backgroundColor);
  }
  return out;
}

/** REQ-295 — does this element show text of its own (not just its children's)? */
function ownText(el: Element): boolean {
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && /\S/.test(n.nodeValue ?? "")) return true;
  }
  return false;
}

/** REQ-295 — does this element draw a background or a border? */
function painted(cs: CSSStyleDeclaration): boolean {
  const bg = cs.backgroundColor;
  const clear = !bg || bg === "transparent" ||
    /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(bg);
  if (!clear) return true;
  if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
  return [
    cs.borderTopWidth,
    cs.borderBottomWidth,
    cs.borderLeftWidth,
    cs.borderRightWidth,
  ]
    .some((w) => parseFloat(w) > 0);
}

/** REQ-295 — the piece of the page the topmost element at a point belongs to, or null if none */
function pageAt(x: number, y: number): Element | null {
  const top = document.elementsFromPoint(x, y)
    .find((el) => !el.closest("[data-demo-overlay]"));
  if (!top) return null;
  const owner = top.closest(CONTROL_SELECTOR) ??
    top.closest(PAGE_MEDIA_SELECTOR);
  if (owner) return owner;
  const root = top === document.documentElement || top === document.body;
  const box = top.getBoundingClientRect();
  const area = Math.max(1, globalThis.innerWidth * globalThis.innerHeight);
  const is = countsAsPage({
    root,
    control: false,
    media: false,
    text: ownText(top),
    painted: root ? false : painted(getComputedStyle(top)),
    areaFrac: (box.width * box.height) / area,
  });
  return is ? top : null;
}

/** REQ-228 / REQ-295 — how many distinct pieces of the page lie under a box (the demo's own chrome
 *  not counted): controls, media, dialogs, text, cards and bars. REQ-379: a point every 40 px
 *  across, so a link between two points of a wide pill is not missed */
function pageUnder(r: Rect): number {
  const found = new Set<Element>();
  for (
    const { x, y } of samplePoints(r, Math.max(5, Math.ceil(r.width / 40)), 3)
  ) {
    const el = pageAt(x, y);
    if (el) found.add(el);
  }
  return found.size;
}

/** REQ-379 — the impersonation banner's height (REQ-181's --banner-h): a docked pill goes under it */
const bannerH = () =>
  parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--banner-h"),
  ) || 0;

const narrow = () =>
  typeof globalThis.innerWidth === "number" &&
  globalThis.innerWidth <= PILL_COMPACT_MAX_W;
/** REQ-188 — this side's layout viewport as a box */
const viewportBox = () => ({
  left: 0,
  top: 0,
  width: globalThis.innerWidth || 1,
  height: globalThis.innerHeight || 1,
});

export default function DemoModeOverlay() {
  /** M5 — in a nested frame (an app page embedded in a page), or on the stage: never part of the demo */
  const inert = typeof globalThis.location !== "undefined" &&
    (globalThis.top !== globalThis.self ||
      globalThis.location.pathname === STAGE_PATH);
  const [demo, setDemo] = useState<Demo | null>(null);
  /** REQ-179 — Demo was just clicked on /admin: the pill says Opening… until the server answers */
  const [opening, setOpening] = useState<{ targetName: string } | null>(null);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [peerOnline, setPeerOnline] = useState(false);
  /** REQ-214 — the latest thing each presenter did, by pid */
  const [cmds, setCmds] = useState<Record<string, PointerCmd>>({});
  const seq = useRef(0);
  /** REQ-235 — the demo is over: who ended it, said until dismissed (or a new demo starts) */
  const [notice, setNotice] = useState<EndedNotice | null>(null);
  /** REQ-298 — the demo that just arrived is a restart: the pill says so for a few seconds */
  const [fresh, setFresh] = useState(false);
  const restartRef = useRef<RestartNotice | null>(null);
  if (!restartRef.current) {
    restartRef.current = restartNotice({ onChange: setFresh });
  }
  const linkRef = useRef<DemoLink | null>(null);
  /** REQ-228 — the pill, where it sits, and whether it is the phone's compact one */
  const pillRef = useRef<HTMLDivElement | null>(null);
  /** REQ-379 — how far up from its home a dialog docked the pill (0: home); a move glides */
  const [dock, setDock] = useState(0);
  const atRef = useRef<{ left: number; top: number } | null>(null);
  /** REQ-379 — the phone's compact form from the first render: a full-size first measure is what
   *  grew to a 400 px pill on a 390 px phone (M6) */
  const [compact, setCompact] = useState(narrow);
  /** REQ-295 — the room reserved under the page right now (0: none) */
  const roomRef = useRef(0);
  /** REQ-440 — the colour the band under the pill is painted in (the page's own, opaque) */
  const [bandBg, setBandBg] = useState("#fff");
  /** REQ-295 — the pill's box as last told to the stage */
  const sentPillRef = useRef<Rect | null>(null);
  const sendPillRef = useRef<() => void>(() => {});
  /** REQ-372 — what the pill shows right now (set each render), and as last told to the stage */
  const faceRef = useRef<PillFace>({});
  const sentFaceRef = useRef<string>("");
  const [open, setOpen] = useState(false);
  const impersonatingRef = useRef<boolean | null>(null);
  const placingRef = useRef(false);
  /** REQ-232 — this staff page is on its way to the stage (the pill says Opening…) */
  const [placing, setPlacing] = useState(false);
  /** REQ-393 — where this page's mouse is (null: not over it), handed to the stage it opens */
  const cursorRef = useRef<Pt | null>(null);
  const peerOnlineRef = useRef(false);
  peerOnlineRef.current = peerOnline;
  const pollRef = useRef<(() => void) | null>(null);
  /** REQ-222 (M11) — the poll itself; `idle()` re-arms it whenever this side is not connected */
  const pollerRef = useRef<ActivePoll | null>(null);
  const whoRef = useRef<Promise<boolean> | null>(null);
  /** one whoami per page, started early (on the opening event) so the placement never waits for it */
  const knowImpersonating = () =>
    whoRef.current ??= adminClient.whoami()
      .then((w) => Boolean(w.impersonating))
      .catch(() => false);
  const demoRef = useRef<Demo | null>(null);
  demoRef.current = demo;
  /** REQ-242 — this page's recorder and the sender its frames go out through */
  const recorderRef = useRef<Recorder | null>(null);
  const senderRef = useRef<MirrorSender | null>(null);
  /** REQ-305 — each presenter's pointer as last sent: its anchor, placed again on this screen
   *  whenever this page moves under it (the arrow follows the element they point at) */
  const anchorsRef = useRef<Map<string, Anchor>>(new Map());
  /** REQ-305 — where this side's pointer rests on this screen; null once it left the window */
  const lastMoveRef = useRef<Pt | null>(null);
  /** REQ-305 — this side's pointer as last sent */
  const sentRef = useRef<Anchor | null>(null);

  /** REQ-242 — a point of this screen for the presenters: the fraction of this viewport and the
   *  mirrored element under it (their stage puts the pointer on that same element) */
  const anchorOf = (p: Pt): Anchor => {
    const recorder = recorderRef.current;
    const sender = senderRef.current;
    // REQ-371 (demo m10) — from the hit-test stack, the demo's own pill skipped: a point under
    // the pill names the page's element under it, never an ancestor's box
    const out = anchorAt(
      p,
      viewportBox(),
      recorder && sender ? document.elementsFromPoint(p.x, p.y) : [],
      recorder,
      sender?.load ?? null,
    );
    sentRef.current = out; // REQ-305 — every anchor of this pointer goes out: the last one sent
    return out;
  };
  /** a presenter's pointer on this screen: on the element they point at when this page has it */
  const toScreen = (a: Anchor): Pt => {
    const recorder = recorderRef.current;
    const sender = senderRef.current;
    if (a.n && recorder && sender && a.n.l === sender.load) {
      const el = recorder.nodeOf(a.n.id);
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        return { x: r.left + r.width * a.n.x, y: r.top + r.height * a.n.y };
      }
    }
    return fracToPoint(a, viewportBox());
  };
  /** REQ-305 — where an anchor's pointer is drawn: on the window's edge, pointing outside, when
   *  the element it names is out of view; REQ-393 — and when the presenter's mouse is beside the
   *  frame on his stage (`o`: the anchor names the edge's point) */
  const placeOnScreen = (a: Anchor) =>
    placeIn(toScreen(a), viewportBox(), ARROW_BOX, a.o === 1);

  /** REQ-305 — this side's resting pointer, once more: a stage that was just handed a fresh
   *  snapshot (it joined, or asked for one) has not seen it — the stage's resendPointer, mirrored */
  const resendPointer = () => {
    const p = lastMoveRef.current;
    if (!p) return;
    linkRef.current?.send({ k: "move", a: anchorOf(p), t: performance.now() });
  };

  /** this side's moves, rated leading + trailing so the rest position always goes out */
  const throttle = useMemo(() =>
    moveThrottle<Pt>({
      gap: () =>
        linkRef.current?.isDirect() ? MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS,
      send: ({ x, y }) =>
        linkRef.current?.send(
          {
            k: "move",
            a: anchorOf({ x, y }),
            t: performance.now(),
          },
          true,
        ),
    }), []);

  /** AMENDMENT — same screen at once: the presenter's browser becomes the customer (impersonation,
   *  the first time) and goes to the stage (REQ-187), which shows the customer's page.
   *  REQ-232 — only when this page opened the demo, or its staff asked (Back to the demo). */
  async function placePresenter(d: Demo) {
    if (placingRef.current) return;
    placingRef.current = true;
    setPlacing(true);
    let moving = false;
    try {
      if (impersonatingRef.current === null) {
        impersonatingRef.current = await knowImpersonating();
      }
      if (impersonatingRef.current === false) {
        impersonatingRef.current = true;
        try {
          await adminClient.impersonate(d.targetUserId);
        } catch {
          impersonatingRef.current = false;
          return;
        }
        // REQ-301 (M18) — the whole browser is the customer now: every other /admin tab locks
        announceImpersonation({
          targetUserId: d.targetUserId,
          targetName: d.targetName,
        });
      }
      if (globalThis.location.pathname !== STAGE_PATH) {
        moving = true;
        // REQ-393 — the stage loads under a still mouse and gets no pointer event: it starts
        // where this page last saw the mouse (the click on Demo, Back to the demo)
        handCursor(sessionStore(), cursorRef.current);
        globalThis.location.assign(STAGE_PATH);
      }
    } finally {
      placingRef.current = false;
      // on its way: the pill keeps saying Opening… until the stage loads
      if (!moving) setPlacing(false);
    }
  }

  // REQ-393 — where this page's mouse is, for the stage placePresenter may open (a page that
  // loads under a still mouse hears nothing of it)
  useEffect(() => {
    if (inert) return;
    const seen = (e: PointerEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };
    const gone = () => {
      cursorRef.current = null;
    };
    const opts = { capture: true, passive: true };
    document.addEventListener("pointermove", seen, opts);
    document.addEventListener("pointerdown", seen, opts);
    document.documentElement.addEventListener("pointerleave", gone);
    return () => {
      document.removeEventListener("pointermove", seen, opts);
      document.removeEventListener("pointerdown", seen, opts);
      document.documentElement.removeEventListener("pointerleave", gone);
    };
  }, []);

  // 0. REQ-235 — a stage that ended its demo hands its presenter to /admin with who ended it: say
  //    it here, and take it out of the address (before the first ask reports where this app is)
  //    so a reload does not say it again
  useEffect(() => {
    if (inert || globalThis.location.pathname !== ADMIN_PATH) return;
    const got = readEndedNotice(globalThis.location.search);
    if (!got) return;
    setNotice(got.notice);
    history.replaceState(
      history.state,
      "",
      ADMIN_PATH + got.rest + globalThis.location.hash,
    );
  }, []);
  // REQ-235 — an end opens REQ-298's window (the notice up, or 30 s): the next demo is a restart
  useEffect(() => {
    if (notice) restartRef.current?.ended();
  }, [notice]);
  // REQ-235 — a new demo takes the notice's place; REQ-298 — a restart is SAID first, never a
  // silent swap: "{name} started a new demo" in the pill for a few seconds
  useEffect(() => {
    if (!demo) return;
    restartRef.current?.started(notice !== null);
    setNotice(null);
  }, [demo?.id]);
  useEffect(() => () => restartRef.current?.dispose(), []);

  // 1. is there a demo for this session? on load, again and again while this side is not connected
  //    to the other (REQ-378: each ask held until a demo opens), and when /admin opens one here. Every ask says where this app is. REQ-232 — the answer
  //    only REPORTS: a staff page goes to the stage when it opened the demo (the started event) or
  //    its staff click Back to the demo — never because a poll found the demo (demo-lifecycle-m3, M21).
  //    REQ-222 (M11): the schedule is the connection state's, not a chain's — see effect 1b.
  useEffect(() => {
    if (inert) return;
    let alive = true;
    const poller = activePoll({
      every: ACTIVE_POLL_MS,
      // REQ-378 (demo-loop cycle 2, m22) — the server holds a shown tab's ask until a demo opens
      // for it, so the customer's app hears of a new demo at once; the next ask goes out soon
      rest: ACTIVE_REASK_MS,
      connected: () => peerOnlineRef.current,
      ask: async () => {
        // signed out, or the backend is away: it throws, nothing to draw, ask again later. A
        // hidden tab never holds a connection (HTTP/1.1 allows six per host): it asks plainly
        const wait = document.visibilityState === "visible"
          ? ACTIVE_WAIT_MS
          : 0;
        const a = await demoModeClient.active({ path: here(), wait });
        if (!alive) return;
        if (a.session && a.role) {
          const found: Demo = { role: a.role, ...a.session };
          setDemo((d) => sameDemo(d, found) ? d : found);
        } else {
          setDemo(null);
        }
        setOpening(null);
      },
    });
    const check = () => poller.now();
    pollerRef.current = poller;
    pollRef.current = check;
    // REQ-299: shown again — a catch-up, unless the last ask is under 2 s old
    const onVisible = () => {
      if (document.visibilityState === "visible" && !peerOnlineRef.current) {
        poller.catchUp();
      }
    };
    // REQ-179 — Demo clicked here: say so at once and get whoami going; the answer then comes
    // straight in the started event (no second ask) and the presenter is placed from it
    const onOpening = (e: Event) => {
      const d = (e as CustomEvent).detail as { targetName?: string } | null;
      setOpening({ targetName: d?.targetName ?? "" });
      void knowImpersonating();
    };
    const onStarted = (e: Event) => {
      const d = (e as CustomEvent).detail as
        | (DemoStarted & { targetName?: string })
        | undefined;
      if (!d?.id) return void check();
      const found: Demo = {
        id: d.id,
        role: "presenter",
        presenterName: "",
        targetName: d.targetName ?? "",
        targetUserId: d.targetUserId,
        presenters: [],
      };
      setDemo((cur) => cur?.id === found.id ? cur : found);
      void placePresenter(found);
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    globalThis.addEventListener(DEMO_OPENING_EVENT, onOpening);
    globalThis.addEventListener(DEMO_STARTED_EVENT, onStarted);
    return () => {
      alive = false;
      pollRef.current = null;
      pollerRef.current = null;
      poller.stop();
      document.removeEventListener("visibilitychange", onVisible);
      globalThis.removeEventListener(DEMO_OPENING_EVENT, onOpening);
      globalThis.removeEventListener(DEMO_STARTED_EVENT, onStarted);
    };
  }, []);

  // 1b. REQ-222 (M11) — not connected (on load, the peer gone, the demo ENDED, the demo cleared):
  //     the poll is re-armed, so the next demo reaches this app within ACTIVE_POLL_MS, no reload
  useEffect(() => {
    if (!peerOnline) pollerRef.current?.idle();
  }, [peerOnline, demo?.id]);

  // 2. the link — the customer's side (the presenter's lives on the stage)
  useEffect(() => {
    if (!demo || demo.role !== "viewer") return;
    /** REQ-180 — the last move clock seen, per presenter */
    const lastT = new Map<string, number>();
    let wasOnline = false;
    /** REQ-214 — which presenter a message is from; one the roster does not know yet triggers a fresh ask */
    const who = (from: PeerFrom): string => {
      const known = demoRef.current?.presenters ?? [];
      const pid = from.pid ?? known[0]?.userId ?? "";
      if (pid && !known.some((p) => p.userId === pid)) pollRef.current?.();
      return pid;
    };
    const command = (pid: string, cmd: Omit<PointerCmd, "seq">) =>
      setCmds((c) => ({ ...c, [pid]: { seq: ++seq.current, ...cmd } }));
    /** REQ-305 — a presenter's pointer placed from its anchor, and where each was last placed */
    const placed = new Map<string, Pt & { outside: boolean }>();
    const place = (pid: string, a: Anchor, kind: "move" | "click") => {
      const p = placeOnScreen(a);
      placed.set(pid, { ...p.at, outside: p.outside });
      command(pid, { kind, at: p.at, outside: p.outside });
    };
    let raf = 0;
    /** REQ-305 — this page moved under the pointers (a scroll of any scroller, a resize, a change
     *  of the page), on the next frame: every presenter's arrow is placed again on its element, and
     *  this side's resting pointer goes out again when what is under the still cursor changed */
    const replace = () => {
      raf = 0;
      for (const [pid, a] of anchorsRef.current) {
        const p = placeOnScreen(a);
        const was = placed.get(pid);
        if (
          was && was.x === p.at.x && was.y === p.at.y &&
          was.outside === p.outside
        ) continue;
        place(pid, a, "move");
      }
      const rest = lastMoveRef.current;
      if (!rest || !linkRef.current) return;
      const was = sentRef.current;
      if (!sameAnchor(was, anchorOf(rest))) throttle.push(rest);
    };
    const shifted = () => {
      if (!raf) raf = requestAnimationFrame(replace);
    };
    // REQ-242 — this screen, recorded (paused until a presenter is there) and sent over the link;
    // REQ-391 — every frame stamped with the deploy's clock, so the stage can tell how late it is
    let link: DemoLink | null = null;
    const sender = createMirrorSender({
      send: (m) => link?.send(m),
      clock: () => link?.now() ?? Date.now(),
    });
    const recorder = createRecorder(document, {
      emit: (f) => {
        void sender.push(f);
        shifted(); // REQ-305 — the page changed: the pointers on it with it
      },
    });
    senderRef.current = sender;
    recorderRef.current = recorder;
    link = connectDemo({
      sessionId: demo.id,
      role: demo.role,
      onPresence: (pid, online) => {
        lastT.delete(pid); // their stage came or went: its clock starts over
        // a presenter who left takes their pointer along
        if (!online) {
          anchorsRef.current.delete(pid);
          placed.delete(pid);
          command(pid, { kind: "leave" });
        }
        pollRef.current?.();
      },
      onStatus: (s) => {
        setStatus(s);
        const online = s === "direct" || s === "relay";
        setPeerOnline(online);
        // REQ-295 — a stage that just arrived learns where this pill is
        if (online) sentPillRef.current = null;
        if (online) sendPillRef.current();
        // nobody watching: nothing to record
        if (!online) recorder.pause();
        // the other side dropped: ask the server again (the poll stops while connected)
        if (wasOnline && !online && s !== "ended") pollRef.current?.();
        wasOnline = online;
        if (s === "closed") {
          // refused or gone for good: ask the server what is true now
          demoModeClient.active().then((a) => {
            if (!a.session) setDemo(null);
          }).catch(() => setDemo(null));
        }
      },
      onPeerOnline: () => {
        // REQ-242 — a presenter joined: the whole screen at once, then every change; REQ-305 —
        // and this side's resting pointer, which their stage has not seen
        recorder.snapshot();
        resendPointer();
        // REQ-372 (cycle 2, m8) — and where this pill is and what it says: every sync or new
        // stage gets it, not only a change of link status
        sentPillRef.current = null;
        sendPillRef.current();
      },
      onPeer: (m: PeerMessage, from: PeerFrom) => {
        if (from.role !== "presenter") return;
        const pid = who(from);
        switch (m.k) {
          case "move":
            // REQ-180: a move that arrives after a later one is ignored; the rest glide
            if (!newerMove(lastT.get(pid) ?? 0, m.t)) break;
            lastT.set(pid, m.t ?? lastT.get(pid) ?? 0);
            anchorsRef.current.set(pid, m.a);
            place(pid, m.a, "move");
            break;
          case "click":
            anchorsRef.current.set(pid, m.a);
            place(pid, m.a, "click");
            break;
          case "leave":
            anchorsRef.current.delete(pid);
            placed.delete(pid);
            command(pid, { kind: "leave" });
            break;
          case "resync":
            // REQ-242 — a stage missed a frame: the whole screen again (REQ-305: and the pointer)
            recorder.snapshot();
            resendPointer();
            break;
        }
      },
      onEnded: (by, reason, pid) => {
        // REQ-235 — who ended it, in the pill's place at once, kept until dismissed
        // (REQ-296 — or that it expired)
        const d = demoRef.current;
        setNotice(whoEnded({ by, reason, pid }, {
          role: "viewer",
          presenters: d?.presenters ?? [],
          presenterName: d?.presenterName,
        }));
        anchorsRef.current.clear();
        setCmds({});
        setDemo(null);
      },
    });
    linkRef.current = link;
    // REQ-391 (M4 + m21) — what this page knows of what comes next: a page of the app (it saw the
    // navigation start) or none (closed, the address bar elsewhere)
    const hint = watchLeaveHint(globalThis as unknown as LeaveHintHost);
    // the page is going (a reload, another page): it says why first — the stage then waits for
    // its next page or says at once that it is waiting — and its pointer goes with it
    const onHide = () => {
      link?.leaving(hint.why());
      link?.send({ k: "leave" });
    };
    globalThis.addEventListener("pagehide", onHide);
    // REQ-305 — the page moves under the pointers: a scroll of any scroller, a resize, the body
    // growing (an image in, a panel opened)
    addEventListener("resize", shifted);
    document.addEventListener("scroll", shifted, {
      capture: true,
      passive: true,
    });
    const ro = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(shifted);
    ro?.observe(document.body);
    // REQ-232 (B3) — this tab is the one the customer is using: it claims the stage when it is in
    // front (now, if it is), gets focus or is clicked; a tab behind another says nothing
    const claim = () => link?.claim();
    const onVisible = () => {
      if (document.visibilityState === "visible") claim();
    };
    if (document.visibilityState === "visible") claim();
    globalThis.addEventListener("focus", claim);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerdown", claim, {
      capture: true,
      passive: true,
    });
    return () => {
      globalThis.removeEventListener("pagehide", onHide);
      hint.stop();
      globalThis.removeEventListener("focus", claim);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", claim, { capture: true });
      removeEventListener("resize", shifted);
      document.removeEventListener("scroll", shifted, { capture: true });
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      anchorsRef.current.clear();
      throttle.cancel();
      recorder.stop();
      recorderRef.current = null;
      senderRef.current = null;
      link?.close();
      linkRef.current = null;
      setCmds({});
      setPeerOnline(false);
      setStatus("connecting");
    };
  }, [demo?.id]);

  // 3. this side's pointer, document-wide (REQ-188: as a fraction of this viewport)
  useEffect(() => {
    if (!demo || demo.role !== "viewer") return;
    const onLeave = () => {
      touchFade.cancel();
      lastMoveRef.current = null;
      sentRef.current = null;
      linkRef.current?.send({ k: "leave" });
    };
    // REQ-371 (demo m10) — a touch has no pointerleave: a last tap stayed drawn on the stage like
    // a hover; it is let go a few seconds after the last touch
    const touchFade = createTouchFade({ ms: TOUCH_REST_MS, fade: onLeave });
    const onMove = (e: PointerEvent) => {
      touchFade.seen(e.pointerType);
      lastMoveRef.current = { x: e.clientX, y: e.clientY };
      if (linkRef.current) throttle.push({ x: e.clientX, y: e.clientY });
    };
    const onDown = (e: PointerEvent) => {
      touchFade.seen(e.pointerType);
      linkRef.current?.send({
        k: "click",
        a: anchorOf({ x: e.clientX, y: e.clientY }),
      });
    };
    document.addEventListener("pointermove", onMove, {
      capture: true,
      passive: true,
    });
    document.addEventListener("pointerdown", onDown, {
      capture: true,
      passive: true,
    });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      touchFade.cancel();
      document.removeEventListener("pointermove", onMove, { capture: true });
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [demo?.id]);

  // 4. REQ-379 — the phone pill's details, open or closed as this tab last left them: a reload
  //    must not flip them (the tab keeps that choice and nothing else)
  const openReadRef = useRef(false);
  useEffect(() => {
    const store = pillStore();
    if (!store) return;
    if (!openReadRef.current) {
      openReadRef.current = true;
      if (recallPillOpen(store)) setOpen(true);
      return;
    }
    rememberPillOpen(store, open);
  }, [open]);
  // REQ-440 — the tab keeps the choice the moment it is made: an effect runs only after the next
  // frame, and a reload right after the tap (REQ-379's story) outran it and lost the choice
  const toggleOpen = () => {
    const next = !open;
    const store = pillStore();
    if (store) rememberPillOpen(store, next);
    setOpen(next);
  };

  // 5. REQ-228 — the pill never covers the page; REQ-235 — the ended notice is a pill too.
  // REQ-379 — ONE home, bottom-left in a band reserved under the page (REQ-295's room, which the
  // shells now subtract like --banner-h): no slot hunt, no per-path memory, no compact <-> full
  // flip. The band follows the pill's own height; a dialog whose content is under the home docks
  // the pill at the top-left until it goes; the stage is told where the pill is
  const shown = !inert && Boolean(demo || opening || notice);
  useEffect(() => {
    if (!shown) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const roomOf = () => ({
      root: document.documentElement.style,
      body: document.body.style,
    });
    const room = (h: number) => {
      if (h === roomRef.current) return;
      roomRef.current = h;
      const { root, body } = roomOf();
      setPillRoom(root, body, h);
    };
    const sendPill = () => {
      const el = pillRef.current;
      const at = atRef.current;
      const r: Rect | null = el && at
        ? {
          left: at.left,
          top: at.top,
          width: el.offsetWidth,
          height: el.offsetHeight,
        }
        : null;
      // REQ-372 (cycle 2, m1) — what the pill says rides along: compact, open, status, text,
      // and whether it runs off this screen (clipped)
      const f = faceRef.current;
      const clipped = r
        ? pillOverflows(r, {
          w: globalThis.innerWidth,
          h: globalThis.innerHeight,
        }) ||
          (el !== null && el.scrollWidth > el.clientWidth + 1)
        : false;
      const face: PillFace = r
        ? {
          compact: f.compact,
          open: f.open,
          status: f.status,
          text: f.text,
          clipped,
        }
        : {};
      const faceKey = JSON.stringify(face);
      const was = sentPillRef.current;
      if (
        was && r && was.left === r.left && was.top === r.top &&
        was.width === r.width && was.height === r.height &&
        sentFaceRef.current === faceKey
      ) return;
      if (!was && !r) return;
      sentPillRef.current = r;
      sentFaceRef.current = faceKey;
      linkRef.current?.send({ k: "pill", r, ...face });
    };
    sendPillRef.current = sendPill;
    const place = () => {
      const el = pillRef.current;
      if (!el) return;
      // REQ-300 — End's question is up: nothing moves, so the Yes a hand is reaching for stays
      // where it was seen — nor does the page under it (the band keeps its height)
      if (el.querySelector('[data-cy="demo-end-ask"]')) return;
      // REQ-379 — the compact form follows the window across PILL_COMPACT_MAX_W, both ways
      setCompact(narrow());
      // the visible bottom: above an iOS keyboard, like the shells' --vvh (MobileViewport)
      const vv = globalThis.visualViewport;
      const view = {
        w: globalThis.innerWidth,
        h: vv ? vv.offsetTop + vv.height : globalThis.innerHeight,
      };
      // its own size: nothing measured is ever written back into its style (M6's min-width loop)
      const home = pillHome({
        view,
        size: { w: el.offsetWidth, h: el.offsetHeight },
      });
      room(home.room);
      // REQ-440 (cycle 3, m2) — the band is painted in the page's own background, so a document
      // that scrolls goes under the band's edge, never under the pill
      setBandBg(bandBackground(bandColors(view)));
      // REQ-379 — a dialog is up: out of its content (REQ-300 froze the pill over it instead)
      const box = typeof document.elementsFromPoint === "function" &&
          dialogBackdropUp()
        ? dockPill({ home: home.box, view, top: bannerH(), blocked: pageUnder })
        : home.box;
      setDock(Math.round(box.top - home.box.top));
      atRef.current = { left: box.left, top: box.top };
      sendPill();
    };
    const later = () => {
      clearTimeout(settle);
      settle = setTimeout(place, 150);
    };
    // REQ-379 — across PILL_COMPACT_MAX_W the form switches at once (a tap right after the
    // resize finds the phone's pill), then the band is measured again
    const onResize = () => {
      setCompact(narrow());
      later();
    };
    place();
    const timer = setInterval(place, PILL_CHECK_MS);
    addEventListener("resize", onResize);
    const ro = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(later);
    if (pillRef.current) ro?.observe(pillRef.current);
    return () => {
      clearInterval(timer);
      clearTimeout(settle);
      ro?.disconnect();
      removeEventListener("resize", onResize);
      sendPillRef.current = () => {};
      if (roomRef.current) {
        roomRef.current = 0;
        const { root, body } = roomOf();
        clearPillRoom(root, body);
      }
      // the pill is gone (or re-mounted): the stage drops its ghost
      if (sentPillRef.current) {
        sentPillRef.current = null;
        linkRef.current?.send({ k: "pill", r: null });
      }
    };
  }, [shown, demo?.role]);

  // REQ-372 — the pill's words changed (status, compact, opened): the stage hears it; a render that
  // changed nothing sends nothing (sendPill compares)
  useEffect(() => {
    sendPillRef.current();
  });

  if (inert) return null;

  // REQ-379 — ONE home: bottom-left in the band reserved under the page, its bottom on the visible
  // bottom (above an iOS keyboard, like the shells' --vvh); a dialog over the home docks it (a
  // glide). No measure is written back: it is as wide as its content, capped by the window. Its
  // empty area lets a click through to the page (M28): only its buttons (HIT) take one
  const at =
    `left:${PILL_MARGIN}px;bottom:calc(100% - var(--vvt, 0px) - var(--vvh, 100%) + ${PILL_BAND_GAP}px);transform:translateY(${dock}px);transition:transform ${PILL_MOVE_MS}ms ease`;
  const pillStyle = `position:fixed;${at};z-index:${
    Z + 3
  };display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:nowrap;white-space:nowrap;max-width:calc(100vw - ${
    2 * PILL_MARGIN
  }px);box-sizing:border-box;padding:7px 12px;border-radius:14px;background:#1f3d1b;color:#fff;font-family:${PILL_FONT};font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.35);pointer-events:none`;
  // REQ-440 (demo-loop cycle 3, m2) — the band reserved for the pill (REQ-379), made real on a page
  // whose document scrolls: window-wide, the band's height (0 with no room), opaque in the page's
  // own background. z-index 1: over the page's flow, under its own fixed layers (a dialog's
  // backdrop, a toast); it never takes a click
  const bandStyle =
    `position:fixed;left:0;right:0;bottom:0;height:var(--demo-pill-h, 0px);z-index:1;background:${bandBg};pointer-events:none`;
  const band = <div data-cy="demo-band" aria-hidden="true" style={bandStyle} />;
  /** one line: a long name is cut, not wrapped (the live pill's rule, REQ-228) */
  const cut = "overflow:hidden;text-overflow:ellipsis;min-width:0";
  // REQ-294 (demo m21) — the words that carry a name wrap to as many lines as it needs: the ended
  // notice always, the phone's details once opened; the title goes on a phone
  const wrap = "white-space:normal;min-width:0;overflow-wrap:anywhere";

  // REQ-235 — the demo is over: who ended it, in the pill's place, until dismissed (Demo clicked
  // here again takes over)
  if (notice && !opening) {
    const said = endedText(notice);
    faceRef.current = {
      compact,
      open: false,
      status: "ended",
      text: t(said.key, said.vars),
    };
    return (
      <div data-demo-overlay>
        {band}
        <div
          ref={pillRef}
          data-cy="demo-ended"
          role="status"
          style={pillStyle}
        >
          {!compact && <strong>{t("demoMode.title")}</strong>}
          <span style={wrap}>{t(said.key, said.vars)}</span>
          <button
            type="button"
            data-cy="demo-ended-dismiss"
            aria-label={t("demoMode.dismiss")}
            title={t("demoMode.dismiss")}
            onClick={() => setNotice(null)}
            style={`padding:0 6px;border:0;background:transparent;color:#fff;cursor:pointer;font:inherit;font-size:18px;line-height:1;opacity:.85;${HIT}`}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  if (!demo) {
    if (!opening) return null;
    faceRef.current = {
      compact: false,
      open: false,
      status: "connecting",
      text: t("demoMode.presenting", { name: opening.targetName }),
    };
    // REQ-179 — Demo was just clicked: the pill is up before the server answers
    return (
      <div data-demo-overlay>
        {band}
        <div
          ref={pillRef}
          data-cy="demo-pill"
          role="status"
          style={pillStyle}
        >
          <strong>{t("demoMode.title")}</strong>
          <span style={cut}>
            {t("demoMode.presenting", { name: opening.targetName })}
          </span>
          <span
            data-cy="demo-opening"
            style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"
          >
            {t("demoMode.opening")}
          </span>
        </div>
      </div>
    );
  }

  // the presenter's own pill lives on the stage. On the way there, say so; on any other staff page
  // (REQ-232: another window, /admin after Return to your account) offer the way back — never take it
  if (demo.role === "presenter") {
    return (
      <div data-demo-overlay>
        {band}
        <div
          ref={pillRef}
          data-cy="demo-pill"
          role="status"
          style={pillStyle}
        >
          <strong>{t("demoMode.title")}</strong>
          <span style={cut}>
            {t("demoMode.presenting", { name: demo.targetName })}
          </span>
          {placing || opening
            ? (
              <span
                data-cy="demo-opening"
                style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"
              >
                {t("demoMode.opening")}
              </span>
            )
            : (
              <button
                type="button"
                data-cy="demo-rejoin"
                onClick={() => void placePresenter(demo)}
                style={`padding:5px 12px;border-radius:8px;border:0;background:#fff;color:#1f3d1b;cursor:pointer;font:inherit;font-size:12px;font-weight:700;${HIT}`}
              >
                {t("demoMode.rejoin")}
              </button>
            )}
        </div>
      </div>
    );
  }

  // REQ-214 — the presenters, by name; a demo written before the list has the one
  const presenters: Presenter[] = demo.presenters.length > 0
    ? demo.presenters
    : [{ userId: "", name: demo.presenterName, color: "#2f6d29" }];
  const names = presenters.map((p) => p.name).join(", ");
  const guidingText = presenters.length > 1
    ? t("demoMode.guidingMany", { names })
    : t("demoMode.guiding", { name: names });
  // REQ-298 — just restarted: the line says so (and the pill pulses) before "is guiding you"
  const started = fresh
    ? startedText(demo.presenters, demo.presenterName)
    : null;
  const line = started ? t(started.key, started.vars) : guidingText;
  // REQ-232 (demo-lifecycle-p1) — plain words: is the staff here or not; never how the bytes travel
  const statusLabel = status === "ended"
    ? t("demoMode.ended")
    : status === "direct" || status === "relay"
    ? t("demoMode.connected")
    : t("demoMode.connecting");
  // REQ-372 — what this pill shows, for the stage's replica
  faceRef.current = {
    compact,
    open: compact && open,
    status: status === "ended"
      ? "ended"
      : status === "direct" || status === "relay"
      ? "live"
      : "connecting",
    text: line,
  };
  // REQ-373 (demo m2, p13-h) — the guide's first name on the compact pill; the name said once
  const copy = pillCopy({ presenters, status: statusLabel, compact, open, t });
  /** REQ-373 — "● Alex" beside the status while the details are hidden */
  const showGuide = copy.showShort && !started;

  async function end() {
    const id = demo!.id;
    linkRef.current?.end();
    // REQ-235 + REQ-179 — said at once, before the server answers; the link stays up until the
    // server has it, so the presenters hear `ended` before this side's socket goes
    setNotice({ by: "you" });
    try {
      await demoModeClient.end(id);
    } catch {
      // the socket's end reaches the server too; either way this side is done
    }
    setDemo(null);
  }

  return (
    <div data-demo-overlay>
      {band}
      {presenters.map((p) => (
        <PeerPointer
          key={p.userId}
          name={p.name}
          color={p.color}
          z={Z + 1}
          cmd={cmds[p.userId] ?? null}
          bounds={viewportBox()}
        />
      ))}
      {started && (
        <style>
          {`@keyframes pmDemoPulse{0%{box-shadow:0 4px 18px rgba(0,0,0,.35),0 0 0 0 rgba(255,255,255,.75)}100%{box-shadow:0 4px 18px rgba(0,0,0,.35),0 0 0 14px rgba(255,255,255,0)}}`}
        </style>
      )}
      <div
        ref={pillRef}
        data-cy="demo-pill"
        data-restarted={started ? "" : undefined}
        role="status"
        style={(started
          ? `${pillStyle};animation:pmDemoPulse 1.1s ease-out 3`
          : pillStyle) + (compact && open ? ";flex-wrap:wrap" : "")}
      >
        <span
          data-cy="demo-details"
          // REQ-298 — a restart is said even on the phone's compact pill
          style={`display:${
            compact && !open && !started ? "none" : "inline-flex"
          };gap:10px;align-items:center;${
            compact ? `flex-basis:100%;${wrap}` : cut
          }`}
        >
          {!compact && <strong>{t("demoMode.title")}</strong>}
          {started
            ? (
              <span data-cy="demo-restarted" style={compact ? wrap : cut}>
                {line}
              </span>
            )
            : <span style={compact ? wrap : cut}>{guidingText}</span>}
          {copy.showChips && <PresenterChips presenters={presenters} nowrap />}
        </span>
        {showGuide && (
          <span
            data-cy="demo-guide"
            style={`display:inline-flex;align-items:center;gap:6px;${cut}`}
          >
            <span
              aria-hidden="true"
              style={`flex:none;width:10px;height:10px;border-radius:50%;background:${
                presenters[0].color
              };box-shadow:0 0 0 2px rgba(255,255,255,.85)`}
            />
            <span style={cut}>{copy.shortName}</span>
          </span>
        )}
        <button
          type="button"
          data-cy="demo-more"
          aria-expanded={!compact || open}
          aria-label={copy.moreLabel}
          onClick={toggleOpen}
          style={`display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:${
            compact ? "pointer" : "default"
          };${HIT}`}
        >
          {compact && !showGuide && (
            <span
              aria-hidden="true"
              style={`width:10px;height:10px;border-radius:50%;background:${
                presenters[0].color
              };box-shadow:0 0 0 2px rgba(255,255,255,.85)`}
            />
          )}
          <span
            data-cy="demo-status"
            style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"
          >
            {statusLabel}
          </span>
        </button>
        {/* REQ-235 — End asks first */}
        <EndDemo onEnd={end} />
      </div>
    </div>
  );
}
