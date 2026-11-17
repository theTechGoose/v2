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
 * REQ-823 (demo-loop cycle dm1, M2) — a sign-out is said: the app's sign-out event in this tab, or
 * another tab of the browser telling it (signout-signal.ts), makes this page say
 * `leaving("signout")` on its link and close it at once — before the redirect, so the stage says
 * the customer signed out and never falls back to another tab of the dead session — and drop the
 * demo (the carry forgotten: the next page is not this sign-in's).
 * REQ-855 (demo-loop cycle dm3, m5 + m6 + rc-17) — the presenter's own chrome off the stage is the
 * PRESENTER's: the presenter pill, its Opening… and the end of a demo it presented speak the
 * presenter's language (`presenterChromeLang`: whoami's impersonator under impersonation, never
 * the customer page's langSignal), drawn once whoami has answered, and its hop back to the stage
 * carries that language. Where the red impersonation bar used to sit beside it (the presenter's
 * browser acting as the customer) the pill carries the way out — End demo (asks first; with others
 * presenting, Leave the demo) — and an EN | ES switch for the presenter's language; it tells the
 * bar whether it still shows a demo this staff presents (DEMO_PRESENTING_EVENT).
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
  DEMO_PLACE_FAILED_EVENT,
  DEMO_PRESENTING_EVENT,
  DEMO_STARTED_EVENT,
  demoModeClient,
  type DemoStarted,
} from "../clients/demo-mode.ts";
import { adminClient, type WhoAmI } from "../clients/admin.ts";
// REQ-855 (cycle dm3, m6) — the presenter's own chrome ranks its language like the stage does
import {
  pageLangCarry,
  persistDemoLang,
  presenterChromeLang,
} from "../lib/presenter-lang-rank.ts";
import { persistLang } from "../lib/lang.ts";
import { langToggleHref } from "../../shared/quote-flow/public-lang.ts";
import {
  adminGateShown,
  stageLeaveShown,
} from "../../shared/demo-mode/stage-chrome.ts";
import { announceImpersonation } from "../lib/demo-mode/impersonation-signal.ts";
import { signoutGate } from "../lib/demo-mode/signout-signal.ts";
import { relayRenames } from "../lib/demo-mode/rename-signal.ts";
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
// REQ-817 (cycle dm1, m3) — a new name in an /active answer is a new demo to draw (and carry)
import { sameDemo } from "../../shared/demo-mode/stage-frame.ts";
import {
  anchorAt,
  createTouchFade,
  inViewport,
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
  OFF_MARK_Z,
  placedReport,
  placedReporter,
  placeView,
  pointInBox,
  scrollRoom,
  type TagPlace,
  visibleBox,
} from "../../shared/demo-mode/presenter-anchor.ts";
import { anchorFrame } from "../../shared/demo-mode/customer-pointer.ts";
import {
  type JoinGrace,
  joinGrace,
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
  type ClaimHow,
  connectDemo,
  type DemoLink,
  type LinkStatus,
  type PeerFrom,
} from "../lib/demo-mode/transport.ts";
import { demoTabKey } from "../lib/demo-mode/tab-key.ts";
import { takeEarlyLink } from "../lib/demo-mode/early-link.ts";
import { markDemoRejoin } from "../lib/demo-mode/rejoin-mark.ts";
import {
  carriedDemo,
  carriedEnded,
  forgetDemo,
  keepDemo,
  keepEnded,
  PILL_CARRY_GRACE_MS,
  type PillPlace,
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
import { endDemoWords } from "../components/demo-mode/EndDemo.tsx";
import {
  ADMIN_PATH,
  endedHref,
  type EndedNotice,
  endedText,
  goneNotice,
  readEndedNotice,
  stageHref,
  whoEnded,
  withLang,
} from "../../shared/demo-mode/ended.ts";
import { type Lang, langSignal, tFor, type Vars } from "../lib/i18n.ts";
import {
  askDock,
  askSpot,
  backdropCovers,
  centresIn,
  CONTROL_SELECTOR,
  countsAsPage,
  coversView,
  dialogDim,
  HEADING_SELECTOR,
  HEADING_WEIGHT,
  isPublicDocPath,
  PAGE_MEDIA_SELECTOR,
  pastBackdrop,
  peekBox,
  peekHolds,
  peekTimer,
  PILL_BAND_GAP,
  PILL_BOX_METRICS,
  PILL_COMPACT_MAX_W,
  PILL_FONT,
  PILL_MARGIN,
  PILL_MOVE_MS,
  PILL_PEEK_MS,
  PILL_SCROLL_SETTLE_MS,
  PILL_STATUS_CHIP,
  PILL_TAB,
  PILL_UNDER_DIALOG_OPACITY,
  pillDetailsShown,
  pillHome,
  pillOverflows,
  pillRestBox,
  pillStore,
  pillWraps,
  placePill,
  recallPillOpen,
  rememberPillOpen,
  samplePoints,
  seeThrough,
  tabBox,
  translateOf,
} from "../../shared/demo-mode/pill.ts";
import { pillCopy, pillStatusOf } from "../../shared/demo-mode/pill-copy.ts";
import type { PillFace, Rect } from "../../shared/demo-mode/protocol.ts";

// REQ-494 / REQ-544 — `t` is the demo chrome's (lib/demo-chrome-t.ts): on /worker it keeps
// the viewer's stored language, not the signed-in worker's. REQ-855 — the presenter's own pill
// uses `pt`, the presenter's language (presenterChromeLang), never the customer page's.

interface Demo {
  id: string;
  role: Role;
  presenterName: string;
  targetName: string;
  targetUserId: string;
  /** REQ-214 — everyone presenting, each with a name and a colour */
  presenters: Presenter[];
}

const Z = 2147483000;
/** the pill and its folded tab: above the page, its dialogs and coach mark */
const PILL_Z = Z + 3;
/**
 * REQ-831 (demo-loop cycle dm2, m4) — the presenters' pointers sit above the pill (wave clip at
 * POINTER_Z, arrow at POINTER_Z + 1), as on the stage (ghost at Z, pointer at Z + 1): the pill's
 * End question is something to point at. Both are pointer-events:none, so its buttons still
 * take the click; the off-screen mark keeps OFF_MARK_Z (REQ-635).
 */
const POINTER_Z = PILL_Z + 1;
/** REQ-379 (M28) — the pill lets a click through to the page; its buttons take theirs */
const HIT = "pointer-events:auto";
/** REQ-536 — the customer pill's status chip ("Connected"), in the toggle or on its own */
const STATUS_CHIP = PILL_STATUS_CHIP;

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

/** REQ-832 (cycle dm2, p1) — the element a pill would cover at a point: the topmost of the page,
 *  or with a dialog up (`backdrop`) the dialog's own layer, else the page beneath its dim */
function hitAt(
  x: number,
  y: number,
  backdrop: Element | null,
): { el: Element; under: boolean } | undefined {
  return pastBackdrop(
    document.elementsFromPoint(x, y)
      .filter((el) => !el.closest("[data-demo-overlay]")),
    backdrop,
    (outer, inner) => outer.contains(inner),
  );
}

/** REQ-295 — the piece of the page the topmost element at a point belongs to, or null if none.
 *  REQ-832 (cycle dm2, p1) — with a dialog up, looked at through its backdrop: the dialog's layer
 *  counts as before; beneath the dim only a control does (covering text stays allowed, REQ-818) */
function pageAt(
  x: number,
  y: number,
  backdrop: Element | null = null,
): Element | null {
  const hit = hitAt(x, y, backdrop);
  if (!hit) return null;
  const top = hit.el;
  if (hit.under) return top.closest(CONTROL_SELECTOR);
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

/** REQ-898 — every control of the page with its box, read once per placement (a placement asks
 *  of many boxes in one synchronous run; the list is dropped in a microtask, so the next
 *  placement reads the page afresh). The demo's own chrome and what has no size are left out */
let pageControlsNow: { el: Element; box: Rect }[] | null = null;
function pageControls(): { el: Element; box: Rect }[] {
  if (pageControlsNow) return pageControlsNow;
  const out: { el: Element; box: Rect }[] = [];
  for (const el of document.querySelectorAll(CONTROL_SELECTOR)) {
    if (el.closest("[data-demo-overlay]")) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    out.push({
      el,
      box: { left: b.left, top: b.top, width: b.width, height: b.height },
    });
  }
  pageControlsNow = out;
  queueMicrotask(() => {
    pageControlsNow = null;
  });
  return out;
}

/** REQ-898 — the controls whose centre is under a box (`centresIn`) and which a hit at that
 *  centre reaches (one hidden behind the page's own layers is not; through a dialog's backdrop
 *  it is, REQ-832): the sampling grid misses a control smaller than its pitch — the dashboard's
 *  10 px money-bar segments under the whole pill, a 24 px footer link between the three rows of
 *  a 74 px asking pill */
function controlsByCentre(r: Rect, backdrop: Element | null): Element[] {
  const all = pageControls();
  const out: Element[] = [];
  for (const i of centresIn(all.map((c) => c.box), r)) {
    const { el, box } = all[i];
    const hit = hitAt(
      box.left + box.width / 2,
      box.top + box.height / 2,
      backdrop,
    );
    const c = hit?.el.closest(CONTROL_SELECTOR);
    if (c && (c === el || el.contains(c))) out.push(el);
  }
  return out;
}

/** REQ-228 / REQ-295 — how many distinct pieces of the page lie under a box (the demo's own chrome
 *  not counted): controls, media, dialogs, text, cards and bars. REQ-379: a point every 40 px
 *  across, so a link between two points of a wide pill is not missed. REQ-897 (cycle dm6, p4) —
 *  a heading counts HEADING_WEIGHT: among spots that all cover something, the title's loses.
 *  REQ-898 — and the controls found by their centre */
function pageUnder(r: Rect, backdrop: Element | null = null): number {
  const found = new Set<Element>();
  for (
    const { x, y } of samplePoints(r, Math.max(5, Math.ceil(r.width / 40)), 3)
  ) {
    const el = pageAt(x, y, backdrop);
    if (el) found.add(el);
  }
  for (const c of controlsByCentre(r, backdrop)) found.add(c);
  let n = 0;
  for (const el of found) {
    n += el.closest(HEADING_SELECTOR) ? HEADING_WEIGHT : 1;
  }
  return n;
}

/** REQ-781 (demo-loop cycle dv1, d7) — how many controls of the page (links, buttons, fields:
 *  CONTROL_SELECTOR) are under a box: a floating pill may cover text, never one of these.
 *  REQ-832 (cycle dm2, p1) — with a dialog up, the controls beneath its backdrop count too (the
 *  sidebar's Log out under the send dialog's dim) */
function countControls(r: Rect, backdrop: Element | null = null): number {
  const found = new Set<Element>();
  for (
    const { x, y } of samplePoints(r, Math.max(5, Math.ceil(r.width / 40)), 3)
  ) {
    const c = hitAt(x, y, backdrop)?.el.closest(CONTROL_SELECTOR);
    if (c) found.add(c);
  }
  // REQ-898 — and the ones the grid steps over, by their centre
  for (const c of controlsByCentre(r, backdrop)) found.add(c);
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
   *  REQ-217 / REQ-793 — every page of the app is eligible (the worker view too); the visible tab speaks */
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
    // REQ-833 (cycle dm2, m6) — the line's clock running out hands over to the join grace:
    // "started a new demo", then "{name} is guiding you", then the pill yields
    restartRef.current = restartNotice({
      onChange: (on, read) => {
        setFresh(on);
        if (on) return;
        joinRef.current?.restartEnded(
          demoRef.current?.id ?? "",
          read === true,
        );
      },
    });
  }
  /** REQ-821 (demo-loop cycle dm1, m9) — a first join: the whole pill ("{name} is guiding you"
   *  with End) shows for a few seconds before it yields, as a restart's line does */
  const [joined, setJoined] = useState(false);
  const joinRef = useRef<JoinGrace | null>(null);
  if (!joinRef.current) {
    joinRef.current = joinGrace({ onChange: setJoined });
  }
  const linkRef = useRef<DemoLink | null>(null);
  /** REQ-228 — the pill, where it sits, and whether it is the phone's compact one */
  const pillRef = useRef<HTMLDivElement | null>(null);
  /** REQ-876 (demo-loop cycle dm5, m2) — the last press on the pill (End, the mini-pill's ×): End's
   *  question opens with its answers nearest it (`placeAsk` → `askSpot`'s `near`) */
  const endPressRef = useRef<{ x: number; y: number; at: number } | null>(
    null,
  );
  /** REQ-379 — how far from its home a dialog docked the pill (0: home); a move glides.
   *  REQ-545 (cycle 4, m2) — across too: the top-right is the third place */
  const [dock, setDock] = useState({ x: 0, y: 0 });
  /** REQ-835 (cycle dm2, m2 + M2) — the dock the pill is gliding to, read outside a render */
  const dockRef = useRef(dock);
  dockRef.current = dock;
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
  /** REQ-820 (demo-loop cycle dm1, m6) — a mouse or pen pointer is on the pill (folded or whole).
   *  Tracked on the persistent pill div, so a tab swapped for the whole pill under a resting
   *  pointer keeps it; a touch never counts (its :hover sticks after a tap) */
  const overPillRef = useRef(false);
  /** REQ-849 (demo-loop cycle dm3, p14) — the folded tab's box (the peek keeps PILL_MARGIN from
   *  the edge, so the pointer that opened it may rest in the gap, on the tab's old box) and the
   *  last mouse/pen pointer seen (NaN: none yet) */
  const peekTabRef = useRef<Rect | null>(null);
  const pointRef = useRef({ x: NaN, y: NaN });
  /** REQ-820 — the frame that turns the tab into the whole pill: no transform glide, so it never
   *  slides in from the tab's translate (half off-screen on the right edge) */
  const [noGlide, setNoGlide] = useState(false);
  /** REQ-545 — the peek's fold timer. REQ-820 — it waits again while the pill is held: a pointer
   *  resting on it, or End's question up (that stays until it is answered) */
  const foldTimer = useRef<ReturnType<typeof peekTimer> | null>(null);
  foldTimer.current ??= peekTimer({
    held: () =>
      overPillRef.current ||
      !!pillRef.current?.querySelector('[data-cy="demo-end-ask"]') ||
      // REQ-849 — or in the pill-plus-tab region (the gap between the peek and the edge)
      (peekRef.current && !!pillRef.current &&
        peekHolds({
          pill: pillRef.current.getBoundingClientRect(),
          tab: peekTabRef.current,
          ...pointRef.current,
          since: peekSinceRef.current, // REQ-890
          now: Date.now(),
        })),
    fold: () => setPeek(false),
  });
  /** REQ-545 — what the stage is told of the strip under the pill. REQ-781 (cycle dv1, d7): no
   *  band is kept any more (h 0); a folded pill and a dialog's dim still ride along */
  const bandRef = useRef<
    { h: number; bg: string; tucked: boolean; dim?: string }
  >({ h: 0, bg: "#fff", tucked: false });
  const placeRef = useRef<() => void>(() => {});
  /** REQ-897 (cycle dm6, p5) — the page is scrolling (its last scroll event under
   *  PILL_SCROLL_SETTLE_MS ago): the folded chip holds its spot until the scroll has settled */
  const scrollingRef = useRef(false);
  /** REQ-897 AMENDMENT (dm7, m3) — has the pill been placed on this page yet? Before that, a
   *  kept spot is the last page's: no scroll hold for it */
  const placedHereRef = useRef(false);
  /** REQ-545 — only the customer's live pill yields to the page; the ended notice (a message to
   *  read and dismiss), Opening… and the presenter's way back stay home (a dialog still docks) */
  const yieldsRef = useRef(false);
  /** REQ-643 (demo-loop cycle 5, m9) — the ended notice floats: it reserves no band */
  const floatsRef = useRef(false);
  /** REQ-379 — the phone's compact form from the first render: a full-size first measure is what
   *  grew to a 400 px pill on a 390 px phone (M6) */
  const [compactBase, setCompact] = useState(narrow);
  /** REQ-890 — a peek on a crowded row shows the compact form (whole again when it folds) */
  const [peekCompact, setPeekCompact] = useState(false);
  const compact = compactBase || (peek && peekCompact);
  /** REQ-890 — when the pointer was last on the tab or the pill (the opening counts): its way
   *  between them is not a leave for PEEK_TRAVEL_MS from then */
  const peekSinceRef = useRef(0);
  /** REQ-890 — the compact form's size once it has rendered, for `peekBox` to try on a crowded
   *  row before the whole pill moves away from the tab */
  const compactSizeRef = useRef<{ w: number; h: number } | null>(null);
  /** REQ-890 AMENDMENT — the peek opened by the tab's × (End asked): never switched to the compact
   *  form — the question has its own placement (`askSpot`, REQ-852/876), and the whole pill's one
   *  row fits a gap between two of the page's controls that the compact form, wrapped to two rows
   *  for the question, does not (/welcome at 1280×800: 75 px between the Skip link and the
   *  footer's links). Cleared when the peek folds */
  const peekForAskRef = useRef(false);
  /** REQ-781 (cycle dv1, d7) — where the folded mini-pill sits: its offset from the left edge's
   *  spot (`tabBox`; x > 0: the right edge) */
  const [tabAt, setTabAt] = useState({ x: 0, y: 0 });
  /** REQ-830 (demo-loop cycle dm2, p6) — where the pill last was (folded, the mini-pill's spot, the
   *  dock, its whole size): carried to the next page, which draws its first frame from it */
  const lastPlaceRef = useRef<PillPlace | null>(null);
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
  const whoRef = useRef<Promise<WhoAmI | null> | null>(null);
  /** one whoami per page, started early (on the opening event) so the placement never waits for it;
   *  REQ-855 — kept whole (null: it failed): the presenter's chrome speaks its impersonator's language */
  const knowWho = () =>
    whoRef.current ??= adminClient.whoami().catch(() => null);
  /** REQ-855 — whoami as this page has it, for the presenter's pill: undefined until it answers */
  const [staffWho, setStaffWho] = useState<WhoAmI | null | undefined>(
    undefined,
  );
  /** REQ-855 (cycle dm3, m6) — the presenter's own language on this page: the page's live language
   *  on the presenter's own session; under impersonation (a page of the CUSTOMER's, whose
   *  langSignal is hers) ?lang= → whoami's impersonator → pm_lang → en */
  const presenterLangFor = (who: WhoAmI | null | undefined): Lang =>
    presenterChromeLang({ who, live: langSignal.value, ...pageLangCarry() });
  /** REQ-855 — the presenter is on the way out (End / Leave from the pill): nothing else moves */
  const goingOutRef = useRef(false);
  const [goingOut, setGoingOut] = useState(false);
  const demoRef = useRef<Demo | null>(null);
  demoRef.current = demo;
  /** REQ-855 — the side of the demo this page last had: its end is said in that side's language */
  const lastRoleRef = useRef<Role | null>(null);
  if (demo) lastRoleRef.current = demo.role;
  /** REQ-242 — this page's recorder and the sender its frames go out through */
  const recorderRef = useRef<Recorder | null>(null);
  const senderRef = useRef<MirrorSender | null>(null);
  /** REQ-305 — each presenter's pointer as last sent: its anchor, placed again on this screen
   *  whenever this page moves under it (the arrow follows the element they point at) */
  const anchorsRef = useRef<Map<string, Anchor>>(new Map());
  /** REQ-837 (demo dm2 m3) — told where a presenter's name tag went on this screen (the link's
   *  effect re-reports his arrow with it); none while no link */
  const tagSinkRef = useRef<((pid: string, t: TagPlace | null) => void) | null>(
    null,
  );
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
      const box = {
        ...visibleBox(el as unknown as ClipNode, screenBox(), styleOf),
        // REQ-867 (demo dm4 m6) — which ways a scroll can bring it here (a closed drawer: none)
        room: scrollRoom(el as unknown as ClipNode, styleOf),
      };
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
    if (!inViewport(p, viewportBox())) return dropRest();
    linkRef.current?.send({ k: "move", a: anchorOf(p), t: performance.now() });
  };

  /** REQ-850 (demo-loop cycle dm3, p10) — this side's resting pointer is no longer on this screen
   *  (she narrowed the window past her still cursor; no pointerleave came): it leaves the stage —
   *  never re-sent as a fraction clamped to the window's edge */
  const dropRest = () => {
    lastMoveRef.current = null;
    sentRef.current = null;
    linkRef.current?.send({ k: "leave" });
  };

  /** this side's moves, rated leading + trailing so the rest position always goes out */
  const throttle = useMemo(() =>
    moveThrottle<Pt>({
      gap: () =>
        linkRef.current?.isDirect() ? MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS,
      send: ({ x, y }) => {
        // REQ-850 (dm3 p10) — a trailing send after the window shrank under it: a leave
        if (!inViewport({ x, y }, viewportBox())) return dropRest();
        linkRef.current?.send(
          {
            k: "move",
            a: anchorOf({ x, y }),
            t: performance.now(),
          },
          true,
        );
      },
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
      // REQ-855 — the same whoami says whose language the hop to the stage carries
      const who = await knowWho();
      if (impersonatingRef.current === null) {
        impersonatingRef.current = Boolean(who?.impersonating);
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
        // REQ-829 (dm2, m7) — the stage opens in the language this page shows (an es-profile
        // staff on /admin?lang=en gets an English stage). REQ-855 (dm3, m6 + rc-17) — the
        // PRESENTER's: on a customer's page (this browser acts as her) that is not the page's
        // langSignal — hers — but whoami's impersonator's (?lang= first, the cookie after)
        globalThis.location.assign(stageHref(presenterLangFor(who)));
      }
    } finally {
      placingRef.current = false;
      // on its way: the pill keeps saying Opening… until the stage loads
      if (!moving) {
        setPlacing(false);
        // REQ-864 (dm4 p8) — not moving after all: /admin's Demo row stops saying Opening…
        globalThis.dispatchEvent(new Event(DEMO_PLACE_FAILED_EVENT));
      }
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
    // REQ-821 — carried in from the last page: already joined, no grace again on every link
    joinRef.current?.seen(carried.demo.id);
    // REQ-830 (demo-loop cycle dm2, p6) — where the last page had the pill, before paint: never the
    // whole pill at home for a frame, then folded and moved by the first measure
    const at = carried.place;
    if (at) {
      lastPlaceRef.current = at;
      tuckedRef.current = at.tucked;
      setTucked(at.tucked);
      setTabAt(at.tabAt);
      setDock(at.dock);
      if (at.full) fullRef.current = at.full;
    }
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
      keepDemo(
        sessionStore(),
        demo,
        peerOnline,
        Date.now(),
        lastPlaceRef.current,
      );
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
        keepDemo(
          sessionStore(),
          d,
          peerOnlineRef.current,
          Date.now(),
          lastPlaceRef.current,
        );
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
  // REQ-823 (demo-loop cycle dm1, M2) — the customer signed out (here, or in another tab of this
  // browser: the same dead session): this page says so on its link and closes it now — the
  // redirect's pagehide would say "navigating", and the stage would wait for a page that never
  // comes, then follow another tab of hers — and the demo is dropped, its carry forgotten
  //    REQ-834 (cycle dm2, M1) — the hold is SIGNOUT_HOLD_MS, never the page's life: she may sign
  //    in again in another tab (that page says so: `back` asks at once), and after the hold the
  //    server decides — a dead session's ask fails, a signed-in-again one gets its demo
  const gateRef = useRef<{ holds(): boolean } | null>(null);
  useEffect(() => {
    if (inert) return;
    const gate = signoutGate({
      out: () => {
        // this page's sign-in is over (or about to be): its link goes, its demo is dropped
        const link = linkRef.current;
        linkRef.current = null;
        link?.leaving("signout");
        link?.close();
        // REQ-892 (dm6, m3) — a demo dropped here: the session-less page this tab lands on (the
        // landing, a public page) watches for her signing in again and rejoins
        if (link || demoRef.current) markDemoRejoin(sessionStore(), Date.now());
        demoRef.current = null; // the pagehide that may come first keeps nothing
        forgetDemo(sessionStore());
        anchorsRef.current.clear();
        setCmds({});
        setDemo(null);
      },
      back: () => pollerRef.current?.now(),
    });
    gateRef.current = gate;
    return () => {
      gateRef.current = null;
      gate.stop();
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
  // REQ-821 — a demo id first seen here: the whole pill shows from its arrival (Connecting…) until
  // a few seconds after its link is up; then it may yield to the page again
  useEffect(() => {
    if (inert || !demo || demo.role !== "viewer") return;
    joinRef.current?.arrived(demo.id);
    if (status === "direct" || status === "relay") {
      joinRef.current?.live(demo.id);
    }
  }, [demo?.id, status]);
  // REQ-821 — the grace began or ended: placed at once, not at the next PILL_CHECK_MS tick
  useEffect(() => {
    placeRef.current();
  }, [joined]);
  useEffect(() => () => joinRef.current?.dispose(), []);
  // REQ-647 (cycle 5, m23) — the customer pressed or typed in the page: "started a new demo" has
  // been read. A press on the pill itself (End, the details) is not: the line stays while they act
  //    REQ-821 — the same input ends a first join's grace
  useEffect(() => {
    if (inert || (!fresh && !joined)) return;
    const read = (e: Event) => {
      const at = e.target as Element | null;
      if (at?.closest?.("[data-demo-overlay]")) return;
      restartRef.current?.touched();
      joinRef.current?.touched();
    };
    const opts = { capture: true, passive: true };
    document.addEventListener("pointerdown", read, opts);
    document.addEventListener("keydown", read, opts);
    return () => {
      document.removeEventListener("pointerdown", read, opts);
      document.removeEventListener("keydown", read, opts);
    };
  }, [fresh, joined]);
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
        // REQ-823 (M2) — just signed out: a page of a dead sign-in rejoins no demo; REQ-834 —
        // only for SIGNOUT_HOLD_MS (or until a sign-in elsewhere), then the server decides
        if (gateRef.current?.holds()) return;
        // signed out, or the backend is away: it throws, nothing to draw, ask again later. A
        // hidden tab never holds a connection (HTTP/1.1 allows six per host) — REQ-217: it does
        // not ask at all (above), so a visible one holds the ask
        const wait = document.visibilityState === "visible"
          ? ACTIVE_WAIT_MS
          : 0;
        const a = await demoModeClient.active({ path: here(), wait });
        if (!alive || gateRef.current?.holds()) return;
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
      void knowWho();
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

  // 1c. REQ-855 (cycle dm3, m6) — the presenter's pill speaks the presenter's language: this page's
  //     one whoami, asked as a demo this staff presents shows (or Demo was pressed here)
  const presenterSide = !inert && (demo?.role === "presenter" || !!opening);
  useEffect(() => {
    if (!presenterSide) return;
    let alive = true;
    void knowWho().then((w) => {
      if (alive) setStaffWho(w);
    });
    return () => {
      alive = false;
    };
  }, [presenterSide]);
  // 1d. REQ-855 (m5) — the impersonation bar is not drawn beside the presenter's pill: it hears
  //     whether this page still shows a demo this staff presents (gone: the bar is the way back)
  const presentingHere = !inert && demo?.role === "presenter";
  const presentingRef = useRef(false);
  useEffect(() => {
    // on the way out (End / Leave from the pill) the page is leaving: no red bar for a frame
    if (presentingRef.current === presentingHere || goingOutRef.current) return;
    presentingRef.current = presentingHere;
    globalThis.dispatchEvent(
      new CustomEvent(DEMO_PRESENTING_EVENT, { detail: presentingHere }),
    );
  }, [presentingHere]);
  /** REQ-855 (m5) — the presenter's way out from the pill (where the red bar's Return used to be):
   *  End (alone — it asked first, like the stage's) or Leave (others present: it goes on with them),
   *  then the account comes back and /admin says so — the stage's end() / leave() and
   *  backToOwnAccount, in the presenter's language */
  async function presenterOut(d: Demo, how: "end" | "leave") {
    if (goingOutRef.current) return;
    goingOutRef.current = true;
    setGoingOut(true);
    const lang = presenterLangFor(staffWho);
    // REQ-235 — said at once, before the server answers
    if (how === "end") {
      sayEnded({ by: "you" }); // REQ-895 — and to the stage, before the end
      setNotice({ by: "you" });
    }
    try {
      if (how === "end") await demoModeClient.end(d.id);
      else await demoModeClient.leave(d.id);
    } catch {
      // the server ends a demo nobody presents any more on its own
    }
    try {
      const who = await adminClient.whoami();
      if (who.impersonating) await adminClient.stopImpersonating();
    } catch {
      // not impersonating, or signed out
    }
    globalThis.location.href = how === "end"
      ? endedHref({ by: "you" }, lang)
      : withLang(ADMIN_PATH, lang);
  }

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
    /** REQ-837 (demo dm2 m3) — where each presenter's tag was last drawn here, and his arrow's
     *  last placing: a tag that moves (another side, its initials at rest) is reported again, so
     *  the stage draws his tag where this screen has it */
    const tags = new Map<string, TagPlace | null>();
    const lastPlaced = new Map<
      string,
      { a: Anchor; p: NonNullable<ReturnType<typeof placeOnScreen>> }
    >();
    tagSinkRef.current = (pid, tg) => {
      tags.set(pid, tg);
      const lp = lastPlaced.get(pid);
      if (lp) {
        reporter.report(placedReport(pid, lp.a, lp.p, viewportBox(), tg));
      }
    };
    const place = (pid: string, a: Anchor, kind: "move" | "click") => {
      const p = placeOnScreen(a);
      // REQ-451 — what he pointed at is not on this page (any more): no arrow, kept until it is
      // back or he points elsewhere
      if (!p) {
        lastPlaced.delete(pid);
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
      lastPlaced.set(pid, { a, p });
      reporter.report(
        placedReport(pid, a, p, viewportBox(), tags.get(pid) ?? null),
      );
      placed.set(pid, { ...p.at, outside: p.outside });
      // REQ-437 — the element's box goes with the point: the tag sits outside it
      command(pid, {
        kind,
        at: p.at,
        outside: p.outside && !p.dir,
        off: a.o === 1,
        // REQ-645 (c4-M6) — out of view: the chevron where it can be seen, and the way to it
        cue: p.dir
          ? {
            box: p.box,
            text: t(cueKey(p.dir), { name: nameOf(pid) }),
            dir: p.dir, // REQ-815 — the chevron placed by the way, as the stage's ghost is
          }
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
      // REQ-850 (dm3 p10) — the window narrowed past her still cursor: it is off her screen
      if (!inViewport(rest, viewportBox())) {
        throttle.cancel();
        dropRest();
        return;
      }
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
    // REQ-836 (demo-loop cycle dm2, m1) — a name the customer saves on this page (Settings,
    // /welcome's first step: no page load) goes to the stage at once; it asks who they are now
    const stopRenames = relayRenames((m) => link?.send(m));
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
      stopRenames();
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
      tagSinkRef.current = null;
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
  /** REQ-816 / REQ-835 (demo-loop cycle dm2, M2) — End asking: the pill at its size now, kept
   *  inside the window — anchored at left PILL_MARGIN and its foot PILL_BAND_GAP above the visible
   *  bottom. A pill that fits keeps its dock (REQ-300); atRef is the box it fits */
  const clampAsk = () => {
    const el = pillRef.current;
    if (!el || el.hasAttribute("data-tucked")) return;
    const vv = globalThis.visualViewport;
    const view = {
      w: globalThis.innerWidth,
      h: vv ? vv.offsetTop + vv.height : globalThis.innerHeight,
    };
    const { dock: next, fit } = askDock({
      view,
      dock: dockRef.current,
      size: { w: el.offsetWidth, h: el.offsetHeight },
    });
    if (next !== dockRef.current) {
      dockRef.current = next;
      setDock(next);
    }
    atRef.current = { left: fit.left, top: fit.top, tab: false };
  };
  /** REQ-852 (demo-loop cycle dm3, p4) — End's question just came up: the asking box (its size
   *  now) is placed ONCE where no control of the page is under it (`askSpot`: the current anchor,
   *  the same row at the opposite edge, the bottom row; else the fewest), counted through a
   *  dialog's backdrop. clampAsk runs after it (REQ-835) and REQ-300 freezes it from then on */
  const placeAsk = () => {
    const el = pillRef.current;
    if (!el || el.hasAttribute("data-tucked")) return;
    if (typeof document.elementsFromPoint !== "function") return;
    const vv = globalThis.visualViewport;
    const view = {
      w: globalThis.innerWidth,
      h: vv ? vv.offsetTop + vv.height : globalThis.innerHeight,
    };
    const backdrop = dialogBackdropUp();
    // REQ-876 (demo-loop cycle dm5, m2) — where End was just pressed (a stale press, or the
    // keyboard: none) and where the answers sit in the asking pill, so they open near it
    const press = endPressRef.current;
    const near = press && Date.now() - press.at < 5000
      ? { left: press.x, top: press.y, width: 0, height: 0 }
      : undefined;
    const box = el.getBoundingClientRect();
    const yes = el.querySelector('[data-cy="demo-end-confirm"]')
      ?.getBoundingClientRect();
    const no = el.querySelector('[data-cy="demo-end-cancel"]')
      ?.getBoundingClientRect();
    const answers = yes && no
      ? {
        left: Math.min(yes.left, no.left) - box.left,
        top: Math.min(yes.top, no.top) - box.top,
        width: Math.max(yes.right, no.right) - Math.min(yes.left, no.left),
        height: Math.max(yes.bottom, no.bottom) - Math.min(yes.top, no.top),
      }
      : undefined;
    const { dock: next } = askSpot({
      view,
      dock: dockRef.current,
      size: { w: el.offsetWidth, h: el.offsetHeight },
      controls: (r) => countControls(r, backdrop),
      near,
      answers,
    });
    if (next !== dockRef.current) {
      dockRef.current = next;
      setDock(next);
    }
  };
  // REQ-830 (demo-loop cycle dm2, p6) — the first place() runs before paint (a layout effect): a
  // full load never paints the whole pill at home for a frame before it folds and moves. The
  // interval and the listeners stay in the effect below
  useLayoutEffect(() => {
    if (!shown) return;
    const sendPill = () => {
      const el = pillRef.current;
      const at = atRef.current;
      // REQ-835 (demo-loop cycle dm2, m2) — the whole pill: its REAL box (the dock translate
      // included), less the glide still to go — never atRef's left/top with a size measured now
      // (End's question widens it and REQ-816 moves it while place() is frozen)
      const r: Rect | null = el && at
        ? at.tab
          ? {
            left: at.left,
            top: at.top,
            width: PILL_TAB.w,
            height: PILL_TAB.h,
          }
          : pillRestBox(
            el.getBoundingClientRect(),
            translateOf(getComputedStyle(el).transform),
            dockRef.current,
          )
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
          // REQ-822 (dm1, m1) — End's question, as this pill shows it
          asking: f.asking,
          ask: f.ask,
          yes: f.yes,
          no: f.no,
          // REQ-838 (dm2, m5 + p4) — this pill's own words for what the stage guesses
          connectingLabel: f.connectingLabel,
          endedLabel: f.endedLabel,
          // REQ-835 (dm2, m2) — it wraps into rows (the phone's pill asking or opened)
          wraps: f.wraps,
          // REQ-895 (dm6, m6) — this pill is the ended notice
          notice: f.notice,
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
      // REQ-822 (dm1, m1) — the stage still hears what the pill says (End asking), without moving it
      // REQ-835 (dm2, M2) — still kept inside the window (a resize under the question): it moves
      // only when it would be off-screen, so a Yes that fits stays where it was seen
      if (el.querySelector('[data-cy="demo-end-ask"]')) {
        clampAsk();
        sendPill();
        return;
      }
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
      // REQ-849 (cycle dm3, p14) — its real width rounded up (offsetWidth rounds 444.08 down to
      // 444, which put a right-edge pill 0.08 px past its place)
      // REQ-890 — the form on screen, read off the pill itself: this closure's `compact` /
      // `peekCompact` are the mount's (stale), and the compact peek's size went into the whole
      // pill's slot (a 282 px "whole" pill on /customers)
      const compactNow = el.hasAttribute("data-compact");
      const peekCompactNow = compactNow && !narrow();
      if (!folded) {
        const r = el.getBoundingClientRect();
        const size = { w: Math.ceil(r.width), h: el.offsetHeight };
        // REQ-890 — the compact form shown only for a peek: its size kept apart, the whole's stays
        if (peekCompactNow) compactSizeRef.current = size;
        else fullRef.current = size;
      }
      const home = pillHome({
        view,
        size: fullRef.current ?? { w: el.offsetWidth, h: PILL_TAB.h },
      });
      const can = typeof document.elementsFromPoint === "function";
      const floats = floatsRef.current;
      const minimal = yieldsRef.current &&
        isPublicDocPath(globalThis.location.pathname);
      // REQ-832 (cycle dm2, p1) — the dialog's backdrop, found once: the counters look through it
      const backdrop = can ? dialogBackdropUp() : null;
      const dialog = backdrop !== null;
      // REQ-545 (demo-loop cycle 4, m2) — the pill YIELDS to the page; a dialog docks it home,
      // above the dialog's box, top-left, top-right, else folds it. REQ-781 (cycle dv1, d7) — it
      // floats: no band, never over a control
      // REQ-853 (demo-loop cycle dm3, p8) — the mini-pill's spot now, or the one carried from the
      // last page (REQ-830): kept while it is still clear, so the page's data replacing its
      // skeleton does not make the chip hop between equally clear spots
      const was = lastPlaceRef.current?.tucked ? lastPlaceRef.current : null;
      const keptEdge = was ? tabBox(home.box) : null;
      const kept = was && keptEdge
        ? {
          ...keptEdge,
          left: keptEdge.left + was.tabAt.x,
          top: keptEdge.top + was.tabAt.y,
        }
        : undefined;
      const p = placePill({
        home: home.box,
        view,
        top: bannerH(),
        keep: kept,
        dialog,
        // REQ-637 (cycle 5, m5) — docked just above the dialog's own box first
        dialogBox: dialog ? dialogPanel() : undefined,
        minimal,
        blocked: can ? (r) => pageUnder(r, backdrop) : () => 0,
        controls: can ? (r) => countControls(r, backdrop) : () => 0,
        // REQ-897 AMENDMENT (dm7, m3) — the hold is for a spot placed on THIS page: a spot carried
        // from the last page (REQ-830) is judged on arrival, even while the page's own hash scroll
        // is still running (it held the chip over /settings' email field for 1.5 s)
        scrolling: scrollingRef.current && placedHereRef.current,
        yields: yieldsRef.current,
        floats,
      });
      // REQ-765 (cycle 5v2, p18-3d) — the dialog's dim rides to the stage, which draws the pill
      // itself over the replayed page (the mirror skips the overlay); the pill here is softened
      // under it, still clickable
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
      peekTabRef.current = p.tucked ? p.box : null;
      if (p.tucked) {
        setTabAt({
          x: Math.round(p.box.left - edge.left),
          y: Math.round(p.box.top - edge.top),
        });
      }
      // tucked: a hover or tap shows the whole pill out of its tab — at the tab's edge, PILL_MARGIN
      // in (REQ-849), held while the pointer is on it or on the tab's box (leaving folds it). REQ-818 (cycle dm1,
      // m5) — unless a control is under it there (a footer link): slid along the tab's row to the
      // place with the fewest controls, inside the window. Measured only while it is out (a peek
      // places it again): a folded tab costs no sampling of the row
      // REQ-890 — a peek already shown compact (this row was crowded) is placed as the compact
      // pill it is; a whole one offers its compact size (once known) for a crowded row
      const peekCompactSize = peekCompactNow ? compactSizeRef.current : null;
      const peekHome = peekCompactSize
        ? pillHome({ view, size: peekCompactSize }).box
        : home.box;
      const box = p.tucked
        ? peekBox({
          home: peekHome,
          view,
          tab: p.box,
          top: bannerH(),
          controls: can && peekRef.current
            ? (r) => countControls(r, backdrop)
            : () => 0,
          compact: peekCompactSize
            ? undefined
            : compactSizeRef.current ?? undefined,
        })
        : p.box;
      // REQ-890 — the tab's row holds a control under every x for the whole pill: the compact
      // form is shown (and measured again, a frame later) rather than the pill moving away from
      // the tab or landing on a control. Its size unknown yet: shown as soon as the whole pill
      // would leave the tab's row
      if (
        p.tucked && peekRef.current && !compactNow && !peekForAskRef.current
      ) {
        const onRow = Math.round(box.top + box.height) ===
          Math.round(p.box.top + p.box.height);
        const crowded = ("crowded" in box && !!box.crowded) ||
          ("compact" in box && !!box.compact);
        if (crowded || (!compactSizeRef.current && !onRow)) {
          setPeekCompact(true);
        }
      }
      setDock({
        x: Math.round(box.left - home.box.left),
        y: Math.round(box.top - home.box.top),
      });
      atRef.current = shownTab
        ? { left: p.box.left, top: p.box.top, tab: true }
        : { left: box.left, top: box.top, tab: false };
      // REQ-830 — the placement the next page starts from (kept as it changes, and as the page goes)
      const next: PillPlace = {
        tucked: p.tucked,
        tabAt: p.tucked
          ? {
            x: Math.round(p.box.left - edge.left),
            y: Math.round(p.box.top - edge.top),
          }
          : lastPlaceRef.current?.tabAt ?? { x: 0, y: 0 },
        dock: {
          x: Math.round(box.left - home.box.left),
          y: Math.round(box.top - home.box.top),
        },
        ...(fullRef.current ? { full: { ...fullRef.current } } : {}),
      };
      if (JSON.stringify(next) !== JSON.stringify(lastPlaceRef.current)) {
        lastPlaceRef.current = next;
        placedHereRef.current = true;
        const d = demoRef.current;
        if (d?.role === "viewer" && !goneRef.current) {
          keepDemo(
            sessionStore(),
            d,
            peerOnlineRef.current,
            Date.now(),
            lastPlaceRef.current,
          );
        }
      }
      sendPill();
    };
    placeRef.current = place;
    place();
    return () => {
      placeRef.current = () => {};
      sendPillRef.current = () => {};
      // the pill is gone (or re-mounted): the stage drops its ghost
      if (sentPillRef.current) {
        sentPillRef.current = null;
        linkRef.current?.send({ k: "pill", r: null });
      }
    };
  }, [shown, demo?.role]);
  // REQ-379 / REQ-545 — the pill is placed again on a timer, on resize, on scroll and when it
  // changes size (REQ-830: the first place() already ran, before paint, above)
  useEffect(() => {
    if (!shown) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const place = () => placeRef.current();
    // REQ-835 / REQ-830 (reconciled on demo-fixes) — sendPill lives in the layout effect above
    const sendPill = () => sendPillRef.current();
    const later = () => {
      clearTimeout(settle);
      settle = setTimeout(place, 150);
    };
    // REQ-379 — across PILL_COMPACT_MAX_W the form switches at once (a tap right after the
    // resize finds the phone's pill), then the band is measured again
    const onResize = () => {
      setCompact(narrow());
      // REQ-835 (dm2, M2) — End asking: measured again once the compact form has rendered, and
      // pulled back inside the narrowed window
      requestAnimationFrame(() => {
        if (pillRef.current?.querySelector('[data-cy="demo-end-ask"]')) {
          clampAsk();
          sendPill();
        }
      });
      later();
    };
    const timer = setInterval(place, PILL_CHECK_MS);
    addEventListener("resize", onResize);
    // REQ-545 — what scrolls into the bottom strip tucks the pill (any scroller: capture).
    // REQ-897 (cycle dm6, p5) — while the events come the folded chip holds its spot; once they
    // have stopped for PILL_SCROLL_SETTLE_MS it is placed once more against what is under it now
    let scrollSettle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      scrollingRef.current = true;
      clearTimeout(scrollSettle);
      scrollSettle = setTimeout(() => {
        scrollingRef.current = false;
        place();
      }, PILL_SCROLL_SETTLE_MS);
      later();
    };
    addEventListener("scroll", onScroll, { capture: true, passive: true });
    // REQ-851 (demo-loop cycle dm3, p3) — End asking: the pill's wrap reflow (a taller pill, a
    // new row) is clamped and sent at once — a size change fires no transitionend, and the
    // stage's ghost must not keep the pre-wrap box for the debounce
    const resized = () => {
      if (pillRef.current?.querySelector('[data-cy="demo-end-ask"]')) place();
      later();
    };
    const ro = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(resized);
    if (pillRef.current) ro?.observe(pillRef.current);
    // REQ-853 (demo-loop cycle dm3, p8) — the PAGE changed under the pill (a skeleton swapped for
    // its data, a list grown, a footer drawn): placed again in the next frame, not at the next
    // PILL_CHECK_MS tick 0.7 s later. The body's size and any node added or removed outside the
    // overlay (its own renders never re-place it: no loop)
    let frame = 0;
    const nextFrame = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    const pageRo = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(nextFrame);
    pageRo?.observe(document.body);
    const mo = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
        for (const m of records) {
          const at = m.target instanceof Element
            ? m.target
            : m.target.parentElement;
          if (at?.closest?.("[data-demo-overlay]")) continue;
          nextFrame();
          return;
        }
      });
    mo?.observe(document.body, { childList: true, subtree: true });
    // REQ-835 (dm2, m2) — the glide ended: the stage hears the box it came to rest in
    const glided = pillRef.current;
    glided?.addEventListener("transitionend", sendPill);
    return () => {
      glided?.removeEventListener("transitionend", sendPill);
      clearInterval(timer);
      clearTimeout(settle);
      clearTimeout(scrollSettle);
      scrollingRef.current = false;
      placedHereRef.current = false;
      ro?.disconnect();
      pageRo?.disconnect();
      mo?.disconnect();
      cancelAnimationFrame(frame);
      removeEventListener("resize", onResize);
      removeEventListener("scroll", onScroll, { capture: true });
      foldTimer.current?.cancel();
    };
  }, [shown, demo?.role]);

  // REQ-895 (demo-loop run 6, m6) — the pill just turned into the ended notice: its face goes to
  // the stage NOW, before paint. It used to wait for the next PILL_CHECK_MS tick (the notice is
  // the overlay's own render, which the page observers ignore), and the server's answer closed
  // the link first: the stage's last frame kept the old pill with a status chip ("Ter…")
  useLayoutEffect(() => {
    if (notice) placeRef.current();
  }, [notice]);

  // REQ-816 (demo-loop cycle dm1, M1) — End's question just came up: the pill is wider now (and
  // two rows on the phone), and REQ-300 freezes its place while it asks. Placed from the right edge
  // (a peek from the right-edge mini-pill, the bottom-right / top-right spot) it grew past the
  // window's right edge, "Yes, end it" off-screen — so it is placed once at its asking size, before
  // paint, and only then frozen. REQ-835 (cycle dm2, m2 + M2) — the clamp is `clampAsk`, run here
  // and by place() on every re-place while End asks (a resize, the interval, a scroll); it writes
  // atRef from the box it fits
  useLayoutEffect(() => {
    if (!asking) return;
    // REQ-852 (cycle dm3, p4) — first where no control is, then kept in view
    placeAsk();
    clampAsk();
    // the compact form a resize switched to lands a frame later: measured again
    const id = requestAnimationFrame(clampAsk);
    // the stage's ghost follows the move
    const sent = setTimeout(() => sendPillRef.current(), PILL_MOVE_MS + 20);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(sent);
    };
  }, [asking]);

  // REQ-372 — the pill's words changed (status, compact, opened): the stage hears it; a render that
  // changed nothing sends nothing (sendPill compares)
  useEffect(() => {
    sendPillRef.current();
  });
  // REQ-545 — the tab opened or closed: the stage hears where the pill is now
  useEffect(() => {
    placeRef.current();
  }, [peek, open, fresh, compact]);
  // REQ-890 — the peek folded: the whole form again
  useEffect(() => {
    if (!peek) {
      setPeekCompact(false);
      peekForAskRef.current = false;
    }
  }, [peek]);
  // REQ-849 (demo-loop cycle dm3, p14) — while the pill is out of its tab: where the mouse is, and
  // a pointer that was in the pill-plus-tab region leaving it folds it (as leaving the pill does)
  useEffect(() => {
    if (!peek) return;
    let inside = false;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      pointRef.current = { x: e.clientX, y: e.clientY };
      const el = pillRef.current;
      if (!el) return;
      const pill = el.getBoundingClientRect();
      const tab = peekTabRef.current;
      // REQ-890 — the pointer on the pill or the tab: its way between them is not a leave for
      // PEEK_TRAVEL_MS from here
      if (peekHolds({ pill, tab, ...pointRef.current })) {
        peekSinceRef.current = Date.now();
      }
      const now = peekHolds({
        pill,
        tab,
        ...pointRef.current,
        since: peekSinceRef.current,
        now: Date.now(),
      });
      if (inside && !now) foldTimer.current?.arm(300);
      inside = now;
    };
    const opts = { capture: true, passive: true };
    document.addEventListener("pointermove", move, opts);
    return () => document.removeEventListener("pointermove", move, opts);
  }, [peek]);
  // REQ-820 — the whole pill is painted where it is: from the next move on, it glides again
  useEffect(() => {
    if (!noGlide) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setNoGlide(false));
    });
    return () => cancelAnimationFrame(id);
  }, [noGlide]);

  if (inert) return null;

  /** REQ-545 — the tucked pill shows whole: on hover until left, on a tap for PILL_PEEK_MS */
  const folded = tucked && !peek;
  // REQ-820 (demo-loop cycle dm1, m6) — held (a pointer on the pill, End asking): it waits again
  const unpeekIn = (ms: number) => foldTimer.current?.arm(ms);
  /** the tab hovered or tapped: whole, until the pointer has been in and left (a tap with no
   *  pointer on it: PILL_PEEK_MS) */
  const openPeek = () => {
    // REQ-820 — out of the tab with no glide (it never slides in from the tab's translate)
    if (!peekRef.current) {
      setNoGlide(true);
      peekSinceRef.current = Date.now(); // REQ-890
    }
    setPeek(true);
    unpeekIn(PILL_PEEK_MS);
  };
  const leavePeek = () => {
    if (peekRef.current) unpeekIn(300);
  };

  // REQ-379 — ONE home: bottom-left (REQ-781: floating, no band kept for it), its bottom on the visible
  // bottom (above an iOS keyboard, like the shells' --vvh); a dialog over the home docks it (a
  // glide). No measure is written back: it is as wide as its content, capped by the window. Its
  // empty area lets a click through to the page (M28): only its buttons (HIT) take one
  const at =
    `left:${PILL_MARGIN}px;bottom:calc(100% - var(--vvt, 0px) - var(--vvh, 100%) + ${PILL_BAND_GAP}px);transform:translate(${dock.x}px, ${dock.y}px);${
      // REQ-820 — the frame out of the tab jumps to its box; later moves glide
      noGlide
        ? "transition:none"
        : `transition:transform ${PILL_MOVE_MS}ms ease`}`;
  const pillStyle =
    `position:fixed;${at};z-index:${PILL_Z};display:flex;${PILL_BOX_METRICS};align-items:center;justify-content:space-between;flex-wrap:nowrap;white-space:nowrap;max-width:calc(100vw - ${
      2 * PILL_MARGIN
    }px);box-sizing:border-box;border-radius:14px;background:#1f3d1b;color:#fff;font-family:${PILL_FONT};box-shadow:0 4px 18px rgba(0,0,0,.35);${
      // REQ-545 — shown whole from its tab, it takes the pointer, so leaving it folds it again
      tucked ? "pointer-events:auto" : "pointer-events:none"};${
      // REQ-765 (cycle 5v2, p18-3d) — under a dialog's dim: softened, never hidden, still clickable
      underDim ? `opacity:${PILL_UNDER_DIALOG_OPACITY}` : "opacity:1"}`;
  // REQ-545 (demo-loop cycle 4, m2) — the pill folded on the window's left edge, its foot on the
  // home's foot: only its buttons take a click. REQ-637 (cycle 5, m5) — a labelled mini-pill
  // ("● Demo" and an × that is End), never a bare 16 px sliver
  // REQ-781 (cycle dv1, d7) — or on the right edge (`tabAt`), when the left one has a control;
  // REQ-818 (cycle dm1, m5) — or along the bottom edge, fully round
  const tabR = PILL_TAB.h / 2;
  const tabStyle =
    `position:fixed;left:0;bottom:calc(100% - var(--vvt, 0px) - var(--vvh, 100%) + ${PILL_BAND_GAP}px);transform:translate(${tabAt.x}px, ${tabAt.y}px);z-index:${PILL_Z};display:flex;align-items:stretch;width:${PILL_TAB.w}px;height:${PILL_TAB.h}px;box-sizing:border-box;padding:0;border-radius:${
      tabAt.x <= 0
        ? `0 ${tabR}px ${tabR}px 0`
        // REQ-818 (cycle dm1, m5) — along the bottom edge (no window edge beside it): round
        : tabAt.x + PILL_TAB.w < (globalThis.innerWidth || 0)
        ? `${tabR}px`
        : `${tabR}px 0 0 ${tabR}px`
    };background:#1f3d1b;color:#fff;font-family:${PILL_FONT};font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.3);pointer-events:none;opacity:${
      underDim ? PILL_UNDER_DIALOG_OPACITY : 1
    }`;
  /** one line: a long name is cut, not wrapped (the live pill's rule, REQ-228) */
  const cut = "overflow:hidden;text-overflow:ellipsis;min-width:0";
  // REQ-294 (demo m21) — the words that carry a name wrap to as many lines as it needs: the ended
  // notice always, the phone's details once opened; the title goes on a phone
  const wrap = "white-space:normal;min-width:0;overflow-wrap:anywhere";

  // REQ-855 (cycle dm3, m6) — the presenter's own chrome speaks the presenter's language (`pt`),
  // never the customer page's; `chromeT` is the demo chrome's `t` (the customer's pill's)
  const pLang = presenterLangFor(staffWho);
  const pt = (key: string, vars?: Vars) => tFor(pLang, key, vars);
  const chromeT = t;
  /** REQ-895 (dm6, m6) — the ended notice's face, as the notice branch renders it: the stage
   *  draws it as the notice (title · text · ×), never with a status chip */
  const noticeFaceOf = (n: EndedNotice): PillFace => {
    // REQ-855 (m6) — the end of a demo this staff presented is said in the presenter's language
    // (on a customer's page the chrome's t is hers); the customer's notice keeps the chrome's
    const nt = lastRoleRef.current === "presenter" ? pt : chromeT;
    const said = endedText(n);
    return {
      compact,
      open: false,
      status: "ended",
      text: nt(said.key, said.vars),
      label: nt("demoMode.ended"),
      title: nt("demoMode.title"),
      notice: true,
    };
  };
  /** REQ-895 — the notice said to the stage NOW, before this side's `end` reaches the server:
   *  the stage's socket closes on the server's `ended`, and a face sent after the next render
   *  (place() samples the page first) lost that race by ~100 ms — the stage's last frame kept
   *  the old pill with a status chip ("Ter…") */
  const sayEnded = (n: EndedNotice) => {
    faceRef.current = noticeFaceOf(n);
    sendPillRef.current();
  };

  // REQ-235 — the demo is over: who ended it, in the pill's place, until dismissed (Demo clicked
  // here again takes over)
  yieldsRef.current = false;
  floatsRef.current = false;
  if (notice && !opening) {
    // REQ-643 (demo-loop cycle 5, m9) — a floating message: it never folds
    floatsRef.current = true;
    const t = lastRoleRef.current === "presenter" ? pt : chromeT;
    const said = endedText(notice);
    faceRef.current = noticeFaceOf(notice); // REQ-895 — the notice it is: no chip, a ×
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
      text: pt("demoMode.presenting", { name: opening.targetName }),
    };
    // REQ-179 — Demo was just clicked: the pill is up before the server answers (REQ-855: in the
    // presenter's language — on /admin, the page's own)
    return (
      <div data-demo-overlay ref={fenceClicks}>
        <div
          ref={pillRef}
          data-cy="demo-pill"
          role="status"
          lang={pLang}
          style={pillStyle}
        >
          <strong>{pt("demoMode.title")}</strong>
          <span style={cut}>
            {pt("demoMode.presenting", { name: opening.targetName })}
          </span>
          <span
            data-cy="demo-opening"
            style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"
          >
            {pt("demoMode.opening")}
          </span>
        </div>
      </div>
    );
  }

  // the presenter's own pill lives on the stage. On the way there, say so; on any other staff page
  // (REQ-232: another window, /admin after Return to your account) offer the way back — never take it.
  // REQ-855 (cycle dm3, m5 + m6) — in the presenter's language (`pt`), drawn once whoami has said
  // whose that is. Where this browser acts as the customer (the red bar is not drawn beside it) it
  // carries the way out — End demo (it asks first), or Leave the demo when others present too —
  // and the presenter's own EN | ES switch: this page with ?lang=, persisted (never the customer's
  // topbar toggle, which saves HER profile). On /admin's guide gate the card carries both.
  if (demo.role === "presenter") {
    const busy = placing || !!opening;
    if (!busy && staffWho === undefined) return null;
    const acting = !busy && staffWho?.impersonating === true &&
      !adminGateShown({
        path: globalThis.location.pathname,
        impersonating: true,
        superAdmin: staffWho.superAdmin === true,
      });
    const outline =
      "padding:5px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.7);background:transparent;color:#fff;cursor:pointer;font:inherit;font-size:12px;font-weight:700";
    return (
      <div data-demo-overlay ref={fenceClicks}>
        <div
          ref={pillRef}
          onPointerDownCapture={(e) => {
            // REQ-876 — where End is pressed: End's question opens near it
            endPressRef.current = {
              x: e.clientX,
              y: e.clientY,
              at: Date.now(),
            };
          }}
          data-cy="demo-pill"
          role="status"
          lang={pLang}
          style={pillStyle}
        >
          <strong>{pt("demoMode.title")}</strong>
          <span style={cut}>
            {pt("demoMode.presenting", { name: demo.targetName })}
          </span>
          {busy
            ? (
              <span
                data-cy="demo-opening"
                style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"
              >
                {pt("demoMode.opening")}
              </span>
            )
            : (
              <button
                type="button"
                data-cy="demo-rejoin"
                disabled={goingOut}
                onClick={() => void placePresenter(demo)}
                style={`padding:5px 12px;border-radius:8px;border:0;background:#fff;color:#1f3d1b;cursor:pointer;font:inherit;font-size:12px;font-weight:700;${HIT}`}
              >
                {pt("demoMode.rejoin")}
              </button>
            )}
          {acting && stageLeaveShown(demo.presenters.length)
            ? (
              <button
                type="button"
                data-cy="demo-leave"
                disabled={goingOut}
                onClick={() => void presenterOut(demo, "leave")}
                style={`${outline};${HIT}`}
              >
                {pt("demoMode.leave")}
              </button>
            )
            : acting
            ? (
              <EndDemo
                t={pt}
                outline
                disabled={goingOut}
                onAsking={setAsking}
                onEnd={() => void presenterOut(demo, "end")}
              />
            )
            : null}
          {acting
            ? (
              <span
                data-cy="demo-lang"
                role="group"
                aria-label={pt("demoMode.yourLanguage")}
                title={pt("demoMode.yourLanguage")}
                style={`display:inline-flex;gap:2px;${HIT}`}
              >
                {(["en", "es"] as Lang[]).map((l) => (
                  <a
                    key={l}
                    data-cy={`demo-lang-${l}`}
                    href={langToggleHref(globalThis.location.href, l)}
                    hreflang={l}
                    aria-current={l === pLang ? "true" : "false"}
                    onClick={() => {
                      persistLang(l);
                      persistDemoLang(l); // REQ-863: the demo's language, for his other tabs
                    }}
                    style={`padding:3px 6px;border-radius:6px;color:#fff;text-decoration:none;font-size:11.5px;font-weight:700;${
                      l === pLang
                        ? "background:rgba(255,255,255,.22)"
                        : "opacity:.7"
                    }`}
                  >
                    {l.toUpperCase()}
                  </a>
                ))}
              </span>
            )
            : null}
        </div>
      </div>
    );
  }

  // the phone pill's details opened (a tap, to read them): shown until closed — never tucked away
  // under the hand that opened them; nor while it says a new demo started (REQ-298); nor for the
  // first seconds of a join, so "{name} is guiding you" and End are seen whole (REQ-821)
  yieldsRef.current = !(compact && open) && !fresh && !joined;
  // REQ-214 — the presenters, by name; a demo written before the list has the one
  const presenters: Presenter[] = demo.presenters.length > 0
    ? demo.presenters
    : [{ userId: "", name: demo.presenterName, color: "#2f6d29" }];
  const names = presenters.map((p) => p.name).join(", ");
  // REQ-232 (demo-lifecycle-p1) — plain words: is the staff here or not; never how the bytes travel.
  // REQ-535 — a page loaded from a connected one says Connected through the grace
  const live = showsConnected(status, carrying, activeOk);
  // REQ-838 (demo-loop cycle dm2, p8) — the link is up and no stage is: the guide stepped away
  // and the demo is still open — never "Connecting…" under "{name} is guiding you"
  const pillStatus = pillStatusOf(status, live);
  const away = pillStatus === "away";
  const guidingText = away
    ? t("demoMode.stillOpen")
    : presenters.length > 1
    ? t("demoMode.guidingMany", { names })
    : t("demoMode.guiding", { name: names });
  // REQ-298 — just restarted: the line says so (and the pill pulses) before "is guiding you"
  const started = fresh
    ? startedText(demo.presenters, demo.presenterName)
    : null;
  const line = started ? t(started.key, started.vars) : guidingText;
  const statusLabel = pillStatus === "ended"
    ? t("demoMode.ended")
    : live
    ? t("demoMode.connected")
    : away
    ? (presenters.length > 1
      ? t("demoMode.guideAwayMany", { names })
      : t("demoMode.guideAway", { name: names }))
    : t("demoMode.connecting");
  // REQ-373 (demo m2, p13-h) — the guide's first name on the compact pill; the name said once
  const copy = pillCopy({ presenters, status: statusLabel, compact, open, t });
  /** REQ-373 — "● Alex" beside the status while the details are hidden; REQ-838 — not while
   *  the status names him ("Alex stepped away"); REQ-833 — nor through a join's grace, when the
   *  details row names the guide */
  const showGuide = copy.showShort && !started && !away && !joined;
  // REQ-372 — what this pill shows, for the stage's replica. REQ-430 (cycle 3, m4) — its status
  // in this pill's own words (the customer's language) and the guide's short name when shown
  faceRef.current = {
    compact,
    open: compact && open,
    status: pillStatus,
    text: line,
    label: statusLabel,
    guide: showGuide ? copy.shortName : undefined,
    // REQ-540 (cycle 4, m9) — the title and End in this pill's own words, so the stage's ghost
    // draws the whole pill (it hides the title on the compact pill, as this pill does)
    title: t("demoMode.title"),
    end: t("demoMode.end"),
    // REQ-838 (demo-loop cycle dm2, m5 + p4) — what the stage says on its own (this app dropped,
    // its next page joining) in this pill's words: its copy never mixes in the presenter's language
    connectingLabel: t("demoMode.connecting"),
    endedLabel: t("demoMode.ended"),
    // REQ-835 (demo-loop cycle dm2, m2) — it wraps into rows, so the stage's ghost does too
    wraps: pillWraps({ compact, open, asking }),
    // REQ-822 (demo-loop cycle dm1, m1) — End is asking: the question and both answers in this
    // pill's own words, so the stage's ghost draws them and the presenter knows
    ...(asking
      ? (() => {
        const w = endDemoWords(t, {
          askKey: "demoMode.endAskViewer",
          askVars: { name: names },
        });
        return { asking: true, ask: w.ask, yes: w.yes, no: w.no };
      })()
      : {}),
  };

  async function end() {
    const id = demo!.id;
    sayEnded({ by: "you" }); // REQ-895 — the stage hears the notice before the end
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
          z={POINTER_Z}
          offZ={OFF_MARK_Z}
          cmd={cmds[p.userId] ?? null}
          bounds={viewportBox()}
          onTag={(t) => tagSinkRef.current?.(p.userId, t)}
        />
      ))}
      {started && (
        <style>
          {`@keyframes pmDemoPulse{0%{box-shadow:0 4px 18px rgba(0,0,0,.35),0 0 0 0 rgba(255,255,255,.75)}100%{box-shadow:0 4px 18px rgba(0,0,0,.35),0 0 0 14px rgba(255,255,255,0)}}`}
        </style>
      )}
      <div
        ref={pillRef}
        onPointerDownCapture={(e) => {
          // REQ-876 (cycle dm5, m2) — where End (or the mini-pill's ×) is pressed: End's question
          // opens near it
          endPressRef.current = { x: e.clientX, y: e.clientY, at: Date.now() };
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") overPillRef.current = true;
        }}
        onPointerLeave={() => {
          overPillRef.current = false;
        }}
        onMouseLeave={tucked ? leavePeek : undefined}
        data-cy="demo-pill"
        data-restarted={started ? "" : undefined}
        data-tucked={folded ? "" : undefined}
        // REQ-890 — the compact form (the phone's, or a peek on a crowded row)
        data-compact={compact ? "" : undefined}
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
              // REQ-820 (demo-loop cycle dm1, m6) — real pointer movement, never a bare mouseenter:
              // a tab re-mounted under a resting pointer gets one from the hover update
              onMouseMove={openPeek}
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
                peekForAskRef.current = true; // REQ-890 AMENDMENT
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
              // REQ-298 — a restart is said even on the phone's compact pill; REQ-833 — and a
              // join's "{name} is guiding you" through its grace
              style={`display:${
                pillDetailsShown({
                    compact,
                    open,
                    started: started !== null,
                    joined,
                  })
                  ? "inline-flex"
                  : "none"
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
