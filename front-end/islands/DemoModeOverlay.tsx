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
 * REQ-451 (demo-loop cycle 3, M1 + M14) — a presenter's arrow is what he pointed at: drawn on that
 * element only, and hidden while this page has no such element (another page load, the element
 * gone or not laid out) — never at the fraction it had, which is over something else now. His
 * pointer off this screen (`o: 1`) is a small marker on the edge, no name tag.
 * REQ-535 (demo-loop cycle 4, m13) — the customer's pill survives a page load (every link is a
 * full load): the tab keeps its demo and whether its page was connected (pill-carry.ts); the next
 * page draws the pill from it at once, and after a load from a connected page keeps saying
 * Connected for a ~5 s grace while its own link comes up — "Connecting…" only if it does not.
 * REQ-645 (demo-loop cycle 5, M1 + M2 + c4-M6) — a presenter's element out of view is a small
 * chevron at the edge of the box it can be seen in (the page's scroller under its topbar, the
 * screen above the pill's band — `visibleBox`), with the way to it in words ("Hans is pointing
 * below — scroll ↓") — never an arrow clamped onto the window's edge over the topbar's search
 * bar or the strip under the footer; an arrow whose element moved more than DRIFT_FADE_PX since he
 * pointed is faded (`drifted`); `pending` (his pointer being found again) says "Hans is
 * pointing…" near its fraction, no arrow.
 * REQ-647 (demo-loop cycle 5, m29 + m23 + c2-p13-r) — the end is said however it is learned: the
 * /active poll answering null, a socket closed for good (`demoGone`) turn the pill into "The demo
 * ended" like the `ended` frame does, and open REQ-298's restart window; the tab carries the
 * notice to its next page (pill-carry.ts keepEnded). "{name} started a new demo" stays ~10 s or
 * until the customer acts. /admin's handover notice comes in as a prop (`endedNotice`, read by
 * _app on the server), so it is painted on first paint, hydrated or not.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { demoChromeT as t } from "../lib/demo-chrome-t.ts";
import { fenceClicks } from "../lib/backdrop-dismiss.ts";
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
  anchorPoint,
  type ClipNode,
  type ClipStyle,
  cueKey,
  drifted,
  placeView,
  placedReport,
  placedReporter,
  OFF_MARK_Z,
  pointInBox,
  visibleBox,
} from "../../shared/demo-mode/presenter-anchor.ts";
import { anchorFrame } from "../../shared/demo-mode/customer-pointer.ts";
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
import { demoEligible, viewerTab } from "../../shared/demo-mode/tab.ts";
import {
  connectDemo,
  type ClaimHow,
  type DemoLink,
  type LinkStatus,
  type PeerFrom,
} from "../lib/demo-mode/transport.ts";
import { demoTabKey } from "../lib/demo-mode/tab-key.ts";
import { takeEarlyLink } from "../lib/demo-mode/early-link.ts";
import {
  carriedDemo,
  carriedEnded,
  forgetDemo,
  keepDemo,
  keepEnded,
  PILL_CARRY_GRACE_MS,
  showsConnected,
} from "../lib/demo-mode/pill-carry.ts";
import {
  browserStore,
  loadClaim,
  newestInput,
  noteInput,
  takeSelfReload,
} from "../lib/demo-mode/tab-claim.ts";
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
  goneNotice,
  readEndedNotice,
  whoEnded,
} from "../../shared/demo-mode/ended.ts";
import {
  backdropCovers,
  coversView,
  CONTROL_SELECTOR,
  countsAsPage,
  dialogDim,
  isPublicDocPath,
  PAGE_MEDIA_SELECTOR,
  PILL_BAND_GAP,
  PILL_COMPACT_MAX_W,
  PILL_FONT,
  PILL_MARGIN,
  PILL_MOVE_MS,
  PILL_PEEK_MS,
  PILL_TAB,
  PILL_UNDER_DIALOG_OPACITY,
  pillHome,
  pillOverflows,
  pillStore,
  pillWraps,
  placePill,
  seeThrough,
  recallPillOpen,
  rememberPillOpen,
  samplePoints,
  tabBox,
} from "../../shared/demo-mode/pill.ts";
import { pillCopy } from "../../shared/demo-mode/pill-copy.ts";
import type { PillFace, Rect } from "../../shared/demo-mode/protocol.ts";

// REQ-494 / REQ-544 — `t` is the demo chrome's (lib/demo-chrome-t.ts): on /worker it keeps
// the viewer's stored language, not the signed-in worker's.

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
/** REQ-536 — the customer pill's status chip ("Connected"), in the toggle or on its own */
const STATUS_CHIP =
  "padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700";

const here = () => globalThis.location.pathname + globalThis.location.search;
/** REQ-379 — how often the pill looks for a dialog over its home (it never hunts for a spot) */
const PILL_CHECK_MS = 700;

/**
 * REQ-300 (demo M20) — an open dialog's backdrop: a fixed box over the whole view under the view's
 * centre (the demo's own chrome not counted). REQ-379 — while it is up, a pill whose home has the
 * dialog's content under it docks at the top-left (`dockPill`) instead of staying frozen over it.
 */
/** REQ-643 — a dialog box that covers the view itself (a full-screen sheet with no dim) */
const MODAL_SELECTOR =
  'dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
function dialogBackdropUp(band = 0): Element | null {
  const view = { w: globalThis.innerWidth, h: globalThis.innerHeight };
  // REQ-643 (demo-loop cycle 5, p18-3d) — down to the band: on a phone the backdrop sits in the
  // transformed mobile .app, so it ends at the band's top and was never seen as a dialog
  return document.elementsFromPoint(view.w / 2, view.h / 2)
    .filter((el) => !el.closest("[data-demo-overlay]"))
    .find((el) => {
      if (el === document.documentElement || el === document.body) {
        return false;
      }
      const cs = getComputedStyle(el);
      // a dialog's layer: its dim, or the dialog itself — never the phone's fixed .app shell
      return cs.position === "fixed" &&
        backdropCovers(el.getBoundingClientRect(), view, band) &&
        (seeThrough(cs.backgroundColor) || el.matches(MODAL_SELECTOR));
    }) ?? null;
}

/**
 * REQ-637 (demo-loop cycle 5, m5) — the open dialog's own box (its panel: the innermost dialog
 * element under the view's centre that does not cover the whole view — a wrapper that does is the
 * backdrop), so the pill can dock just above it. None found: undefined.
 */
function dialogPanel(): Rect | undefined {
  const view = { w: globalThis.innerWidth, h: globalThis.innerHeight };
  for (const el of document.elementsFromPoint(view.w / 2, view.h / 2)) {
    if (el.closest("[data-demo-overlay]")) continue;
    const d = el.closest(
      'dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]',
    );
    if (!d) continue;
    const r = d.getBoundingClientRect();
    const box = { left: r.left, top: r.top, width: r.width, height: r.height };
    if (box.width > 0 && box.height > 0 && !coversView(box, view)) return box;
  }
  return undefined;
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

/** REQ-781 (demo-loop cycle dv1, d7) — how many controls of the page (links, buttons, fields:
 *  CONTROL_SELECTOR) are under a box: a floating pill may cover text, never one of these */
function countControls(r: Rect): number {
  const found = new Set<Element>();
  for (
    const { x, y } of samplePoints(r, Math.max(5, Math.ceil(r.width / 40)), 3)
  ) {
    const top = document.elementsFromPoint(x, y)
      .find((el) => !el.closest("[data-demo-overlay]"));
    const c = top?.closest(CONTROL_SELECTOR);
    if (c) found.add(c);
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
/** REQ-645 — what `visibleBox` reads of an element's computed style */
const styleOf = (e: ClipNode): ClipStyle | null => {
  try {
    const cs = getComputedStyle(e as unknown as Element);
    return {
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      position: cs.position,
    };
  } catch {
    return null;
  }
};

export default function DemoModeOverlay(
  props: {
    /** REQ-647 (cycle 5, c2-p13-r) — /admin's handover notice, read by _app on the server */
    endedNotice?: EndedNotice | null;
  } = {},
) {
  /** M5 — in a nested frame (an app page embedded in a page), or on the stage: never part of the demo;
   *  REQ-217 — the worker portal never takes part */
  const inert = typeof globalThis.location !== "undefined" &&
    (globalThis.top !== globalThis.self ||
      globalThis.location.pathname === STAGE_PATH ||
      !demoEligible(globalThis.location.pathname));
  /** REQ-217 — only the tab the customer is looking at asks, joins and reports */
  const [visible, setVisible] = useState(true);
  const [demo, setDemo] = useState<Demo | null>(null);
  /** REQ-179 — Demo was just clicked on /admin: the pill says Opening… until the server answers */
  const [opening, setOpening] = useState<{ targetName: string } | null>(null);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [peerOnline, setPeerOnline] = useState(false);
  /** REQ-535 — this page loaded from a connected one: Connected for a grace while the link comes up */
  const [carrying, setCarrying] = useState(false);
  /** REQ-214 — the latest thing each presenter did, by pid */
  const [cmds, setCmds] = useState<Record<string, PointerCmd>>({});
  const seq = useRef(0);
  /** REQ-235 — the demo is over: who ended it, said until dismissed (or a new demo starts) */
  //    REQ-647 — /admin's handover is painted from the first (server) render
  const [notice, setNotice] = useState<EndedNotice | null>(
    () => props.endedNotice ?? null,
  );
  /** REQ-647 (cycle 5, m29) — what /active last said of this tab's demo: null, not asked yet */
  const [activeOk, setActiveOk] = useState<boolean | null>(null);
  /** REQ-298 — the demo that just arrived is a restart: the pill says so for a few seconds */
  const [fresh, setFresh] = useState(false);
  const restartRef = useRef<RestartNotice | null>(null);
  if (!restartRef.current) {
    restartRef.current = restartNotice({ onChange: setFresh });
  }
  const linkRef = useRef<DemoLink | null>(null);
  /** REQ-228 — the pill, where it sits, and whether it is the phone's compact one */
  const pillRef = useRef<HTMLDivElement | null>(null);
  /** REQ-379 — how far from its home a dialog docked the pill (0: home); a move glides.
   *  REQ-545 (cycle 4, m2) — across too: the top-right is the third place */
  const [dock, setDock] = useState({ x: 0, y: 0 });
  /** REQ-545 — where the visible pill (or its tab) is, as told to the stage */
  const atRef = useRef<{ left: number; top: number; tab: boolean } | null>(
    null,
  );
  /** REQ-545 (demo-loop cycle 4, m2) — the pill yielded to the page: only its edge tab shows.
   *  REQ-637 (cycle 5, m5) — never from the first render on a public /q /i /co page: the whole
   *  pill sits on its strip there */
  const [tucked, setTucked] = useState(false);
  /** REQ-637 — the mini-pill's × (End) was tapped: the whole pill comes out with End asking */
  const [askEnd, setAskEnd] = useState(false);
  /** REQ-545 — the tab hovered or tapped: the whole pill shows, at home, until it is left */
  const [peek, setPeek] = useState(false);
  const peekRef = useRef(false);
  peekRef.current = peek;
  const tuckedRef = useRef(tucked);
  tuckedRef.current = tucked;
  /** REQ-545 — the pill's own size when last shown whole (folded to its tab, its home is still
   *  where the whole pill would sit) */
  const fullRef = useRef<{ w: number; h: number } | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /** REQ-545 — what the stage is told of the strip under the pill. REQ-781 (cycle dv1, d7): no
   *  band is kept any more (h 0); a folded pill and a dialog's dim still ride along */
  const bandRef = useRef<
    { h: number; bg: string; tucked: boolean; dim?: string }
  >({ h: 0, bg: "#fff", tucked: false });
  const placeRef = useRef<() => void>(() => {});
  /** REQ-545 — only the customer's live pill yields to the page; the ended notice (a message to
   *  read and dismiss), Opening… and the presenter's way back stay home (a dialog still docks) */
  const yieldsRef = useRef(false);
  /** REQ-643 (demo-loop cycle 5, m9) — the ended notice floats: it reserves no band */
  const floatsRef = useRef(false);
  /** REQ-379 — the phone's compact form from the first render: a full-size first measure is what
   *  grew to a 400 px pill on a 390 px phone (M6) */
  const [compact, setCompact] = useState(narrow);
  /** REQ-781 (cycle dv1, d7) — where the folded mini-pill sits: its offset from the left edge's
   *  spot (`tabBox`; x > 0: the right edge) */
  const [tabAt, setTabAt] = useState({ x: 0, y: 0 });
  /** REQ-765 (cycle 5v2, p18-3d) — a dialog's dim is up: the pill is softened under it */
  const [underDim, setUnderDim] = useState(false);
  /** REQ-295 — the pill's box as last told to the stage */
  const sentPillRef = useRef<Rect | null>(null);
  const sendPillRef = useRef<() => void>(() => {});
  /** REQ-372 — what the pill shows right now (set each render), and as last told to the stage */
  const faceRef = useRef<PillFace>({});
  const sentFaceRef = useRef<string>("");
  const [open, setOpen] = useState(false);
  /** REQ-548 — End is asking (the compact pill gives the question its own row) */
  const [asking, setAsking] = useState(false);
  // REQ-637 (cycle 5, m5) — End asked out of the mini-pill's ×: spent (a later peek is a plain one)
  useEffect(() => {
    if (asking) setAskEnd(false);
  }, [asking]);
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
    const made = anchorAt(
      p,
      viewportBox(),
      recorder && sender ? document.elementsFromPoint(p.x, p.y) : [],
      recorder,
      sender?.load ?? null,
    );
    // REQ-639 (cycle 5, c3-M6) — the frame that carries this screen: the stage draws the pointer
    // only once its replay has it, never on an older frame where the spot is another chip
    const f = made.n && recorder && sender
      ? anchorFrame(
        sender.pushed(),
        recorder.waiting(),
      )
      : null;
    const out = made.n && f !== null ? { ...made, n: { ...made.n, f } } : made;
    sentRef.current = out; // REQ-305 — every anchor of this pointer goes out: the last one sent
    return out;
  };
  /** REQ-437 — the box of the element a presenter's anchor names, when this page has it */
  const rectOnScreen = (a: Anchor): Rect | null => {
    const recorder = recorderRef.current;
    const sender = senderRef.current;
    if (!a.n || !recorder || !sender || a.n.l !== sender.load) return null;
    const r = recorder.nodeOf(a.n.id)?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : null;
  };
  /** REQ-645 — this screen as a presenter's arrow may be drawn on it: the window above the pill's
   *  band (nothing of the page shows under it) */
  const screenBox = (): Rect => {
    const v = viewportBox();
    return { ...v, height: Math.max(1, v.height - bandRef.current.h) };
  };
  /** REQ-645 — the element of this page a presenter's anchor names, while it is in the page */
  const elOf = (a: Anchor): Element | null => {
    const recorder = recorderRef.current;
    const sender = senderRef.current;
    if (!a.n || !recorder || !sender || a.n.l !== sender.load) return null;
    const el = recorder.nodeOf(a.n.id);
    return el?.isConnected ? el : null;
  };
  /** a presenter's pointer on this screen: on the element they point at when this page has it;
   *  REQ-451 (M1) — else nowhere (null): another page load, the element left the page or is not
   *  laid out — never the fraction it had, which is over something else now */
  const toScreen = (a: Anchor): Pt | null => {
    const recorder = recorderRef.current;
    const sender = senderRef.current;
    return anchorPoint(a, viewportBox(), sender?.load ?? null, (n) => {
      const el = recorder ? recorder.nodeOf(n.id) : null;
      return el?.isConnected ? pointInBox(n, el.getBoundingClientRect()) : null;
    });
  };
  /** REQ-305 — where an anchor's pointer is drawn; REQ-393 — the presenter's mouse beside the
   *  frame on his stage (`o`: the anchor names the edge's point): on this screen's edge;
   *  REQ-451 — null: not drawn. REQ-645 (cycle 5 M1, c4-M6) — an element out of view: at the
   *  edge of the box it CAN be seen in (`visibleBox`: its scroller, under the topbar, above the
   *  pill's band) with the way to it (`dir`: a chevron and a cue) — never the window's edge over
   *  the topbar's search bar or the strip under the footer */
  const placeOnScreen = (a: Anchor) => {
    const p = toScreen(a);
    if (!p) return null;
    const el = a.o === 1 ? null : elOf(a);
    if (el) {
      const box = visibleBox(el as unknown as ClipNode, screenBox(), styleOf);
      return { ...placeView(p, box), box };
    }
    // his mouse beside the frame (REQ-393), a bare fraction: as before
    const box = viewportBox();
    return {
      ...placeIn(p, viewportBox(), ARROW_BOX, a.o === 1),
      dir: null,
      box,
    };
  };

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
        // where this page last saw the mouse (the click on Demo, Back to the demo); REQ-539 (m24)
        // — tagged /admin's: the stage uses it for its off hint only, never sends it
        handCursor(sessionStore(), cursorRef.current, Date.now(), "admin");
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

  // REQ-535 (cycle 4, m13) — the demo this tab was in a moment ago, drawn at once (before the first
  // /active answers); a load from a connected page keeps the Connected face for the grace
  useLayoutEffect(() => {
    if (inert) return;
    // REQ-647 (cycle 5, m29) — the last page saw the demo end: still said here
    const ended = carriedEnded(sessionStore(), Date.now());
    if (ended) {
      setNotice((n) => n ?? ended);
      return;
    }
    const carried = carriedDemo(sessionStore(), Date.now());
    if (!carried || carried.demo.role !== "viewer") return;
    setDemo(carried.demo);
    if (!carried.connected) return;
    setCarrying(true);
    const grace = setTimeout(() => setCarrying(false), PILL_CARRY_GRACE_MS);
    return () => clearTimeout(grace);
  }, []);
  // REQ-535 — the link is up on its own: the grace has done its job (a drop after this is said)
  useEffect(() => {
    if (status === "direct" || status === "relay") setCarrying(false);
  }, [status]);
  // REQ-535 — the tab keeps its demo and whether it is connected; a demo gone is forgotten. As the
  // page goes it says so last (a socket closing under the unload is not "disconnected")
  const hadDemoRef = useRef(false);
  const goneRef = useRef(false);
  useEffect(() => {
    if (inert || goneRef.current) return;
    if (demo?.role === "viewer") {
      hadDemoRef.current = true;
      keepDemo(sessionStore(), demo, peerOnline, Date.now());
    } else if (!demo && hadDemoRef.current) {
      hadDemoRef.current = false;
      // REQ-647 (cycle 5, m29) — an end is carried to the next page; a demo gone unsaid is not
      if (notice) keepEnded(sessionStore(), notice, Date.now());
      else forgetDemo(sessionStore());
    }
  }, [demo, peerOnline, notice]);
  useEffect(() => {
    if (inert) return;
    const keepOnHide = () => {
      const d = demoRef.current;
      if (d?.role === "viewer") {
        keepDemo(sessionStore(), d, peerOnlineRef.current, Date.now());
      }
      goneRef.current = true;
    };
    // back from the back/forward cache: this page is live again
    const liveAgain = () => {
      goneRef.current = false;
    };
    globalThis.addEventListener("pagehide", keepOnHide);
    globalThis.addEventListener("pageshow", liveAgain);
    return () => {
      globalThis.removeEventListener("pagehide", keepOnHide);
      globalThis.removeEventListener("pageshow", liveAgain);
    };
  }, []);
  // REQ-549 (cycle 4, S4) — did the app reload this page on its own (a public page re-reading the
  // server)? Taken once per page; such a page never claims the stage without the customer's input
  const selfReloadRef = useRef<boolean | null>(null);
  const cameBySelfReload = () => {
    if (selfReloadRef.current === null) {
      selfReloadRef.current = !inert &&
        takeSelfReload(browserStore("session"));
    }
    return selfReloadRef.current;
  };
  // REQ-549 — every press or key in this tab, demo or not, says "the customer is in this tab" to
  // the browser's other tabs: at a demo's start only the tab used last claims
  useEffect(() => {
    if (inert) return;
    cameBySelfReload();
    const tab = demoTabKey(sessionStore());
    const used = () => {
      selfReloadRef.current = false;
      noteInput(browserStore("local"), tab);
    };
    const opts = { capture: true, passive: true };
    document.addEventListener("pointerdown", used, opts);
    document.addEventListener("keydown", used, opts);
    return () => {
      document.removeEventListener("pointerdown", used, opts);
      document.removeEventListener("keydown", used, opts);
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
  // REQ-647 (cycle 5, m23) — the customer pressed or typed in the page: "started a new demo" has
  // been read. A press on the pill itself (End, the details) is not: the line stays while they act
  useEffect(() => {
    if (inert || !fresh) return;
    const read = (e: Event) => {
      const at = e.target as Element | null;
      if (at?.closest?.("[data-demo-overlay]")) return;
      restartRef.current?.touched();
    };
    const opts = { capture: true, passive: true };
    document.addEventListener("pointerdown", read, opts);
    document.addEventListener("keydown", read, opts);
    return () => {
      document.removeEventListener("pointerdown", read, opts);
      document.removeEventListener("keydown", read, opts);
    };
  }, [fresh]);
  /**
   * REQ-647 (cycle 5, m29) — the demo is gone and no `ended` frame said so (the poll answered
   * null, the socket closed for good): said like any end — the notice in the pill's place (one
   * already up is kept), REQ-298's window opened — never a silent vanish
   */
  function demoGone() {
    const had = demoRef.current !== null;
    setActiveOk(false);
    if (had) {
      console.info("[demo] gone without an ended frame", {
        id: demoRef.current?.id,
      });
      restartRef.current?.ended();
      setNotice((n) => goneNotice(true, n));
      anchorsRef.current.clear();
      setCmds({});
    }
    setDemo(null);
  }

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
        // REQ-217 — a hidden tab asks nothing and says nothing; it picks up again when looked at
        if (!viewerTab(document.visibilityState)) return;
        // signed out, or the backend is away: it throws, nothing to draw, ask again later. A
        // hidden tab never holds a connection (HTTP/1.1 allows six per host) — REQ-217: it does
        // not ask at all (above), so a visible one holds the ask
        const wait = document.visibilityState === "visible"
          ? ACTIVE_WAIT_MS
          : 0;
        const a = await demoModeClient.active({ path: here(), wait });
        if (!alive) return;
        if (a.session && a.role) {
          const found: Demo = { role: a.role, ...a.session };
          setActiveOk(true);
          setDemo((d) => sameDemo(d, found) ? d : found);
        } else {
          // REQ-647 — a demo this page had (or carried in) is over: said, not dropped
          demoGone();
        }
        setOpening(null);
      },
    });
    const check = () => poller.now();
    pollerRef.current = poller;
    pollRef.current = check;
    // REQ-299: shown again — a catch-up, unless the last ask is under 2 s old
    const onVisible = () => {
      const now = viewerTab(document.visibilityState);
      setVisible(now);
      if (now && !peerOnlineRef.current) poller.catchUp();
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
    setVisible(viewerTab(document.visibilityState));
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

  // 2. the link — the customer's side (the presenter's lives on the stage); REQ-217 — only
  //    while this is the tab the customer is looking at: hidden, it drops the link
  useEffect(() => {
    if (!demo || demo.role !== "viewer" || !visible) return; // REQ-217
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
    /** REQ-645 — where each presenter's arrow was drawn when he pointed (null: out of view then) */
    const origins = new Map<string, Pt | null>();
    /** REQ-214 — a presenter's name, for the words his pointer carries */
    const nameOf = (pid: string) =>
      demoRef.current?.presenters.find((x) => x.userId === pid)?.name ??
        demoRef.current?.presenterName ?? "";
    /** REQ-645 — the presenters whose next placing is a new anchor of theirs (a move, a click) —
     *  any other is placed again as the page moved */
    const pointedNow = new Set<string>();
    /** REQ-642 (cycle 5, m10) — every placing of a presenter's arrow is reported back to the
     *  stages (each keeps its own pid's): the stage's ghost of his arrow is where THIS screen has
     *  it, never its own replay's guess. Rate-limited per presenter; the last one always goes */
    const reporter = placedReporter({ send: (m) => link?.send(m) });
    const place = (pid: string, a: Anchor, kind: "move" | "click") => {
      const p = placeOnScreen(a);
      // REQ-451 — what he pointed at is not on this page (any more): no arrow, kept until it is
      // back or he points elsewhere
      if (!p) {
        reporter.report(placedReport(pid, a, null, viewportBox()));
        if (placed.delete(pid)) command(pid, { kind: "leave" });
        return;
      }
      // REQ-645 (cycle 5 M1) — where it was when he pointed (in view); moved far from there under
      // his still mouse (a card grew, the page moved): faded — no longer where he points
      if (pointedNow.delete(pid)) {
        origins.set(pid, p.dir || a.o === 1 ? null : p.at);
      }
      const faded = !p.dir && a.o !== 1 && drifted(origins.get(pid), p.at);
      reporter.report(placedReport(pid, a, p, viewportBox()));
      placed.set(pid, { ...p.at, outside: p.outside });
      // REQ-437 — the element's box goes with the point: the tag sits outside it
      command(pid, {
        kind,
        at: p.at,
        outside: p.outside && !p.dir,
        off: a.o === 1,
        // REQ-645 (c4-M6) — out of view: the chevron where it can be seen, and the way to it
        cue: p.dir
          ? { box: p.box, text: t(cueKey(p.dir), { name: nameOf(pid) }) }
          : null,
        faded,
        rect: p.outside ? null : rectOnScreen(a),
      });
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
          p
            ? was && was.x === p.at.x && was.y === p.at.y &&
              was.outside === p.outside
            : !was
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
    // REQ-648 (cycle 5, M3 + c4-m28) — the link this page's early script opened for this demo
    // before the islands were in: taken over (its sender, recorder and socket), never a second one
    const early = takeEarlyLink(globalThis, demo.id);
    const sender = early?.sender ?? createMirrorSender({
      send: (m) => link?.send(m),
      clock: () => link?.now() ?? Date.now(),
    });
    const recorder = early?.recorder ?? createRecorder(document, {
      emit: (f) => {
        void sender.push(f);
        shifted(); // REQ-305 — the page changed: the pointers on it with it
      },
    });
    early?.onFrame(shifted);
    senderRef.current = sender;
    recorderRef.current = recorder;
    // REQ-640 (cycle 5, M29) — when this page began loading, on the clock every tab of the browser
    // shares: what its load and focus claims say (never the moment the overlay hydrated)
    const pageLoadedAt = performance.timeOrigin || Date.now();
    link = (early?.adopt ?? connectDemo)({
      sessionId: demo.id,
      role: demo.role,
      // REQ-436 (cycle 3, M2b) — every page of this browser tab says the same key, so the stage
      // keeps following the tab while its next page loads; and whether this page has focus
      tab: demoTabKey(sessionStore()),
      hasFocus: () => document.hasFocus(),
      loadedAt: pageLoadedAt,
      onPresence: (pid, online) => {
        lastT.delete(pid); // their stage came or went: its clock starts over
        // a presenter who left takes their pointer along
        if (!online) {
          anchorsRef.current.delete(pid);
          placed.delete(pid);
          reporter.forget(pid); // REQ-642 — his next stage hears afresh
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
          // REQ-647 — the end said, never a silent drop
          demoModeClient.active().then((a) => {
            if (!a.session) demoGone();
          }).catch(() => demoGone());
        }
      },
      onPeerOnline: () => {
        // REQ-242 — a presenter joined: the whole screen at once, then every change; REQ-305 —
        // and this side's resting pointer, which their stage has not seen
        recorder.snapshot();
        resendPointer();
        reporter.cancel(); // REQ-642 — a new stage has heard no report: the next goes out
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
            pointedNow.add(pid);
            place(pid, m.a, "move");
            break;
          case "click":
            anchorsRef.current.set(pid, m.a);
            pointedNow.add(pid);
            place(pid, m.a, "click");
            break;
          case "pending":
            // REQ-645 (cycle 5 M1 + M2) — his pointer is being found again: his last anchor is not
            // what he points at now; "{name} is pointing…" near this fraction — never an arrow
            if (newerMove(lastT.get(pid) ?? 0, m.t)) {
              lastT.set(pid, m.t ?? lastT.get(pid) ?? 0);
              anchorsRef.current.delete(pid);
              placed.delete(pid);
              origins.delete(pid);
              command(pid, {
                kind: "pending",
                at: fracToPoint(m.a, screenBox()),
                text: t("demoMode.pointerPending", { name: nameOf(pid) }),
              });
            }
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
            reporter.cancel(); // REQ-642 — and where his arrow is, on its next placing
            // REQ-636 (cycle 5, m8) — and the pill, with the snapshot it belongs to
            sentPillRef.current = null;
            sendPillRef.current();
            break;
          case "askPill":
            // REQ-636 — a stage that just followed this tab: the pill it may have dropped
            sentPillRef.current = null;
            sendPillRef.current();
            break;
        }
      },
      onEnded: (by, reason, pid) => {
        // REQ-235 — who ended it, in the pill's place at once, kept until dismissed
        // (REQ-296 — or that it expired). REQ-647 (cycle 5, m29) — its receipt is logged, so a
        // live tab that never got it can be told apart on the next demo run
        const d = demoRef.current;
        console.info("[demo] ended", { id: d?.id, by, reason, pid });
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
    // front (now, if it is), gets focus or is clicked; a tab behind another says nothing.
    // REQ-436 (cycle 3, M2/M2c/M5) — "in front" at load is visible AND focused: a visible page
    // without focus (a background tab that reloaded itself, a window beside another) never takes
    // the stage; a keyboard, wheel or touch user claims as a click does (at most once a second)
    // REQ-640 (cycle 5, M29) — a click, a key, the tab brought to the front claim at "now" and say
    // the customer's input backs them; the load claim and a focus event (headless browsers
    // emulate focus in every tab) say the page's load start, so they never outrank real use
    let lastClaim = 0;
    const claim = (how: ClaimHow = "input") => {
      if (how === "input") lastClaim = Date.now();
      link?.claim(how);
    };
    const onFocus = () => claim("focus");
    // a listener is handed the event: never let it pass for `how`
    const onPointer = () => claim("input");
    const used = () => {
      if (Date.now() - lastClaim >= 1_000) claim();
    };
    const inFront = () =>
      document.visibilityState === "visible" && document.hasFocus();
    const onVisible = () => {
      if (document.visibilityState === "visible") claim();
    };
    // REQ-549 (cycle 4, S4) — at load and at a demo's start "in front" is not enough (headless
    // browsers say it of every page): not after the app's own reload, and not when another tab
    // was used since this page loaded
    const tabKey = demoTabKey(sessionStore());
    if (
      loadClaim({
        inFront: inFront(),
        selfReload: cameBySelfReload(),
        tab: tabKey,
        loadedAt: pageLoadedAt,
        newest: newestInput(browserStore("local")),
      })
    ) claim("load");
    // a page restored from the back-forward cache: the customer came back to it in this tab
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && inFront()) claim();
    };
    globalThis.addEventListener("pageshow", onShow);
    globalThis.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerdown", onPointer, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", used, { capture: true });
    document.addEventListener("wheel", used, { capture: true, passive: true });
    document.addEventListener("touchstart", used, {
      capture: true,
      passive: true,
    });
    return () => {
      globalThis.removeEventListener("pagehide", onHide);
      hint.stop();
      globalThis.removeEventListener("pageshow", onShow);
      globalThis.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", onPointer, {
        capture: true,
      });
      document.removeEventListener("keydown", used, { capture: true });
      document.removeEventListener("wheel", used, { capture: true });
      document.removeEventListener("touchstart", used, { capture: true });
      removeEventListener("resize", shifted);
      document.removeEventListener("scroll", shifted, { capture: true });
      ro?.disconnect();
      reporter.cancel();
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
  }, [demo?.id, visible]);

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
  // REQ-379 — ONE home, bottom-left: no per-path memory, no compact <-> full flip; the stage is
  // told where the pill is. REQ-781 (demo-loop cycle dv1, d7) — Raphael: "the gap reserved for
  // the demo pill ... that's not a decision": no band is kept under the page any more (REQ-379's
  // room, REQ-440's painted band, REQ-643's room-while-home are gone). The pill floats over the
  // page where nothing of it is under it, else folds to its mini-pill where no control is, else
  // floats whole where no control is (`placePill`)
  const shown = !inert && Boolean(demo || opening || notice);
  useEffect(() => {
    if (!shown) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const sendPill = () => {
      const el = pillRef.current;
      const at = atRef.current;
      const r: Rect | null = el && at
        ? {
          left: at.left,
          top: at.top,
          width: at.tab ? PILL_TAB.w : el.offsetWidth,
          height: at.tab ? PILL_TAB.h : el.offsetHeight,
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
          label: f.label,
          guide: f.guide,
          // REQ-545 — tucked to its tab, and the band the customer sees (the mirror skips both)
          tucked: bandRef.current.tucked,
          band: bandRef.current.h,
          bandBg: bandRef.current.bg,
          dim: bandRef.current.dim,
          title: f.title,
          end: f.end,
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
      // REQ-636 (cycle 5, m8) — stamped with the frame clock: the stage shows this face when its
      // replay reaches the frame that went out with it, not seconds before
      linkRef.current?.send({
        k: "pill",
        r,
        ...face,
        t: linkRef.current?.now(),
      });
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
      // its own size: nothing measured is ever written back into its style (M6's min-width loop).
      // REQ-545 — folded to its tab, the size it has when whole
      const folded = yieldsRef.current && tuckedRef.current &&
        !peekRef.current;
      if (!folded) fullRef.current = { w: el.offsetWidth, h: el.offsetHeight };
      const home = pillHome({
        view,
        size: fullRef.current ?? { w: el.offsetWidth, h: PILL_TAB.h },
      });
      const can = typeof document.elementsFromPoint === "function";
      const floats = floatsRef.current;
      const minimal = yieldsRef.current &&
        isPublicDocPath(globalThis.location.pathname);
      const dialog = can && dialogBackdropUp() !== null;
      // REQ-545 (demo-loop cycle 4, m2) — the pill YIELDS to the page; a dialog docks it home,
      // above the dialog's box, top-left, top-right, else folds it. REQ-781 (cycle dv1, d7) — it
      // floats: no band, never over a control
      const p = placePill({
        home: home.box,
        view,
        top: bannerH(),
        dialog,
        // REQ-637 (cycle 5, m5) — docked just above the dialog's own box first
        dialogBox: dialog ? dialogPanel() : undefined,
        minimal,
        blocked: can ? pageUnder : () => 0,
        controls: can ? countControls : () => 0,
        yields: yieldsRef.current,
        floats,
      });
      // REQ-765 (cycle 5v2, p18-3d) — the dialog's dim rides to the stage, which draws the pill
      // itself over the replayed page (the mirror skips the overlay); the pill here is softened
      // under it, still clickable
      const backdrop = dialog ? dialogBackdropUp() : null;
      const dim = backdrop
        ? dialogDim(getComputedStyle(backdrop).backgroundColor)
        : null;
      setUnderDim(dim !== null);
      setTucked(p.tucked);
      if (!p.tucked) setPeek(false);
      const shownTab = p.tucked && !peekRef.current;
      bandRef.current = {
        h: 0,
        bg: "#fff",
        tucked: shownTab,
        dim: dim ?? undefined,
      };
      // REQ-781 — the mini-pill on the left edge or the right one
      const edge = tabBox(home.box);
      if (p.tucked) {
        setTabAt({
          x: Math.round(p.box.left - edge.left),
          y: Math.round(p.box.top - edge.top),
        });
      }
      // tucked: a hover or tap shows the whole pill out of its tab — flush with the tab's edge,
      // so the pointer that opened it is on it (leaving it folds it again)
      const box = p.tucked
        ? {
          ...home.box,
          top: home.box.top + (p.box.top - edge.top),
          left: p.box.left > edge.left
            ? Math.max(0, view.w - home.box.width)
            : 0,
        }
        : p.box;
      setDock({
        x: Math.round(box.left - home.box.left),
        y: Math.round(box.top - home.box.top),
      });
      atRef.current = shownTab
        ? { left: p.box.left, top: p.box.top, tab: true }
        : { left: box.left, top: box.top, tab: false };
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
    placeRef.current = place;
    place();
    const timer = setInterval(place, PILL_CHECK_MS);
    addEventListener("resize", onResize);
    // REQ-545 — what scrolls into the bottom strip tucks the pill (any scroller: capture)
    addEventListener("scroll", later, { capture: true, passive: true });
    const ro = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(later);
    if (pillRef.current) ro?.observe(pillRef.current);
    return () => {
      clearInterval(timer);
      clearTimeout(settle);
      ro?.disconnect();
      removeEventListener("resize", onResize);
      removeEventListener("scroll", later, { capture: true });
      clearTimeout(peekTimer.current);
      placeRef.current = () => {};
      sendPillRef.current = () => {};
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
  // REQ-545 — the tab opened or closed: the stage hears where the pill is now
  useEffect(() => {
    placeRef.current();
  }, [peek, open, fresh]);

  if (inert) return null;

  /** REQ-545 — the tucked pill shows whole: on hover until left, on a tap for PILL_PEEK_MS */
  const folded = tucked && !peek;
  const unpeekIn = (ms: number) => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => {
      // End's question is up: the pill stays until it is answered
      if (pillRef.current?.querySelector('[data-cy="demo-end-ask"]')) {
        unpeekIn(ms);
        return;
      }
      setPeek(false);
    }, ms);
  };
  /** the tab hovered or tapped: whole, until the pointer has been in and left (or PILL_PEEK_MS) */
  const openPeek = () => {
    setPeek(true);
    unpeekIn(PILL_PEEK_MS);
  };
  /** the pointer is on the whole pill: it stays */
  const holdPeek = () => {
    if (peekRef.current) clearTimeout(peekTimer.current);
  };
  const leavePeek = () => {
    if (peekRef.current) unpeekIn(300);
  };

  // REQ-379 — ONE home: bottom-left (REQ-781: floating, no band kept for it), its bottom on the visible
  // bottom (above an iOS keyboard, like the shells' --vvh); a dialog over the home docks it (a
  // glide). No measure is written back: it is as wide as its content, capped by the window. Its
  // empty area lets a click through to the page (M28): only its buttons (HIT) take one
  const at =
    `left:${PILL_MARGIN}px;bottom:calc(100% - var(--vvt, 0px) - var(--vvh, 100%) + ${PILL_BAND_GAP}px);transform:translate(${dock.x}px, ${dock.y}px);transition:transform ${PILL_MOVE_MS}ms ease`;
  const pillStyle = `position:fixed;${at};z-index:${
    Z + 3
  };display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:nowrap;white-space:nowrap;max-width:calc(100vw - ${
    2 * PILL_MARGIN
  }px);box-sizing:border-box;padding:7px 12px;border-radius:14px;background:#1f3d1b;color:#fff;font-family:${PILL_FONT};font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.35);${
    // REQ-545 — shown whole from its tab, it takes the pointer, so leaving it folds it again
    tucked ? "pointer-events:auto" : "pointer-events:none"};${
    // REQ-765 (cycle 5v2, p18-3d) — under a dialog's dim: softened, never hidden, still clickable
    underDim ? `opacity:${PILL_UNDER_DIALOG_OPACITY}` : "opacity:1"}`;
  // REQ-545 (demo-loop cycle 4, m2) — the pill folded on the window's left edge, its foot on the
  // home's foot: only its buttons take a click. REQ-637 (cycle 5, m5) — a labelled mini-pill
  // ("● Demo" and an × that is End), never a bare 16 px sliver
  // REQ-781 (cycle dv1, d7) — or on the right edge (`tabAt`), when the left one has a control
  const tabR = PILL_TAB.h / 2;
  const tabStyle =
    `position:fixed;left:0;bottom:calc(100% - var(--vvt, 0px) - var(--vvh, 100%) + ${PILL_BAND_GAP}px);transform:translate(${tabAt.x}px, ${tabAt.y}px);z-index:${
      Z + 3
    };display:flex;align-items:stretch;width:${PILL_TAB.w}px;height:${PILL_TAB.h}px;box-sizing:border-box;padding:0;border-radius:${
      tabAt.x > 0 ? `${tabR}px 0 0 ${tabR}px` : `0 ${tabR}px ${tabR}px 0`
    };background:#1f3d1b;color:#fff;font-family:${PILL_FONT};font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.3);pointer-events:none;opacity:${
      underDim ? PILL_UNDER_DIALOG_OPACITY : 1
    }`;
  /** one line: a long name is cut, not wrapped (the live pill's rule, REQ-228) */
  const cut = "overflow:hidden;text-overflow:ellipsis;min-width:0";
  // REQ-294 (demo m21) — the words that carry a name wrap to as many lines as it needs: the ended
  // notice always, the phone's details once opened; the title goes on a phone
  const wrap = "white-space:normal;min-width:0;overflow-wrap:anywhere";

  // REQ-235 — the demo is over: who ended it, in the pill's place, until dismissed (Demo clicked
  // here again takes over)
  yieldsRef.current = false;
  floatsRef.current = false;
  if (notice && !opening) {
    // REQ-643 (demo-loop cycle 5, m9) — a floating message: it never folds
    floatsRef.current = true;
    const said = endedText(notice);
    faceRef.current = {
      compact,
      open: false,
      status: "ended",
      text: t(said.key, said.vars),
      label: t("demoMode.ended"),
      title: t("demoMode.title"),
    };
    return (
      <div data-demo-overlay ref={fenceClicks}>
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
            onClick={() => {
              setNotice(null);
              // REQ-647 — read and dismissed: the next page does not say it again
              forgetDemo(sessionStore());
            }}
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
      <div data-demo-overlay ref={fenceClicks}>
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
      <div data-demo-overlay ref={fenceClicks}>
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

  // the phone pill's details opened (a tap, to read them): shown until closed — never tucked away
  // under the hand that opened them; nor while it says a new demo started (REQ-298)
  yieldsRef.current = !(compact && open) && !fresh;
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
  // REQ-232 (demo-lifecycle-p1) — plain words: is the staff here or not; never how the bytes travel.
  // REQ-535 — a page loaded from a connected one says Connected through the grace
  const live = showsConnected(status, carrying, activeOk);
  const statusLabel = status === "ended"
    ? t("demoMode.ended")
    : live
    ? t("demoMode.connected")
    : t("demoMode.connecting");
  // REQ-373 (demo m2, p13-h) — the guide's first name on the compact pill; the name said once
  const copy = pillCopy({ presenters, status: statusLabel, compact, open, t });
  /** REQ-373 — "● Alex" beside the status while the details are hidden */
  const showGuide = copy.showShort && !started;
  // REQ-372 — what this pill shows, for the stage's replica. REQ-430 (cycle 3, m4) — its status
  // in this pill's own words (the customer's language) and the guide's short name when shown
  faceRef.current = {
    compact,
    open: compact && open,
    status: status === "ended" ? "ended" : live ? "live" : "connecting",
    text: line,
    label: statusLabel,
    guide: showGuide ? copy.shortName : undefined,
    // REQ-540 (cycle 4, m9) — the title and End in this pill's own words, so the stage's ghost
    // draws the whole pill (it hides the title on the compact pill, as this pill does)
    title: t("demoMode.title"),
    end: t("demoMode.end"),
  };

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
    <div data-demo-overlay ref={fenceClicks}>
      {presenters.map((p) => (
        <PeerPointer
          key={p.userId}
          name={p.name}
          color={p.color}
          z={Z + 1}
          offZ={OFF_MARK_Z}
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
        onMouseEnter={tucked ? holdPeek : undefined}
        onMouseLeave={tucked ? leavePeek : undefined}
        data-cy="demo-pill"
        data-restarted={started ? "" : undefined}
        data-tucked={folded ? "" : undefined}
        // REQ-545 — the link's state, said even while the pill is folded to its tab
        data-status={faceRef.current.status}
        role="status"
        style={folded
          ? tabStyle
          : (started
            ? `${pillStyle};animation:pmDemoPulse 1.1s ease-out 3`
            : pillStyle) +
            // REQ-548 (cycle 4, p4-p3e) — opened details, or End asking, take a row of their own on
            // the phone: never a squeeze of the guide's name
            (pillWraps({ compact, open, asking }) ? ";flex-wrap:wrap" : "")}
      >
        {folded && (
          // REQ-545 — the tucked pill: hover or tap shows it whole. REQ-637 (cycle 5, m5) — it says
          // what it is ("● Demo") and keeps End: its × brings the whole pill out with End asking
          <>
            <button
              type="button"
              data-cy="demo-pill-tab"
              aria-label={`${statusLabel} · ${t("demoMode.showPill")}`}
              title={`${statusLabel} · ${t("demoMode.showPill")}`}
              aria-expanded="false"
              onMouseEnter={openPeek}
              onFocus={openPeek}
              onClick={openPeek}
              style={`flex:1;min-width:0;display:flex;align-items:center;gap:6px;margin:0;padding:0 4px 0 10px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;${HIT}`}
            >
              <span
                aria-hidden="true"
                style={`flex:none;width:8px;height:8px;border-radius:50%;background:${
                  status === "direct" || status === "relay"
                    ? "#7ee081"
                    : "#f2c14e"
                }`}
              />
              <span style={cut}>{t("demoMode.tabLabel")}</span>
            </button>
            <button
              type="button"
              data-cy="demo-pill-tab-end"
              aria-label={t("demoMode.end")}
              title={t("demoMode.end")}
              onClick={() => {
                setAskEnd(true);
                openPeek();
              }}
              style={`flex:none;width:28px;display:flex;align-items:center;justify-content:center;margin:0;padding:0;border:0;border-left:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font:inherit;font-size:16px;line-height:1;cursor:pointer;${HIT}`}
            >
              <span aria-hidden="true">×</span>
            </button>
          </>
        )}
        {!folded && (
          <>
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
              {copy.showChips && (
                <PresenterChips presenters={presenters} nowrap t={t} />
              )}
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
            {
              /* REQ-536 (cycle 4, m29) — the details toggle is the phone's compact pill's only: the
                full-size pill always shows its details, so there its status is a plain span (it was
                a button announced "expanded" whose click changed nothing) */
            }
            {compact
              ? (
                <button
                  type="button"
                  data-cy="demo-more"
                  aria-expanded={open}
                  aria-label={copy.moreLabel}
                  onClick={toggleOpen}
                  style={`display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;${HIT}`}
                >
                  {!showGuide && (
                    <span
                      aria-hidden="true"
                      style={`width:10px;height:10px;border-radius:50%;background:${
                        presenters[0].color
                      };box-shadow:0 0 0 2px rgba(255,255,255,.85)`}
                    />
                  )}
                  <span
                    data-cy="demo-status"
                    style={STATUS_CHIP}
                  >
                    {statusLabel}
                  </span>
                </button>
              )
              : (
                <span data-cy="demo-status" style={STATUS_CHIP}>
                  {statusLabel}
                </span>
              )}
            {/* REQ-235 — End asks first; REQ-649 — the customer is asked about ending it with the guide */}
            <EndDemo
              onEnd={end}
              ownRow={compact}
              onAsking={setAsking}
              t={t}
              // REQ-637 (cycle 5, m5) — out of the mini-pill by its ×: End is already asking
              askAtOnce={askEnd}
              askKey="demoMode.endAskViewer"
              askVars={{ name: names }}
            />
          </>
        )}
      </div>
    </div>
  );
}
