/**
 * REQ-187 — the stage: the staff's demo page. A dark stage with ONE frame showing the customer's
 * screen at exactly their layout viewport, scaled to fit this window.
 *
 * REQ-242 — the frame is a live MIRROR of the customer's actual screen, not a second copy of the
 * app: the customer's app records its document and streams it here as `dom` chunks (a snapshot,
 * then the changes — shared/demo-mode/mirror.ts); the receiver puts the frames back in order and
 * the replayer builds them into the frame, a srcdoc document sandboxed with `allow-same-origin`
 * only, whose CSP forbids scripts — nothing of the app runs here, nothing is fetched as the
 * customer, nothing is written. Before the first snapshot the stage says it is connecting (no
 * invented phone, no page the customer is not on). A frame that does not fit the replay, or a gap
 * that lasts, asks the customer for a fresh snapshot (`resync`).
 *
 * Point only: a transparent layer covers the frame; the presenter's moves (REQ-393: tracked over
 * the whole stage) and clicks go out as fractions of the frame (REQ-188) plus the mirrored element
 * under them (REQ-242 — the customer's app puts the pointer on that same element) and never reach
 * the frame. The customer's pointer is
 * drawn the same way back. The presenter's resting pointer is sent again when the customer's page
 * joins and after every snapshot; the customer's pointer goes when their page changes or their app
 * drops. The pill: the customer's name, the link status, the frame size, End — which hands the
 * presenter their own account back (stop-impersonating → /admin).
 *
 * REQ-214 — several staff may present at once: the other presenters' pointers are drawn on the
 * frame too, each in their colour with their name, and the pill lists who is presenting.
 *
 * REQ-305 — a pointer's anchor is resolved against a SETTLED frame, and again whenever the frame's
 * layout moves: the customer's and the colleagues' last anchors are kept and placed again after
 * every applied frame, every settle and every resize (a point outside the frame goes on its edge,
 * pointing outside); the customer's pointer is hidden on a NEW page only, never on a resync of the
 * same one. This presenter's pointer names a mirrored node only once the replay's stylesheets are
 * in (before that the browser lays the frame out without them: the page's links stacked top-left,
 * a drawer in the flow) — a page mirrored afresh gets the resting pointer at once as a fraction of
 * the frame, then on the node under it, sent whenever that node changed.
 *
 * REQ-393 (demo M2, M8 — cycle 2) — one model on both screens: the presenter's resting pointer is
 * the spot under his still mouse. The mouse is followed document-wide — the frame, the margins
 * round a phone, the pill — and only leaving the window is a `leave`. After every layout pass of
 * the replay (a scroll, a change, its styles in, a settle, the stage resized) the resting pointer
 * is looked up again and sent when it names another place, rated like a move, on the reliable
 * channel (REQ-305 did that only while a snapshot settled; the customer's arrow then rode away
 * with its element). Beside the frame the anchor is where the mouse meets the frame's edge,
 * marked off their screen (`o`): their arrow sits on that edge, and the stage outlines the frame
 * and says "Your pointer is off {name}'s screen". A stage opened under a still mouse gets no
 * pointer event, so it starts where the page that opened it last saw the mouse (cursor-handoff),
 * and hands its own over when it goes. The frame layer only eats the presenter's clicks.
 *
 * REQ-451 (demo M1, M14 — cycle 3) — amends REQ-393: the presenter's pointer is what he POINTED
 * AT. A layout pass never looks his still mouse up again (only a fraction made before the replay
 * was styled is, once — `lookAgain`): the customer's overlay keeps the arrow on its element as
 * their page moves, and the stage draws a faint ghost of it where their screen has it whenever
 * that is apart from his cursor (PointerGhost) — one model on both screens. His anchor is kept
 * with the page load it was made on and sent again only to that load (`resendable`): a new page,
 * a reload or another tab gets no arrow until he moves — never a fraction under his still mouse.
 * The hand-off counts only once the frame is fitted, and only on it (`seedOn`): beside the frame
 * it is unknown until he moves. Off the frame, their screen shows a small edge marker, no tag.
 * REQ-539 (demo m24 — cycle 4) — amends that: only the stage's own hand-off (a reload) is sent;
 * /admin's (the Demo click, on a desktop customer's frame) is a hint for the off outline only, and
 * their screen gets no arrow until he makes a real pointer move (`seedUse`).
 *
 * REQ-645 (demo M1, M2, m36, c4-M6 — cycle 5) — supersedes REQ-538's look-up under his still
 * mouse: his anchor carries the PRINT of the node it names (`printOf`); when it dies (a card
 * swapped, the same tab's next page, a reload) the stage looks for the ONE laid-out node with that
 * print as soon as the replay is styled, for at most REANCHOR_CAP_MS (`seekAgain`) — found, the
 * arrow is back on it; not found, no arrow, and the stage keeps saying so. A fraction the replay
 * could not name a node for goes out as `pending` ("pointing…" on their screen), never as an
 * arrow (`wire`). Another of their browser tabs followed: his anchor is kept for its page load
 * and dropped (`followTabs` — the tab's key said with its socket or after it, `onPeerTab`;
 * nothing of his goes to a page whose tab is not known yet; `keepHeld`), and the stage says which
 * tab it shows; that page load followed again gets it back (`restoreKept`). Holding nothing (the
 * demo's start) is "not on their screen — move to show it". The ghost and the colleagues'
 * pointers whose element is out of view are a chevron at the edge of where the replay shows it
 * (`placeView` over `clipOf`).
 *
 * REQ-232 — the pill says plainly whether the demo is live: "Live", "Connecting…", or "Waiting for
 * {name}'s app…" — the last only when none of the customer's tabs is left, after a few seconds'
 * grace (a page change in their app is a new socket). The stage follows the tab the customer used
 * last (the link picks it). A newer window of the same staff account takes the demo over: this one
 * says "In another window" (REQ-646) and offers "Use this window" (a reload takes it back).
 * REQ-235 — End asks first (EndDemo); the end goes to /admin saying who ended it ("You ended the
 * demo", "{customer} ended the demo", "{colleague} ended the demo"), where the overlay keeps it.
 *
 * REQ-537 (demo-loop cycle 4, m36) — the stage has one exit: the impersonation banner is not drawn
 * here (so `bannerH` measures 0 and the stage starts at the top of the window), End is in the pill,
 * and only with other presenters does the pill also offer "Leave the demo" (it leaves, hands the
 * account back and goes to /admin; the demo goes on with the others).
 *
 * REQ-309 (demo M19/m14/m26) — the pill's "Live" is the FRAME's truth: said only once the followed
 * tab's snapshot is in the frame, "Connecting…" in between — the same fact the "Connecting to
 * {name}'s screen…" overlay uses. A frame that does not fit leaves the stage dirty, and it asks
 * for a snapshot every MIRROR_GAP_MS until one lands (a stall asks the same way; the customer's
 * heartbeat makes a lost frame a stall within ~3 s even while they are idle). Following another
 * of the customer's tabs starts the receiver over. In dev the pill shows what the mirror counted.
 *
 * REQ-391 (demo-loop cycle 2, M4 + m21) — …and in time (`stageStatus`): "Loading their next
 * page…" while the customer's page is gone and the next may come (the link's `between`) or a newly
 * followed tab's snapshot is not in; "Catching up…" while a resync is out; "Behind N s" while the
 * frames come in over 1.5 s late (each frame carries its push time on the deploy's clock; the dev
 * chip shows the lag's median/worst, whole path and wire). A tab that said it is closing is
 * "Waiting for {name}'s app…" at once, under a banner across the frame's top edge.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { type Lang, langSignal, t } from "../lib/i18n.ts";
import { demoModeClient } from "../clients/demo-mode.ts";
import { adminClient } from "../clients/admin.ts";
import {
  ACTIVE_POLL_MS,
  type Anchor,
  CUSTOMER_COLOR,
  fitScale,
  fracToPoint,
  type PeerMessage,
  type PillFace,
  type PlacedMessage,
  pointToFrac,
  type Presenter,
  PRESENTER_COLORS,
  type Rect,
  sameAnchor,
} from "../../shared/demo-mode/protocol.ts";
import {
  createMirrorReceiver,
  createPageClock,
  MIRROR_GAP_MS,
  type MirrorFrame,
  type MirrorLag,
  type MirrorStats,
  type PageLag,
} from "../../shared/demo-mode/mirror.ts";
import {
  ARROW_BOX,
  MOVE_GAP_DIRECT_MS,
  MOVE_GAP_RELAY_MS,
  moveThrottle,
  newerMove,
  outsideBox,
  placeIn,
  type Pt,
} from "../../shared/demo-mode/motion.ts";
import {
  type CursorSeed,
  handCursor,
  sessionStore,
  takeCursor,
} from "../lib/demo-mode/cursor-handoff.ts";
import {
  connectDemo,
  type DemoLink,
  type LinkStatus,
  type PeerFrom,
} from "../lib/demo-mode/transport.ts";
import {
  createReplayer,
  MIRROR_SRCDOC,
  type Replayer,
} from "../lib/demo-mode/mirror-replay.ts";
import { useGlide } from "../lib/demo-mode/use-glide.ts";
import {
  newStageWave,
  placeWavesAgain,
  type StageWave,
  type WaveFrame,
} from "../lib/demo-mode/pointer-anchor.ts";
import {
  anchorDead,
  anchorPoint,
  type Dir,
  followTabs,
  type Held,
  keepHeld,
  keptFor,
  lookAgain,
  type NodePrint,
  placeView,
  ownAt,
  pointerAbsent,
  printable,
  reanchored,
  reportedGhost,
  resendable,
  seedUse,
  SEEK_RETRY_MS,
  seekPrint,
} from "../../shared/demo-mode/presenter-anchor.ts";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";
import OwnPointer from "../components/demo-mode/OwnPointer.tsx";
import DemoPointer, { WAVE_MS } from "../components/demo-mode/DemoPointer.tsx";
import PeerPointer, {
  type PointerCmd,
} from "../components/demo-mode/PeerPointer.tsx";
import PresenterChips from "../components/demo-mode/PresenterChips.tsx";
import EndDemo from "../components/demo-mode/EndDemo.tsx";
import {
  STAGE_BADGE_H,
  STAGE_TOP_INSET,
  stageBadgeTop,
  stageLeaveShown,
} from "../../shared/demo-mode/stage-chrome.ts";
import {
  endedHref,
  type EndedNotice,
  whoEnded,
} from "../../shared/demo-mode/ended.ts";
import {
  bandGhostBox,
  ghostWords,
  PILL_FONT,
  pillFaceAwaiting,
  pillFaceOffline,
  pillGhost,
  STAGE_PILL_BOTTOM,
  stageInsetBottom,
} from "../../shared/demo-mode/pill.ts";
import { createPillSync } from "../../shared/demo-mode/pill-sync.ts";
import {
  afterActiveCheck,
  behindSeconds,
  frameReady,
  stageFrameLook,
  stageStatus,
  STYLE_WAIT_MS,
} from "../../shared/demo-mode/stage-frame.ts";

interface Demo {
  id: string;
  presenterName: string;
  targetName: string;
  targetUserId: string;
  /** REQ-214 — everyone presenting, and which of them this browser is */
  presenters: Presenter[];
  pid: string | null;
}

/** REQ-242 — what the mirror shows: the customer's viewport and page */
interface Screen {
  w: number;
  h: number;
  path: string;
}

/** the same demo with the same presenters (a roster change re-renders, a poll's echo does not) */
const sameDemo = (a: Demo | null, b: Demo) =>
  a?.id === b.id &&
  JSON.stringify(a.presenters) === JSON.stringify(b.presenters);

const Z = 2147483000;
/** REQ-636 — a `pill` message from the customer */
type PillMsg = Extract<PeerMessage, { k: "pill" }>;

/** room around the frame; the bottom band is the pill's measured height (REQ-228); REQ-642 —
 *  the top leaves a chrome row for the off / absent badge, above the frame, never over it */
const INSET = { top: STAGE_TOP_INSET, right: 16, left: 16 };
/** before the first snapshot: the frame is there (its shell loads) but nothing is shown */
const HIDDEN: Screen = { w: 1, h: 1, path: "" };
/** REQ-242 — when a snapshot's scrolls are applied again (its stylesheets and images loading) */
const SETTLE_MS = [150, 600, 1_500];
/** REQ-645 (m36) — how long the stage says it shows another of their tabs, at most (a move ends it) */
const TAB_NOTE_MS = 8_000;

/** REQ-309 — the stage's own counters (the receiver counts the rest) */
interface OwnStats {
  /** frames that did not fit the replay */
  failed: number;
  /** resyncs asked for */
  resyncs: number;
  /** when the last frame came (0: none yet) */
  lastAt: number;
}
/** REQ-309 — the mirror's counters on the pill (dev only): one short line, the legend in its title */
const MIRROR_STATS_LEGEND =
  "mirror (dev): f frames · hb heartbeats · x frames that did not fit · st stalls · rs resyncs asked · old dropped as older · bad undecodable · held waiting for an earlier frame · cv canvas bitmaps arrived/applied/painted/repainted: painted once drawn on the stage's canvas (REQ-644), repainted after a resize or a style change (REQ-380) · the last frame's age · lag median/worst seconds from the customer's push to the frame handed on · net the same to its last chunk in (encoder + wire) · page last/worst seconds from their page going to their next page on show here (REQ-648) · p2p or ws: how the frames travel (WebRTC, or the server's socket)";
/** REQ-391 — seconds, one decimal; "–" for nothing measured */
const secs = (ms: number | null) => ms === null ? "–" : (ms / 1000).toFixed(1);
function mirrorStatsText(
  s: MirrorStats,
  own: OwnStats,
  lag: MirrorLag,
  direct: boolean,
  cv?: { seen: number; cv: number; painted: number; repaints: number },
  page?: PageLag,
): string {
  const age = own.lastAt
    ? `${((Date.now() - own.lastAt) / 1000).toFixed(1)}s`
    : "–";
  const c = cv ?? { seen: 0, cv: 0, painted: 0, repaints: 0 };
  // REQ-648 (cycle 5, M3) — a frame's lag starts at its push: the page figure is the time from
  // their page going to their next page on show here (the boot of their next page included)
  const pg = page ?? { last: null, p50: null, max: null };
  return `mirror f${s.frames} hb${s.beats} x${own.failed} st${s.stalls} rs${own.resyncs} old${s.older} bad${s.undecodable} held${s.held} cv${c.seen}/${c.cv}/${c.painted}/${c.repaints} ${age} lag ${
    secs(lag.p50)
  }/${secs(lag.max)}s net ${secs(lag.netP50)}/${secs(lag.netMax)}s page ${
    secs(pg.last)
  }/${secs(pg.max)}s ${direct ? "p2p" : "ws"}`;
}

export default function DemoStage({ initialLang }: { initialLang?: Lang }) {
  // REQ-270: seed the staff's language (from the server's user.language) before the first
  // client render — the module-load seed reads pm:lang, shared with the same-origin replica.
  useState(() => {
    if (initialLang && typeof document !== "undefined") {
      langSignal.value = initialLang;
    }
  });
  const [demo, setDemo] = useState<Demo | null>(null);
  /** the server said there is no demo for this session */
  const [gone, setGone] = useState(false);
  /** REQ-541 (cycle 4, M22) — a demo has been shown on this stage */
  const shownRef = useRef(false);
  /** REQ-541 — the stage is already on its way back to the presenter's own account */
  const leavingRef = useRef(false);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [peerOnline, setPeerOnline] = useState(false);
  const [ended, setEnded] = useState(false);
  /** REQ-537 — Leave the demo was clicked here: on the way to /admin */
  const [leavingHere, setLeavingHere] = useState(false);
  /** REQ-242 — null until the customer's first snapshot is in the frame */
  const [mirrored, setMirrored] = useState<Screen | null>(null);
  /** REQ-297 — the screen in the frame is from before the customer's app dropped */
  const [stale, setStale] = useState(false);
  /** REQ-391 — another tab (or page) of the customer's is followed and its snapshot is not in
   *  the frame yet: the frame still shows what came before. REQ-648 — "in" is ON SHOW: a
   *  snapshot held for its stylesheets (REQ-547) is not (the replay's onShown ends the wait) */
  const [awaiting, setAwaiting] = useState(false);
  /** REQ-391 — how late the frames come (whole seconds, 0: in time) and whether a resync is out;
   *  read off the receiver on the stall tick, set only when it changes. REQ-648 — and how long
   *  their next page has been coming (`page`, behindSeconds of the page clock's wait) */
  const [lagView, setLagView] = useState({
    behind: 0,
    resyncing: false,
    page: 0,
  });
  /** REQ-648 (cycle 5, M3 + c4-m28) — the page clock: their page going → the next on show */
  const pageClockRef = useRef<ReturnType<typeof createPageClock> | null>(null);
  /** REQ-648 — the pill says "Loading their next page…": the frame holds the page they left, and
   *  no pointer of his is sent against it */
  const loadingNextRef = useRef(false);
  /** REQ-370 (demo m23) — the replay's stylesheets are in (or STYLE_WAIT_MS passed since the first
   *  snapshot): until then the frame stays hidden under "Connecting to {name}…", never unstyled */
  const [styled, setStyled] = useState(false);
  const styledRef = useRef(false);
  /** REQ-370 — when the first snapshot of this demo was applied, and the fallback timer */
  const firstSnapAtRef = useRef<number | null>(null);
  /** REQ-645 — when his anchor was found dead on a styled replay of which page load (the look for
   *  its print runs for REANCHOR_CAP_MS from then; another page load starts it over), and the next
   *  look */
  const deadAtRef = useRef<{ at: number; load: string } | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** REQ-235 — this stage's End ended it */
  const endedHere = useRef(false);
  const [stage, setStage] = useState({ w: 1, h: 1 });
  const [bannerH, setBannerH] = useState(0);
  /** REQ-228 — the pill's real height: the frame keeps out of that band, however it wraps */
  const [pillH, setPillH] = useState(0);
  const pillRef = useRef<HTMLDivElement | null>(null);
  /** REQ-371 (demo m10) — each wave keeps the anchor it was sent with; REQ-546 (demo m14,
   *  cycle 4) — frozen where it was placed, gone with its node (`placeWavesAgain`) */
  const [waves, setWaves] = useState<StageWave[]>([]);
  /** REQ-214 — the latest thing each colleague did, by pid */
  const [cmds, setCmds] = useState<Record<string, PointerCmd>>({});
  const seq = useRef(0);
  const demoRef = useRef<Demo | null>(null);
  demoRef.current = demo;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** the frame's document the replay writes into, and the replay */
  const frameDocRef = useRef<Document | null>(null);
  const replayerRef = useRef<Replayer | null>(null);
  /** frames that came before the frame's document was ready */
  const queueRef = useRef<[MirrorFrame, string][]>([]);
  /** the customer's page load the replay shows (a pointer's element id belongs to one) */
  const loadRef = useRef<string | null>(null);
  const lastAskRef = useRef(0);
  /** REQ-309 — a frame did not fit (or a snapshot failed): ask for a snapshot until one lands */
  const dirtyRef = useRef(false);
  /** REQ-309 — what this stage counted; with the receiver's counters on the pill in dev */
  const ownRef = useRef<OwnStats>({ failed: 0, resyncs: 0, lastAt: 0 });
  const [statsText, setStatsText] = useState("");
  const [dev] = useState(() =>
    typeof location !== "undefined" &&
    /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  );
  /** REQ-242 — where this presenter's pointer rests on the stage; REQ-393 — anywhere on it (the
   *  frame, beside it); null once it left the window, or before it was ever seen */
  const lastMoveRef = useRef<Pt | null>(null);
  /** REQ-393 — his mouse is beside the frame: the customer sees the arrow on their screen's edge;
   *  the stage outlines the frame and says so */
  const [off, setOff] = useState(false);
  /** REQ-180 — the customer's last move clock seen; REQ-242 — it is their page's performance.now(),
   *  which starts over with every page, so it is forgotten whenever their page changes */
  const lastTRef = useRef(0);
  /** REQ-305 — the customer's pointer as last sent: its anchor, placed again against the replay
   *  whenever the replay's layout moves (a frame applied, its styles in, the stage resized). A new
   *  page's snapshot forgets it — unless it already names that page (it came ahead of it). */
  const customerRef = useRef<Anchor | null>(null);
  /** REQ-305 — each colleague's last anchor, the same way (REQ-214); and where each was placed */
  const peersRef = useRef<Map<string, Anchor>>(new Map());
  const placedRef = useRef<Map<string, Pt & { outside: boolean }>>(new Map());
  /** REQ-305 — this presenter's pointer as last sent (its node belongs to one page load) */
  const sentRef = useRef<Anchor | null>(null);
  /** REQ-451 — the page load the replay showed when it was made (sent again only to that load),
   *  where on the stage his mouse was, and whether it is a bare fraction only for want of a styled
   *  replay (looked up once the replay is styled) */
  const sentLoadRef = useRef<string | null>(null);
  const sentAtRef = useRef<Pt | null>(null);
  const provisionalRef = useRef(false);
  /** REQ-645 — what the node his anchor names IS (found again by it when it goes), and the last
   *  print taken (the same node as the last move: taken once) */
  const printRef = useRef<NodePrint | null>(null);
  const printCacheRef = useRef<
    { id: number; load: string; print: NodePrint | null } | null
  >(null);
  /** REQ-645 (m36) — his anchors kept per page load when another tab was followed; a switch whose
   *  first snapshot has not come yet (the stage then says which tab it shows) */
  const keptRef = useRef(new Map<string, Held>());
  const switchedRef = useRef(false);
  /** REQ-645 (m36) — which browser tab of theirs the stage follows (its key, once said); a page
   *  that came in before the tab it is of was known (given its due when it is) */
  const tabsRef = useRef(followTabs());
  const waitTabRef = useRef<{ load: string; path: string } | null>(null);
  /** REQ-451 (M14) — the mouse the page that opened the stage handed over: counted once the frame
   *  is fitted, and only on it; dropped by a real pointer event */
  const seedRef = useRef<CursorSeed | null>(null);
  /** REQ-539 (m24) — /admin's hand-off: where his mouse is, for the off hint only (never sent,
   *  never his pointer); dropped by a real pointer event */
  const hintRef = useRef<Pt | null>(null);
  /** REQ-451 — the ghost of his arrow where their screen has it, while that is apart from his
   *  cursor (their page moved it with its element, or the frame moved) */
  const [ghost, setGhost] = useState<
    { at: Pt; outside: boolean; dir?: Dir | null } | null
  >(null);
  /** REQ-642 (cycle 5, m10) — the followed tab's last report of where it placed HIS arrow: the
   *  ghost is drawn from it (never from this stage's own replay, which can put it elsewhere) */
  const reportRef = useRef<PlacedMessage | null>(null);
  /** REQ-642 (setup-14d) — moves his own marker (OwnPointer's own state: no stage re-render) */
  const ownSetRef = useRef<((at: Pt | null) => void) | null>(null);
  const bindOwn = useCallback((set: (at: Pt | null) => void) => {
    ownSetRef.current = set;
    set(ownAt(heldNowRef.current()));
  }, []);
  /** REQ-538 (cycle 4 M1) — his arrow is not on their screen (what he pointed at went: a card
   *  swapped, a new page) until he moves or REQ-645 finds it again by its print; REQ-645 — and
   *  while he holds nothing (the demo's start, another tab followed) */
  const [absent, setAbsent] = useState(false);
  /** REQ-645 (m36) — the stage follows another of their tabs now: its page, said until he moves */
  const [tabNote, setTabNote] = useState<string | null>(null);
  const tabNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** REQ-214 — how a colleague's pointer is driven, for the placing again */
  const commandRef = useRef<
    ((pid: string, cmd: Omit<PointerCmd, "seq">) => void) | null
  >(null);
  const linkRef = useRef<DemoLink | null>(null);
  const peerOnlineRef = useRef(false);
  peerOnlineRef.current = peerOnline;
  const pollRef = useRef<(() => void) | null>(null);
  const waveId = useRef(0);
  const glide = useGlide();
  /** REQ-295 — where the customer's own demo pill is on their screen (what the mirror hides) */
  const [pillBox, setPillBox] = useState<Rect | null>(null);
  /** REQ-372 (cycle 2, m1) — and what it says, for the ghost's read-only replica */
  const [pillFace, setPillFace] = useState<PillFace>({});
  /** REQ-645 — the customer's band under their pill (their px): nothing of the page shows there */
  const bandPxRef = useRef(0);
  bandPxRef.current = Math.max(0, pillFace.band ?? 0);

  const screen = mirrored ?? HIDDEN;
  /** REQ-393 — the screen the frame on the stage is fitted to (HIDDEN: none yet) */
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const fit = useMemo(
    () =>
      fitScale(stage, screen, {
        ...INSET,
        top: INSET.top + bannerH,
        bottom: stageInsetBottom(pillH),
      }),
    [stage.w, stage.h, screen.w, screen.h, bannerH, pillH],
  );
  const fitRef = useRef(fit);
  fitRef.current = fit;
  /** REQ-188 — the frame's box on this screen: fractions of the customer's viewport map onto it */
  const fitBox = () => fitRef.current;
  /** REQ-393 — the frame on the stage is fitted to the replay's screen, so a point of the stage
   *  says a point of theirs (before the first snapshot, or with one of a new size not fitted yet,
   *  it says nothing: the fitted frame's layout pass sends the resting pointer) */
  const fitted = () => {
    const size = replayerRef.current?.size();
    const s = screenRef.current;
    return !!size && s !== HIDDEN && size.w === s.w && size.h === s.h;
  };
  /** REQ-305 — every anchor of this pointer goes out: the last one sent is kept; REQ-451 — with
   *  the page load it was made on, the stage point it was made at, and whether it is a fraction
   *  only for want of a styled replay. Made where he points now: no ghost */
  const hold = (
    a: Anchor,
    at: Pt | null,
    load: string | null,
    provisional: boolean,
    print: NodePrint | null = null,
  ): Anchor => {
    sentRef.current = a;
    sentLoadRef.current = load;
    sentAtRef.current = at;
    provisionalRef.current = provisional;
    printRef.current = print; // REQ-645 — what it names, found again by it
    deadAtRef.current = null;
    setGhost(null);
    setAbsent(false); // REQ-538 — made where he points now: drawn there
    ownSetRef.current?.(ownAt(heldNow())); // REQ-642 — his own marker, where he points
    return a;
  };
  /** REQ-451 — nothing pointed at (his mouse left the window, the demo went); REQ-645 — another
   *  tab followed. Nothing of his is on their screen: the stage says so (pointerAbsent) */
  const drop = () => {
    sentRef.current = null;
    sentLoadRef.current = null;
    sentAtRef.current = null;
    provisionalRef.current = false;
    printRef.current = null;
    deadAtRef.current = null;
    setGhost(null);
    setAbsent(true);
    ownSetRef.current?.(null);
  };
  /** REQ-242 — a point of this screen as the customer's: the fraction of the frame and, when the
   *  replay has one there, the mirrored element under it and where in its box */
  const anchorOf = (p: Pt): Anchor => {
    const f = fitBox();
    const a = pointToFrac(p, f);
    const load = loadRef.current;
    // REQ-393 — beside the frame: where his mouse meets the frame's edge, marked off their screen
    // (never a node: nothing of theirs is under it)
    if (outsideBox(p, f)) {
      const edge: Anchor = { ...a, o: 1 };
      return hold(edge, p, load, false);
    }
    const rep = replayerRef.current;
    // REQ-305 — never a node of a replay whose stylesheets are not in: the node under the point
    // there is not the one under it on the customer's screen (the fraction is, near enough);
    // REQ-451 — nor before its fonts and images are in (settled): a node taken then would be kept
    const settled = !!load && rep?.settled() === true;
    const n = settled
      ? rep.anchorAt((p.x - f.left) / f.s, (p.y - f.top) / f.s)
      : null;
    const out = n && load ? { ...a, n: { ...n, l: load } } : a;
    // REQ-645 — what that node IS, kept with it: if it goes, it is found again by this, never by
    // where his mouse is (the same node as the last move keeps the print taken then)
    let print: NodePrint | null = null;
    if (n && load) {
      const c = printCacheRef.current;
      print = c && c.id === n.id && c.load === load
        ? c.print
        : rep?.printOf(n.id) ?? null;
      printCacheRef.current = { id: n.id, load, print };
    }
    // REQ-451 — a fraction only because the replay could not be asked yet: looked up once it can
    return hold(out, p, load, !n && !settled, print);
  };
  /** a point of the customer's (or a colleague's) pointer on this screen: on the element it names
   *  when the replay has it, else at the same fraction of the frame */
  const toStage = (a: Anchor): Pt => {
    const f = fitBox();
    if (a.n?.l && a.n.l === loadRef.current) {
      const p = replayerRef.current?.pointOf(a.n);
      if (p) return { x: f.left + p.x * f.s, y: f.top + p.y * f.s };
    }
    return fracToPoint(a, f);
  };
  /** REQ-546 (demo m14, cycle 4) — the frame as a click wave sees it: its node's point while the
   *  replay shows that page load and has the node, else none — never the click's fraction */
  const waveFrame = (): WaveFrame => {
    const f = fitBox();
    return {
      box: f,
      load: loadRef.current,
      nodeAt: (a) => {
        if (!a.n?.l || a.n.l !== loadRef.current) return null;
        const p = replayerRef.current?.pointOf(a.n);
        return p ? { x: f.left + p.x * f.s, y: f.top + p.y * f.s } : null;
      },
    };
  };
  /** REQ-451 — a presenter's pointer on this frame (a colleague's, or this one's ghost): on the
   *  node it names while the replay shows that page load and has the node; else nowhere — never
   *  the fraction it had (another page now, or the node gone) */
  const presenterOnStage = (
    a: Anchor,
  ): { at: Pt; outside: boolean; dir: Dir | null } | null => {
    const f = fitBox();
    const p = anchorPoint(a, f, loadRef.current, (n) => {
      const q = replayerRef.current?.pointOf(n);
      return q ? { x: f.left + q.x * f.s, y: f.top + q.y * f.s } : null;
    });
    if (!p) return null;
    // REQ-645 (c4-M6) — the element it names out of view: at the edge of where the replay shows
    // it, the way to it; a mouse beside the frame (REQ-393) on the frame's edge, as before
    if (a.n && a.o !== 1) return placeView(p, visOnStage(a));
    return { ...placeIn(p, f, ARROW_BOX, a.o === 1), dir: null };
  };
  /** REQ-645 (c4-M6) — where on the stage the element an anchor names can be seen: the frame
   *  without the customer's band, cut by the replay's clipping ancestors (its scroller, under its
   *  topbar) — never the frame's edge over their topbar's search bar */
  const visOnStage = (a: Anchor): Rect => {
    const f = fitBox();
    const frame = {
      left: f.left,
      top: f.top,
      width: f.width,
      height: Math.max(0, f.height - bandPxRef.current * f.s),
    };
    if (!a.n?.l || a.n.l !== loadRef.current) return frame;
    const c = replayerRef.current?.clipOf(a.n);
    if (!c) return frame;
    const left = Math.max(frame.left, f.left + c.left * f.s);
    const top = Math.max(frame.top, f.top + c.top * f.s);
    const right = Math.min(
      frame.left + frame.width,
      f.left + (c.left + c.width) * f.s,
    );
    const bottom = Math.min(
      frame.top + frame.height,
      f.top + (c.top + c.height) * f.s,
    );
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };
  /** REQ-451 — what he points at, as the stage keeps it */
  const heldNow = (): Held => ({
    a: sentRef.current,
    load: sentLoadRef.current,
    at: sentAtRef.current,
    provisional: provisionalRef.current,
    print: printRef.current,
  });
  const heldNowRef = useRef(heldNow);
  heldNowRef.current = heldNow;
  /** REQ-451 — the ghost of his arrow where their screen has it now, when apart from his cursor;
   *  REQ-642 (cycle 5, m10) — where their overlay REPORTED it, for the anchor he holds now */
  const showGhost = () => {
    const g = reportedGhost(heldNow(), reportRef.current, fitBox());
    setGhost((was) =>
      was && g && was.outside === g.outside &&
        was.dir?.dx === g.dir?.dx && was.dir?.dy === g.dir?.dy &&
        Math.abs(was.at.x - g.at.x) < 0.5 && Math.abs(was.at.y - g.at.y) < 0.5
        ? was
        : g
    );
  };
  /** REQ-437 — the box of the element an anchor names, on this screen (the replay has it) */
  const rectOnStage = (a: Anchor): Rect | null => {
    if (!a.n?.l || a.n.l !== loadRef.current) return null;
    const r = replayerRef.current?.rectOf(a.n);
    if (!r) return null;
    const f = fitBox();
    return {
      left: f.left + r.left * f.s,
      top: f.top + r.top * f.s,
      width: r.width * f.s,
      height: r.height * f.s,
    };
  };

  /** REQ-645 (cycle 5 M1) — what goes on the wire for his move: itself — except a fraction made
   *  only because the replay could not name a node yet (provisional), which goes as `pending`:
   *  their screen says he is pointing, never an arrow at that fraction (on her layout it was the
   *  next button: "Eliminar factura") */
  const wire = (m: { k: "move"; a: Anchor; t: number }): PeerMessage =>
    provisionalRef.current
      ? { k: "pending", a: { vx: m.a.vx, vy: m.a.vy }, t: m.t }
      : m;

  /** this side's moves, rated leading + trailing so the rest position always goes out */
  const throttle = useMemo(() =>
    moveThrottle<Pt>({
      gap: () =>
        linkRef.current?.isDirect() ? MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS,
      // REQ-645 — through wire (anchorOf and wire read refs only: the first render's do)
      send: ({ x, y }) => {
        // REQ-648 (cycle 5, c4-m28) — never aimed at the page they left while the next one
        // loads: the customer's new page drew it on whatever sat at that spot
        if (loadingNextRef.current) return;
        linkRef.current?.send(
          wire({
            k: "move",
            a: anchorOf({ x, y }),
            t: performance.now(),
          }),
          true,
        );
      },
    }), []);

  /** REQ-242 — what this presenter points at, once more: the customer's page that just joined (or
   *  was just mirrored afresh) has not seen it. REQ-451 (M1) — only to the page load it was made
   *  on (a tab followed again, its page unchanged; the stage's socket back); a new page, a reload,
   *  another tab gets nothing until he moves — never a fraction of the frame under his still
   *  mouse, which put the arrow on whatever the new page had at that spot */
  const resendPointer = () => {
    // REQ-645 (m36) — nothing to a page whose browser tab is not known yet (another tab's, maybe)
    if (tabsRef.current.unsure()) return;
    const h = heldNow();
    const a = resendable(h, loadRef.current);
    if (a) {
      linkRef.current?.send(wire({ k: "move", a, t: performance.now() }));
      return;
    }
    // REQ-645 (cycle 5 M2) — what he pointed at was on another page load (the same tab's next
    // page, a reload): their page says he is pointing while it is looked for by its print
    // (seekAgain) — never his still mouse looked up there (REQ-538)
    if (h.a?.n && printable(h.print)) {
      linkRef.current?.send({
        k: "pending",
        a: { vx: h.a.vx, vy: h.a.vy },
        t: performance.now(),
      });
    }
    seekAgain();
  };
  /** REQ-645 (cycle 5 M1 + M2) — his anchor died (its node gone: a card swapped; another page
   *  load): the ONE laid-out node with its print (`findPrint`), looked for as soon as the replay
   *  is styled and for REANCHOR_CAP_MS (again every SEEK_RETRY_MS meanwhile) — never the node
   *  under his still mouse (REQ-538 put the arrow on whatever the new content had there). Found:
   *  his anchor on it, at the same spot of its box, sent. Not found: no arrow — the stage keeps
   *  saying his pointer is not on their screen */
  const seekAgain = () => {
    // REQ-645 (m36) — never on a page whose browser tab is not known yet (another tab's, maybe)
    if (tabsRef.current.unsure()) return;
    const h = heldNow();
    const rep = replayerRef.current;
    const load = loadRef.current;
    const alive = !!h.a && !!presenterOnStage(h.a);
    if (!anchorDead(h, { load, alive })) {
      deadAtRef.current = null;
      return;
    }
    if (!rep || load === null || !rep.styled()) return;
    const now = Date.now();
    // the look runs from when it was found dead on THIS page load (a new page: looked for afresh)
    if (deadAtRef.current?.load !== load) deadAtRef.current = { at: now, load };
    const shown = { load, styled: true, alive };
    if (!seekPrint(h, shown, now - deadAtRef.current.at)) return;
    const n = h.a?.n;
    const id = h.print ? rep.findPrint(h.print) : null;
    if (id === null || !n) {
      // not there (yet): looked for again, until the cap
      if (!seekTimerRef.current) {
        seekTimerRef.current = setTimeout(() => {
          seekTimerRef.current = null;
          seekRef.current();
        }, SEEK_RETRY_MS);
      }
      return;
    }
    const q = rep.pointOf({ id, x: n.x, y: n.y });
    const size = rep.size();
    const frac = q && size
      ? pointToFrac(q, { left: 0, top: 0, width: size.w, height: size.h })
      : { vx: h.a?.vx ?? 0.5, vy: h.a?.vy ?? 0.5 };
    const a = reanchored(h, id, load, frac);
    hold(a, h.at, load, false, h.print ?? null);
    linkRef.current?.send({ k: "move", a, t: performance.now() });
  };
  const seekRef = useRef(seekAgain);
  seekRef.current = seekAgain;
  /** REQ-305 — the resting pointer on the node under it in the styled replay, sent when that is
   *  not what went last; REQ-451 — only for a fraction made before the replay could name a node
   *  (lookAgain), or his mouse beside a frame that moved — never because the page moved under it */
  const restAgain = () => {
    const p = lastMoveRef.current;
    if (!p || !fitted()) return;
    // REQ-648 — nor his still mouse looked up on the page they left
    if (loadingNextRef.current) return;
    const was = sentRef.current;
    const a = anchorOf(p);
    if (sameAnchor(was, a)) return;
    // REQ-645 — `pending` while still provisional
    linkRef.current?.send(wire({ k: "move", a, t: performance.now() }));
  };
  /** REQ-393 — restAgain after a layout pass, rated like a move (a scroll is a burst of passes),
   *  on the reliable channel (the last look-up must arrive); REQ-451 — a provisional one only */
  const rest = useMemo(() =>
    moveThrottle<null>({
      gap: () =>
        linkRef.current?.isDirect() ? MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS,
      send: () => restAgain(),
    }), []);
  /** REQ-393 — whether his mouse is beside the fitted frame (the outline and the hint) */
  const markOff = () => {
    const p = lastMoveRef.current ?? hintRef.current;
    setOff(!!p && fitted() && outsideBox(p, fitBox()));
  };
  /** REQ-393 / REQ-451 (M14) — the mouse handed over, once the frame is fitted to their screen;
   *  REQ-539 (m24) — only the stage's own (a reload) on the frame is where he points and is sent;
   *  /admin's (the Demo click — on a desktop customer's frame, over her mic button) is only where
   *  his mouse is: the off hint, nothing on their screen until he moves */
  const takeSeed = () => {
    const s = seedRef.current;
    if (!s || !fitted()) return;
    seedRef.current = null;
    const use = seedUse(s, fitBox());
    if (!use || lastMoveRef.current) return;
    if (!use.send) {
      hintRef.current = use.at;
      markOff();
      return;
    }
    lastMoveRef.current = use.at;
    markOff();
    if (linkRef.current) throttle.push(use.at);
  };

  /** REQ-305 — where an anchor's pointer is drawn: on the frame's edge, pointing outside, when the
   *  element it names is out of the frame (scrolled away, or a frame not yet scrolled); REQ-393 —
   *  and when a colleague's mouse is beside their frame */
  const placeOnStage = (a: Anchor) =>
    placeIn(toStage(a), fitBox(), ARROW_BOX, a.o === 1);
  const showCustomer = () => {
    const a = customerRef.current;
    if (!a) return;
    const p = placeOnStage(a);
    glide.glideTo(p.at, p.outside, p.outside ? null : rectOnStage(a));
  };
  const placePeer = (pid: string, a: Anchor, kind: "move" | "click") => {
    const p = presenterOnStage(a);
    // REQ-451 — what the colleague pointed at is not in this frame (another page now): no arrow
    if (!p) {
      if (placedRef.current.delete(pid)) {
        commandRef.current?.(pid, { kind: "leave" });
      }
      return;
    }
    placedRef.current.set(pid, { ...p.at, outside: p.outside });
    commandRef.current?.(pid, {
      kind,
      at: p.at,
      // REQ-645 — out of view: the chevron where the replay shows its element, no ring
      outside: p.outside && !p.dir,
      off: a.o === 1,
      cue: p.dir ? { box: visOnStage(a), text: "" } : null,
      rect: p.outside ? null : rectOnStage(a), // REQ-437 — the tag sits outside it
    });
  };
  /** REQ-305 — the replay's layout may have moved (a frame applied, its styles, images or fonts
   *  in, a settle, the stage resized): every pointer anchored to its nodes is placed again;
   *  REQ-451 — this presenter's anchor stays on what he pointed at (its ghost is placed again) */
  const replace = () => {
    checkStyled(); // REQ-370 — a stylesheet of the replay may just have loaded
    showCustomer();
    setWaves((w) => placeWavesAgain(w, waveFrame()));
    for (const [pid, a] of peersRef.current) {
      const p = presenterOnStage(a);
      const was = placedRef.current.get(pid);
      if (
        p
          ? was && was.x === p.at.x && was.y === p.at.y &&
            was.outside === p.outside
          : !was
      ) continue;
      placePeer(pid, a, "move");
    }
    markOff();
    // REQ-451 (M14) — the opening page's mouse, once the frame is fitted, and only on it
    takeSeed();
    // REQ-451 (M1) — never the spot under his still mouse again (the customer's arrow stayed over
    // whatever their scroll or a new page put there): only a fraction made before this page's
    // replay settled is looked up, once it has — and his mouse beside the frame, which moves.
    // REQ-645 (cycle 5 M1) — supersedes REQ-538: an anchor that died (its node gone: a card
    // swapped; another page shown) is never looked up under his still mouse — it is found again
    // by its print (seekAgain), or not at all
    const held = heldNow();
    const alive = !!held.a && !!presenterOnStage(held.a);
    setAbsent(pointerAbsent(held, alive));
    if (
      lookAgain(held, {
        load: loadRef.current,
        settled: !!replayerRef.current?.settled(),
      })
    ) rest.push(null);
    seekAgain();
    showGhost();
  };
  const replaceRef = useRef(replace);
  replaceRef.current = replace;

  /** REQ-242 — the replay and the customer's screen came apart: a fresh snapshot, please */
  const askResync = () => {
    const now = Date.now();
    if (now - lastAskRef.current < MIRROR_GAP_MS) return;
    lastAskRef.current = now;
    ownRef.current.resyncs++;
    linkRef.current?.send({ k: "resync" });
  };

  /** REQ-370 — reveal the frame once the replay is styled, or once it has waited STYLE_WAIT_MS
   *  (`late`: the fallback timer, whatever the clock's rounding says) */
  const checkStyled = (late = false) => {
    const rep = replayerRef.current;
    const at = firstSnapAtRef.current;
    if (styledRef.current || !rep || at === null) return;
    if (late || frameReady({ styled: rep.styled(), waited: Date.now() - at })) {
      styledRef.current = true;
      if (styleTimerRef.current) clearTimeout(styleTimerRef.current);
      styleTimerRef.current = null;
      setStyled(true);
    }
  };
  const checkStyledRef = useRef(checkStyled);
  checkStyledRef.current = checkStyled;

  /** REQ-645 (cycle 5 m36) — the stage follows ANOTHER of their browser tabs (its key said with
   *  its socket, or after it): what he pointed at was on the other tab — kept for its page load (it
   *  comes back when that is followed again, unchanged) and dropped here, never looked for on this
   *  tab; the stage says which tab it shows once its page is in */
  const otherTab = () => {
    keepHeld(keptRef.current, heldNow());
    drop();
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
    switchedRef.current = true;
  };
  /** REQ-645 (cycle 5 m36) — a page load mirrored afresh: a tab followed again with its page
   *  unchanged gets back the anchor he left on that page load (sent) — when he has pointed at
   *  nothing on a page since the switch; the first page of another tab is said (noteTab). True:
   *  his anchor came back. A page whose browser tab is not known yet waits for its key (onPeerTab;
   *  resendPointer sends it nothing meanwhile) */
  const restoreKept = (load: string, path: string) => {
    if (tabsRef.current.unsure()) {
      waitTabRef.current = { load, path };
      return false;
    }
    const k = keptFor(keptRef.current, load);
    const h = heldNow();
    const back = !!k?.a && (!h.a || (h.provisional && h.load === null));
    if (back && k?.a) {
      keptRef.current.delete(load);
      hold(k.a, k.at, load, false, k.print ?? null);
      linkRef.current?.send({ k: "move", a: k.a, t: performance.now() });
    }
    noteTab(path, back);
    return back;
  };
  /** REQ-645 (cycle 5 m36) — the first page of another of their tabs: the stage says which page
   *  it shows now (until he moves) — unless the anchor he left there came back with it */
  const noteTab = (path: string, back: boolean) => {
    if (!switchedRef.current) return;
    switchedRef.current = false;
    if (tabNoteTimerRef.current) clearTimeout(tabNoteTimerRef.current);
    tabNoteTimerRef.current = null;
    if (back) {
      setTabNote(null);
      return;
    }
    setTabNote(path || "/");
    tabNoteTimerRef.current = setTimeout(() => {
      tabNoteTimerRef.current = null;
      setTabNote(null);
    }, TAB_NOTE_MS);
  };

  /** REQ-242 — a frame of the customer's screen, into the replay */
  const take = (f: MirrorFrame, load: string) => {
    const rep = replayerRef.current;
    if (!rep) {
      // the frame's shell is still loading: keep the latest snapshot and what came after it
      queueRef.current = f.t === "snap"
        ? [[f, load]]
        : [...queueRef.current, [f, load]];
      return;
    }
    ownRef.current.lastAt = Date.now();
    if (!rep.apply(f)) {
      // REQ-309 — what did not fit was skipped, not fatal: the stage is dirty until a snapshot
      // lands (the stall poll keeps asking); a snapshot that failed shows nothing of itself
      dirtyRef.current = true;
      ownRef.current.failed++;
      askResync();
      if (f.t === "snap") return;
    }
    const newLoad = load !== loadRef.current;
    if (newLoad) lastTRef.current = 0; // another page: another clock
    loadRef.current = load;
    const size = rep.size();
    const path = rep.path() ?? "";
    if (size) {
      setMirrored((m) =>
        m && m.w === size.w && m.h === size.h && m.path === path
          ? m
          : { w: size.w, h: size.h, path }
      );
    }
    if (f.t === "snap") {
      dirtyRef.current = false;
      if (newLoad) {
        // a new page: the customer's pointer was on the old one
        if (customerRef.current?.n?.l !== load) {
          customerRef.current = null;
          glide.hide();
        }
        // REQ-451 — only an anchor made on this very page load; REQ-645 (m36) — or left on it
        if (!restoreKept(load, path)) resendPointer();
      }
      // its scrolls once more as its styles come in; REQ-305 — the pointers too
      SETTLE_MS.forEach((ms) => {
        setTimeout(() => {
          replayerRef.current?.settle();
          replaceRef.current();
        }, ms);
      });
      setStale(false); // REQ-297 — their screen is current again
      // REQ-391 — and it is the followed tab's: REQ-648 — once it is ON SHOW (pageShown)
      // REQ-370 — the first snapshot starts the wait for its stylesheets (at most STYLE_WAIT_MS)
      if (firstSnapAtRef.current === null) {
        firstSnapAtRef.current = Date.now();
        styleTimerRef.current = setTimeout(
          () => checkStyledRef.current(true),
          STYLE_WAIT_MS,
        );
      }
      checkStyled();
    }
  };

  /** REQ-648 — the replay put a snapshot's page on show (at once, or when its hold for its
   *  stylesheets ended): the page clock stops, and the frame is the followed tab's screen */
  const pageShown = () => {
    pageClockRef.current?.shown();
    setAwaiting(false);
  };
  const pageShownRef = useRef(pageShown);
  pageShownRef.current = pageShown;

  /** the frame's shell has loaded: the replay writes into it (a reloaded frame starts over) */
  const onFrameLoad = () => {
    const doc = frameRef.current?.contentDocument ?? null;
    if (!doc || doc === frameDocRef.current || doc.URL !== "about:srcdoc") {
      return;
    }
    const again = frameDocRef.current !== null;
    frameDocRef.current = doc;
    replayerRef.current?.dispose();
    replayerRef.current = createReplayer(doc, {
      // REQ-305 — the frame's layout moved: its pointers with it
      onLayout: () => replaceRef.current(),
      // REQ-648 — a snapshot's page on show
      onShown: () => pageShownRef.current(),
    });
    const q = queueRef.current;
    queueRef.current = [];
    for (const [f, l] of q) take(f, l);
    if (again) askResync();
  };
  // the shell may have loaded before the load handler was attached
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc && doc.readyState === "complete") onFrameLoad();
  });

  // 0. the stage's own size, and the banner's height (REQ-181: never under it). The banner mounts
  //    later than the stage (it waits for whoami) and publishes --banner-h on <html>; the stage
  //    watches that, so it moves down the moment the banner appears or grows.
  useEffect(() => {
    const measure = () => {
      setStage({ w: globalThis.innerWidth, h: globalThis.innerHeight });
      const b = document.querySelector("[data-demo-skip]");
      setBannerH(b ? b.getBoundingClientRect().height : 0);
    };
    measure();
    addEventListener("resize", measure);
    const mo = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(measure);
    mo?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    mo?.observe(document.body, { childList: true });
    return () => {
      removeEventListener("resize", measure);
      mo?.disconnect();
    };
  }, []);

  // 0a. REQ-305 — the frame moved or scaled (the stage, the banner or the pill changed): the
  //     pointers anchored to it are placed again
  useEffect(() => {
    replace();
  }, [fit]);

  // 0b. REQ-228 — the pill's height, whenever it changes (a wrap on a narrow window, a new status)
  const hasPill = Boolean(demo);
  useEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    const measure = () => setPillH(el.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") {
      addEventListener("resize", measure);
      return () => removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasPill]);

  // 1. which demo: on load, every 5 s while the customer's app is not connected
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      clearTimeout(timer);
      try {
        const a = await demoModeClient.active();
        if (!alive) return;
        const next = afterActiveCheck({
          found: Boolean(a.session && a.role === "presenter"),
          shown: shownRef.current,
        });
        if (next === "show" && a.session) {
          const found: Demo = { ...a.session, pid: a.pid };
          shownRef.current = true;
          setDemo((d) => sameDemo(d, found) ? d : found);
          setGone(false);
        } else {
          setDemo(null);
          setGone(true);
          // REQ-541 (M22) — the demo this stage showed is over (ended from another window of
          // this account, which a replaced window never hears): never left as the customer
          if (next === "handBack") handBack();
        }
      } catch {
        // signed out, or the backend is away
      }
      if (alive && !peerOnlineRef.current) {
        timer = setTimeout(check, ACTIVE_POLL_MS);
      }
    };
    pollRef.current = () => void check();
    void check();
    return () => {
      alive = false;
      pollRef.current = null;
      clearTimeout(timer);
    };
  }, []);

  // 2. the link, and the mirror on it
  useEffect(() => {
    if (!demo) return;
    /** REQ-180 — the last move clock seen, per colleague */
    const lastTOf = new Map<string, number>();
    let wasOnline = false;
    /** REQ-214 — a colleague's pointer; one the roster does not know yet triggers a fresh ask */
    const command = (pid: string, cmd: Omit<PointerCmd, "seq">) => {
      if (!demoRef.current?.presenters.some((p) => p.userId === pid)) {
        pollRef.current?.();
      }
      setCmds((c) => ({ ...c, [pid]: { seq: ++seq.current, ...cmd } }));
    };
    commandRef.current = command;
    /** REQ-636 (cycle 5, m8) — the customer's pill faces, each held until its frame is replayed */
    const pills = createPillSync<PillMsg>();
    const showPill = (m: PillMsg) => {
      setPillBox(m.r);
      setPillFace({
        compact: m.compact,
        open: m.open,
        status: m.status,
        text: m.text,
        clipped: m.clipped,
        label: m.label,
        guide: m.guide,
        // REQ-545 (cycle 4, m2) — tucked to its tab, and the band the customer sees
        tucked: m.tucked,
        band: m.band,
        bandBg: m.bandBg,
        title: m.title,
        end: m.end,
      });
    };
    const rx = createMirrorReceiver({
      onFrame: (f, load, sent) => {
        take(f, load);
        // REQ-636 — the replay reached this frame: the pill face sent with it shows now
        const p = pills.frame(sent);
        if (p) showPill(p);
      },
      // REQ-292 tripwire — a snapshot refused by the sequencer is never silent: say so, resync
      onDropped: (f, load, seq) => {
        console.warn("[demo-stage] snapshot dropped — resyncing", {
          load,
          seq,
          u: f.t === "snap" ? f.u : undefined,
        });
        askResync();
      },
      // REQ-391 — the deploy's clock, as the customer's sender stamps it: how late each frame is
      clock: () => linkRef.current?.now() ?? Date.now(),
    });
    /** REQ-391 — what the pill said last of the lag (its hysteresis) */
    let behind = 0;
    // REQ-648 (cycle 5, M3 + c4-m28) — each page change of the followed tab, timed on the deploy's
    // clock: from their page saying it was going to the next page on show here
    const pages = createPageClock({
      clock: () => linkRef.current?.now() ?? Date.now(),
    });
    pageClockRef.current = pages;
    ownRef.current = { failed: 0, resyncs: 0, lastAt: 0 };
    dirtyRef.current = false;
    // REQ-292 — the customer's tab the stage follows: a switch starts the mirror's ordering over
    let followedCid: string | undefined;
    // REQ-645 (m36) — and the BROWSER tab it is a page of (its key, once said)
    tabsRef.current = followTabs();
    waitTabRef.current = null;
    const link = connectDemo({
      sessionId: demo.id,
      role: "presenter",
      pid: demo.pid ?? undefined,
      // REQ-648 — the followed tab's page went: the page clock runs from when it said so
      onPageGone: (at) => pages.left(at),
      onPresence: (pid, online) => {
        lastTOf.delete(pid); // their stage came or went: its clock starts over
        if (!online) {
          peersRef.current.delete(pid);
          placedRef.current.delete(pid);
          setCmds((c) => ({
            ...c,
            [pid]: { seq: ++seq.current, kind: "leave" },
          }));
        }
        pollRef.current?.();
      },
      onStatus: (s) => {
        setStatus(s);
        const online = s === "direct" || s === "relay";
        setPeerOnline(online);
        // the customer's app dropped: their pointer is nowhere now (the mirror keeps their last
        // screen; REQ-297 — dimmed and greyed, under the waiting overlay, until the next snapshot)
        if (!online) {
          customerRef.current = null;
          glide.hide();
          lastTRef.current = 0;
          // REQ-430 (cycle 3, m4) — the frozen ghost stops saying "Connected": connecting (or
          // ended) in the stage's words until the customer's pill speaks again
          setPillFace((f) => pillFaceOffline(f, s));
        }
        if (s === "waiting") setStale(true);
        if (wasOnline && !online && s !== "ended") pollRef.current?.();
        wasOnline = online;
        if (s === "replaced") {
          // REQ-232 — another window of this account has the demo now: nothing moves here
          customerRef.current = null;
          // REQ-646 (cycle 5, m63) — and nothing of his is pointed from here any more
          drop();
          peersRef.current.clear();
          placedRef.current.clear();
          glide.hide();
          setCmds({});
        }
        if (s === "closed") {
          demoModeClient.active().then((a) => {
            const next = afterActiveCheck({
              found: Boolean(a.session),
              shown: shownRef.current,
            });
            if (next !== "show") {
              setDemo(null);
              setGone(true);
              if (next === "handBack") handBack(); // REQ-541 (M22)
            }
          }).catch(() => setDemo(null));
        }
      },
      onPeerOnline: (cid, tab) => {
        // the customer's page joined (a new clock) and its snapshot is on the way: show it this
        // pointer at rest. REQ-309 — another tab (or page) of theirs: the mirror starts over —
        // its page may have loaded earlier, and a frame of the old tab still decoding is dropped
        rx.reset();
        dirtyRef.current = false;
        lastTRef.current = 0;
        // REQ-391 (M4) — until this tab's snapshot is in, the frame is not its screen: never Live
        setAwaiting(true);
        // REQ-642 — a report from the page before says nothing of this one's screen
        reportRef.current = null;
        showGhost();
        if (cid !== followedCid) {
          // REQ-645 (cycle 5 m36) — ANOTHER of their browser tabs (not the same tab's next page):
          // his anchor is kept for its page load and dropped here (otherTab) — known now when the
          // socket's claim said its key first, else once it says it (onPeerTab); the last socket's
          // page waits for nothing more
          if (tabsRef.current.follow(cid, tab)) otherTab();
          waitTabRef.current = null;
          // REQ-292 — another of the customer's tabs: its page load may be OLDER than the one
          // shown; the receiver starts over so that tab's snapshot is taken (the mirrored page
          // stays on screen until it comes)
          followedCid = cid;
          rx.reset();
          loadRef.current = null;
        }
        resendPointer();
        // REQ-295 — their new page tells where its pill is. REQ-540 (cycle 4, m9) — until it
        // does, the ghost stays where the pill was and says "Connecting…" (the new page's pill is
        // connecting and cannot say so: its face rides the link that is opening) — never a blank
        // and then a "Connected" the customer's pill never showed
        setPillFace((f) => pillFaceAwaiting(f));
        // REQ-636 (cycle 5, m8) — the old tab's held faces go; the new tab's wait for its own
        // frames, and it is asked for its pill (one it sent before this stage followed it was
        // dropped by the link)
        pills.reset();
        linkRef.current?.send({ k: "askPill" });
      },
      onPeerTab: (cid, tab) => {
        // REQ-645 (cycle 5 m36) — the followed socket says which browser tab it is only now: another
        // tab — his anchor kept and dropped (otherTab); then what waited for it — its page, when it
        // came in meanwhile (his anchor left on that load, else resendPointer; the tab notice), or
        // his pointer as onPeerOnline would have sent it
        const was = tabsRef.current.unsure();
        if (tabsRef.current.learn(cid, tab)) otherTab();
        if (!was || tabsRef.current.unsure()) return;
        const w = waitTabRef.current;
        waitTabRef.current = null;
        if (w && w.load === loadRef.current) {
          if (!restoreKept(w.load, w.path)) resendPointer();
        } else resendPointer();
      },
      onPeer: (m: PeerMessage, from: PeerFrom) => {
        if (from.role === "presenter") {
          // REQ-214 — a colleague's pointer, on the same element of the mirror
          const pid = from.pid ?? "";
          if (!pid || pid === demoRef.current?.pid) return;
          if (m.k === "move") {
            if (!newerMove(lastTOf.get(pid) ?? 0, m.t)) return;
            lastTOf.set(pid, m.t ?? lastTOf.get(pid) ?? 0);
            peersRef.current.set(pid, m.a);
            placePeer(pid, m.a, "move");
          } else if (m.k === "click") {
            peersRef.current.set(pid, m.a);
            placePeer(pid, m.a, "click");
          } else if (m.k === "leave") {
            peersRef.current.delete(pid);
            placedRef.current.delete(pid);
            command(pid, { kind: "leave" });
          }
          return;
        }
        switch (m.k) {
          case "dom":
            void rx.push(m);
            break;
          case "move":
            if (!newerMove(lastTRef.current, m.t)) break;
            lastTRef.current = m.t ?? lastTRef.current;
            customerRef.current = m.a;
            showCustomer();
            break;
          case "click": {
            customerRef.current = m.a;
            const p = placeOnStage(m.a);
            glide.glideTo(
              p.at,
              p.outside,
              p.outside ? null : rectOnStage(m.a),
            );
            const id = ++waveId.current;
            setWaves((w) => [...w, newStageWave(id, m.a, waveFrame())]);
            setTimeout(
              () => setWaves((w) => w.filter((x) => x.id !== id)),
              WAVE_MS,
            );
            break;
          }
          case "leave":
            customerRef.current = null;
            glide.hide();
            break;
          case "placed":
            // REQ-642 (cycle 5, m10) — where their screen has HIS arrow (a colleague's report is
            // for the colleague's stage)
            if (m.pid !== demoRef.current?.pid) break;
            reportRef.current = m;
            showGhost();
            break;
          case "pill": {
            // REQ-636 (cycle 5, m8) — shown with the frame it went out with (held till then)
            const p = pills.offer(m, m.t);
            if (p) showPill(p);
            break;
          }
        }
      },
      onEnded: (by, reason, pid) => {
        leavingRef.current = true; // REQ-541 — the notice below says who ended it
        setEnded(true);
        customerRef.current = null;
        peersRef.current.clear();
        placedRef.current.clear();
        glide.hide();
        setCmds({});
        // REQ-235 — who ended it rides the hop to /admin
        const d = demoRef.current;
        const notice: EndedNotice = endedHere.current
          ? { by: "you" }
          : whoEnded({ by, reason, pid }, {
            role: "presenter",
            pid: d?.pid,
            presenters: d?.presenters ?? [],
            targetName: d?.targetName,
          });
        setTimeout(() => {
          setDemo(null);
          setEnded(false);
          void backToOwnAccount(notice);
        }, 1500);
      },
    });
    linkRef.current = link;
    // a frame missing for too long, or one that did not fit (REQ-309): the customer starts the
    // mirror over — asked again every MIRROR_GAP_MS until a snapshot lands
    const stall = setInterval(() => {
      if (rx.stalled() || dirtyRef.current) askResync();
      // REQ-636 — a pill whose frame never came is shown anyway
      const due = pills.due();
      if (due) showPill(due);
      // REQ-391 (M4) — a snapshot asked for and not in: "Catching up…"; how late the frames come
      // in: "Behind N s" when it is over LAG_BEHIND_MS
      const resyncing = dirtyRef.current || rx.stalled();
      const lag = rx.lag();
      behind = behindSeconds(lag.last, behind);
      // REQ-648 — how long their next page has been coming: "Loading their next page… N s behind"
      const page = behindSeconds(pages.waiting(), 0);
      setLagView((v) =>
        v.behind === behind && v.resyncing === resyncing && v.page === page
          ? v
          : { behind, resyncing, page }
      );
      if (dev) {
        setStatsText(
          mirrorStatsText(
            rx.stats(),
            ownRef.current,
            lag,
            link.isDirect(),
            replayerRef.current?.stats(),
            pages.stats(),
          ),
        );
      }
    }, 500);
    return () => {
      clearInterval(stall);
      throttle.cancel();
      rest.cancel();
      link.close();
      linkRef.current = null;
      commandRef.current = null;
      rx.reset();
      loadRef.current = null;
      customerRef.current = null;
      peersRef.current.clear();
      placedRef.current.clear();
      drop();
      glide.hide();
      setCmds({});
      setMirrored(null);
      setStale(false);
      setAwaiting(false);
      setLagView({ behind: 0, resyncing: false, page: 0 });
      pageClockRef.current = null;
      // REQ-370 — the next demo's first frame waits for its own stylesheets
      if (styleTimerRef.current) clearTimeout(styleTimerRef.current);
      styleTimerRef.current = null;
      firstSnapAtRef.current = null;
      // REQ-645 — no look for his anchor's print, nothing kept, no tab notice for a demo that went
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
      deadAtRef.current = null;
      keptRef.current.clear();
      switchedRef.current = false;
      waitTabRef.current = null;
      if (tabNoteTimerRef.current) clearTimeout(tabNoteTimerRef.current);
      tabNoteTimerRef.current = null;
      setTabNote(null);
      styledRef.current = false;
      setStyled(false);
      setPeerOnline(false);
      setStatus("connecting");
    };
  }, [demo?.id]);

  // 3. REQ-393 — the presenter's mouse, anywhere on the stage: on the frame it points there; beside
  //    it (the margins round a phone, the pill) the customer sees the arrow on their screen's edge
  //    and the stage says so; only leaving the window takes the pointer away. A stage opened under
  //    a still mouse gets no pointer event at all, so it starts where the page that opened it last
  //    saw the mouse (taken once), and hands its own over when it goes (a reload, End)
  useEffect(() => {
    // REQ-451 (M14) — held until the frame is fitted, and counted only on it (takeSeed)
    seedRef.current = takeCursor(sessionStore());
    const at = (e: PointerEvent) => {
      const p = { x: e.clientX, y: e.clientY };
      seedRef.current = null; // REQ-451 — a real event says where the mouse is
      hintRef.current = null;
      setTabNote(null); // REQ-645 (m36) — he points again: said
      lastMoveRef.current = p;
      markOff();
      if (fitted() && linkRef.current) throttle.push(p);
    };
    const gone = () => {
      lastMoveRef.current = null;
      seedRef.current = null;
      hintRef.current = null;
      drop();
      throttle.cancel();
      rest.cancel();
      setOff(false);
      linkRef.current?.send({ k: "leave" });
    };
    // REQ-539 (m24) — the stage's own hand-off: a reload is the same page, the same spot
    const hand = () =>
      handCursor(sessionStore(), lastMoveRef.current, Date.now(), "stage");
    const opts = { capture: true, passive: true };
    document.addEventListener("pointermove", at, opts);
    document.addEventListener("pointerover", at, opts);
    document.addEventListener("pointerdown", at, opts);
    document.documentElement.addEventListener("pointerleave", gone);
    addEventListener("pagehide", hand);
    return () => {
      document.removeEventListener("pointermove", at, opts);
      document.removeEventListener("pointerover", at, opts);
      document.removeEventListener("pointerdown", at, opts);
      document.documentElement.removeEventListener("pointerleave", gone);
      removeEventListener("pagehide", hand);
    };
  }, []);

  /** REQ-153 — the demo over, the presenter is handed their own account back; REQ-235 — on
   *  /admin, which says who ended it */
  async function backToOwnAccount(notice: EndedNotice) {
    try {
      const who = await adminClient.whoami();
      if (who.impersonating) await adminClient.stopImpersonating();
    } catch {
      // not impersonating, or signed out
    }
    globalThis.location.href = endedHref(notice);
  }

  /** REQ-541 (cycle 4, M22) — the demo went without this stage hearing who ended it: back to
   *  the presenter's own account, once */
  function handBack() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    void backToOwnAccount({ by: "unknown" });
  }

  async function end() {
    // REQ-235 + REQ-179 — said at once, before the server answers
    endedHere.current = true;
    leavingRef.current = true;
    setEnded(true);
    linkRef.current?.end();
    try {
      if (demo) await demoModeClient.end(demo.id);
    } catch {
      // the socket's end reaches the server too
    }
    setTimeout(() => void backToOwnAccount({ by: "you" }), 800);
  }

  /** REQ-537 (m36) — with others presenting: leave the demo (it goes on with them), hand the
   *  account back, and go to /admin — what the banner's Return did on the stage, now in the pill */
  async function leave() {
    if (!demo || leavingHere) return;
    setLeavingHere(true);
    await demoModeClient.leave(demo.id).catch(() => {});
    try {
      const who = await adminClient.whoami();
      if (who.impersonating) await adminClient.stopImpersonating();
    } catch {
      // not impersonating, or signed out
    }
    globalThis.location.href = "/admin";
  }

  // REQ-648 — a click on the page they left (the next one loading) is never sent: it landed on
  // whatever their new page had at that spot
  const sendClick = (x: number, y: number) => {
    if (loadingNextRef.current) return;
    const a = anchorOf({ x, y });
    // REQ-645 — never a click wave at a fraction the replay could not name a node for
    linkRef.current?.send(
      provisionalRef.current
        ? { k: "pending", a: { vx: a.vx, vy: a.vy }, t: performance.now() }
        : { k: "click", a },
    );
  };

  const name = demo?.targetName ?? "";
  /** REQ-214 — this presenter's colour; REQ-642 — his own marker and ghost wear it (never the
   *  customer's orange) */
  const myColor = demo?.presenters.find((p) => p.userId === demo.pid)?.color ??
    PRESENTER_COLORS[0];
  // REQ-232 (demo-lifecycle-p1, m1, m3) — plain words, never the transport
  // REQ-309 (demo m26) — "Live" is the frame's truth: the followed tab's screen is in it
  // REQ-391 (M4) — …and in time: their page gone or not in yet, a resync out, frames late
  // REQ-648 (cycle 5, M3) — and how long their next page has been coming, once it is worth saying
  const live = stageStatus({
    ended,
    status,
    mirrored: !!mirrored && styled, // REQ-370 — shown only once styled
    awaiting,
    resyncing: lagView.resyncing,
    behind: lagView.behind,
    pageBehind: lagView.page,
  });
  // REQ-648 (c4-m28) — the frame holds the page they left while their next one loads: dimmed, and
  // his pointer is not sent against it (the move throttle, the look-up of his still mouse, a click)
  const loadingNext = live.key === "loadingNext";
  loadingNextRef.current = loadingNext;
  // REQ-297 — the frame's look: greyed, dimmed and under the waiting overlay while the screen in it
  // is the one from before the customer's app dropped; REQ-370 — hidden until the replay is styled
  const look = stageFrameLook({
    status,
    mirrored: !!mirrored,
    stale,
    styled,
    loadingNext,
  });
  // REQ-646 (cycle 5, m63) — no copy of the customer's pill while another window has the demo:
  // this one no longer hears it, so it would only say a stale "Connecting…"
  const pillShown = look.elsewhere ? null : pillBox;
  const statusLabel = live.key === "ended"
    ? t("demoMode.ended")
    : live.key === "elsewhere"
    ? t("demoMode.elsewhere")
    : live.key === "waiting"
    ? t("demoMode.waitingFor", { name })
    : live.key === "loadingNext"
    ? (live.n
      ? t("demoMode.loadingNextBehind", { n: live.n })
      : t("demoMode.loadingNext"))
    : live.key === "catchingUp"
    ? t("demoMode.catchingUp")
    : live.key === "behind"
    ? t("demoMode.behind", { n: live.n ?? 2 })
    : live.key === "live"
    ? t("demoMode.live")
    : t("demoMode.connecting");
  // REQ-291 — centred by auto margins at max-content width: `left:50%` + translate capped the
  // shrink-to-fit width at half the window (CSS 2.1 §10.3.7), so the pill wrapped at 1440 px.
  // flex-wrap stays for windows genuinely narrower than the pill; border-box so the
  // viewport cap includes the padding (max-content + content-box overflowed by it).
  const pillStyle =
    `position:fixed;left:0;right:0;margin:0 auto;width:max-content;bottom:${STAGE_PILL_BOTTOM}px;z-index:${
      Z + 3
    };display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-sizing:border-box;max-width:calc(100vw - 24px);padding:9px 14px;border-radius:14px;background:#1f3d1b;color:#fff;font:inherit;font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.35)`;
  const box = `position:absolute;left:${fit.left}px;top:${
    fit.top - bannerH
  }px;width:${fit.width}px;height:${fit.height}px`;

  return (
    <div
      data-demo-overlay
      data-cy="demo-stage"
      style={`position:fixed;left:0;right:0;bottom:0;top:${bannerH}px;background:#121a16;overflow:hidden;z-index:${
        Z - 1
      }`}
    >
      {gone && !demo
        ? (
          <div
            data-cy="demo-stage-empty"
            style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:inherit"
          >
            <div style="text-align:center;display:grid;gap:12px">
              <strong>{t("demoMode.noDemo")}</strong>
              {
                /* REQ-541 (M22) — stop impersonating first: a plain link left the presenter as
                  the customer, under /admin's "You are guiding … in this browser" */
              }
              <button
                type="button"
                data-cy="demo-stage-back"
                onClick={() => void backToOwnAccount({ by: "unknown" })}
                style="color:#fff;text-decoration:underline;font-size:13px;background:none;border:0;padding:0;cursor:pointer;font:inherit"
              >
                {t("demoMode.backToAdmin")}
              </button>
            </div>
          </div>
        )
        : demo && (
          <>
            {look.visibility === "hidden" && !look.elsewhere && (
              <div
                data-cy="demo-connecting"
                role="status"
                style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:inherit;pointer-events:none"
              >
                <style>
                  {`@keyframes pmDemoSpin{to{transform:rotate(360deg)}}`}
                </style>
                <div style="display:grid;gap:12px;justify-items:center;text-align:center;max-width:320px;padding:0 16px">
                  <span
                    aria-hidden="true"
                    style="width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;animation:pmDemoSpin .9s linear infinite"
                  />
                  <strong>{t("demoMode.connectingTo", { name })}</strong>
                </div>
              </div>
            )}
            <div
              style={`${box};border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.6);background:#fff;overflow:hidden;visibility:${look.visibility};filter:${look.filter};transition:filter .3s;outline:${
                mirrored && off ? "2px dashed rgba(255,255,255,.85)" : "none"
              };outline-offset:4px`}
            >
              <iframe
                ref={frameRef}
                data-cy="demo-frame"
                data-path={screen.path}
                title={t("demoMode.theirScreen", {
                  name,
                  w: screen.w,
                  h: screen.h,
                })}
                sandbox="allow-same-origin"
                srcdoc={MIRROR_SRCDOC}
                // REQ-293: a picture to assistive tech — the replayed DOM is never focusable or read
                inert
                aria-hidden="true"
                tabindex={-1}
                role="img"
                width={screen.w}
                height={screen.h}
                onLoad={onFrameLoad}
                style={`display:block;border:0;width:${screen.w}px;height:${screen.h}px;transform:scale(${fit.s});transform-origin:0 0;pointer-events:none;background:#fff`}
              />
            </div>
            {mirrored && (() => {
              // REQ-545 (demo-loop cycle 4, m2) — the customer's band, where their screen paints
              // it: the mirror skips the overlay, so without this the presenter saw content
              // (QUOTES PENDING) that the customer's band hid
              const b = bandGhostBox(pillFace.band ?? 0, screen, fit);
              if (!b) return null;
              return (
                <div
                  data-cy="demo-band-ghost"
                  aria-hidden="true"
                  style={`position:fixed;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;z-index:${
                    Z - 1
                  };background:${
                    pillFace.bandBg ?? "#fff"
                  };pointer-events:none`}
                />
              );
            })()}
            {mirrored && pillShown && pillFace.tucked === true && (() => {
              // REQ-545 — the pill tucked to its edge tab on their screen: a tab here too.
              // REQ-637 (demo-loop cycle 5, m5) — the labelled mini-pill: "● Demo" and its ×
              const ghost = pillGhost(pillShown, fit);
              if (!ghost) return null;
              const g = ghost.box;
              const r = Math.max(3, g.height / 2);
              return (
                <div
                  data-cy="demo-pill-ghost"
                  data-tucked=""
                  aria-hidden="true"
                  title={t("demoMode.pillGhost", { name })}
                  style={`position:fixed;left:${g.left}px;top:${g.top}px;width:${g.width}px;height:${g.height}px;z-index:${Z};box-sizing:border-box;border-radius:0 ${r}px ${r}px 0;background:rgba(31,61,27,.78);color:#fff;pointer-events:none;display:flex;align-items:center;gap:${
                    Math.max(2, 6 * fit.s)
                  }px;padding:0 ${Math.max(2, 8 * fit.s)}px 0 ${
                    Math.max(2, 10 * fit.s)
                  }px;overflow:hidden;white-space:nowrap;font-family:${PILL_FONT};font-size:${
                    Math.max(7, 12.5 * fit.s)
                  }px;font-weight:700;line-height:1`}
                >
                  <span
                    style={`flex:none;width:${
                      Math.max(3, 8 * fit.s)
                    }px;height:${
                      Math.max(3, 8 * fit.s)
                    }px;border-radius:50%;background:${
                      pillFace.status === "live" ? "#7ee081" : "#f2c14e"
                    }`}
                  />
                  <span
                    data-cy="demo-pill-ghost-tab-label"
                    style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis"
                  >
                    {t("demoMode.tabLabel")}
                  </span>
                  <span style="flex:none;opacity:.6">×</span>
                </div>
              );
            })()}
            {mirrored && pillShown && pillFace.tucked !== true && (() => {
              // REQ-372 (cycle 2, m1 + m8) — cut to the frame, and a read-only replica of what
              // the pill says, and a marker when the pill runs off their screen or past the frame.
              // REQ-430 (cycle 3, m4) — its status in the CUSTOMER's words (their pill's label),
              // its line unless compact and closed, then the guide's short name, as on the phone
              // REQ-540 (cycle 4, m9) — the whole pill: its "Demo mode" title and End (a disabled chip)
              const ghost = pillGhost(pillShown, fit);
              if (!ghost) return null;
              const g = ghost.box;
              const cut = ghost.clipped || pillFace.clipped === true;
              const words = ghostWords(pillFace, t);
              const px = Math.max(7, 13 * fit.s);
              return (
                <div
                  data-cy="demo-pill-ghost"
                  data-clipped={cut ? "" : undefined}
                  aria-hidden="true"
                  title={t("demoMode.pillGhost", { name })}
                  style={`position:fixed;left:${g.left}px;top:${g.top}px;width:${g.width}px;height:${g.height}px;z-index:${Z};box-sizing:border-box;border:1.5px dashed rgba(31,61,27,.55);border-radius:${
                    Math.max(4, 14 * fit.s)
                  }px;background:rgba(31,61,27,.78);color:#fff;pointer-events:none;display:flex;align-items:center;gap:${
                    Math.max(2, 6 * fit.s)
                  }px;padding:0 ${
                    Math.max(2, 8 * fit.s)
                  }px;overflow:hidden;white-space:nowrap;font-family:${PILL_FONT};font-size:${px}px;line-height:1.1`}
                >
                  {words.title && (
                    <strong
                      data-cy="demo-pill-ghost-title"
                      style="flex:none"
                    >
                      {words.title}
                    </strong>
                  )}
                  {words.text && (
                    <span
                      data-cy="demo-pill-ghost-text"
                      style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis"
                    >
                      {words.text}
                    </span>
                  )}
                  {words.guide && (
                    <span
                      data-cy="demo-pill-ghost-guide"
                      style="flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis"
                    >
                      {words.guide}
                    </span>
                  )}
                  {words.status && (
                    <span
                      data-cy="demo-pill-ghost-status"
                      style="flex:none;padding:1px 4px;border-radius:999px;background:rgba(255,255,255,.18);font-weight:700"
                    >
                      {words.status}
                    </span>
                  )}
                  {words.end && (
                    // REQ-540 (cycle 4, m9) — the pill's End, drawn as a chip the stage cannot use
                    <span
                      data-cy="demo-pill-ghost-end"
                      aria-disabled="true"
                      style="flex:none;padding:1px 5px;border-radius:5px;background:#fff;color:#7a2e2e;font-weight:700;opacity:.6"
                    >
                      {words.end}
                    </span>
                  )}
                  {cut && (
                    <span
                      data-cy="demo-pill-ghost-clipped"
                      title={t("demoMode.pillGhostClipped", { name })}
                      style="flex:none;margin-left:auto;font-weight:700"
                    >
                      …
                    </span>
                  )}
                </div>
              );
            })()}
            {look.waiting && (
              // REQ-391 (m21) — a banner across the frame's top edge, never a card over their page
              <div
                data-cy="demo-waiting"
                role="status"
                style={`position:absolute;left:${fit.left}px;top:${
                  fit.top - bannerH
                }px;width:${fit.width}px;z-index:${
                  Z + 2
                };box-sizing:border-box;pointer-events:none;color:#fff;font:inherit`}
              >
                <div style="display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;justify-content:center;text-align:center;padding:7px 12px;border-radius:6px 6px 0 0;background:rgba(18,26,22,.88);box-shadow:0 2px 10px rgba(0,0,0,.35);font-size:12.5px;line-height:1.35">
                  <strong>{t("demoMode.waitingFor", { name })}</strong>
                  <span style="opacity:.8">
                    {t("demoMode.waitingKeep")}
                  </span>
                </div>
              </div>
            )}
            {look.elsewhere && !ended && (
              // REQ-541 (cycle 4, M22) — another window of this account has the demo: the greyed
              // frame says so across it, with the way to take it back
              <div
                data-cy="demo-elsewhere"
                role="status"
                style={`position:absolute;left:${fit.left}px;top:${
                  fit.top - bannerH + fit.height / 2
                }px;width:${fit.width}px;transform:translateY(-50%);z-index:${
                  Z + 2
                };box-sizing:border-box;padding:0 12px;color:#fff;font:inherit`}
              >
                <div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:center;text-align:center;padding:14px 16px;border-radius:10px;background:rgba(18,26,22,.92);box-shadow:0 4px 18px rgba(0,0,0,.45);font-size:14px;line-height:1.35">
                  <strong>{t("demoMode.movedElsewhere")}</strong>
                  <button
                    type="button"
                    data-cy="demo-elsewhere-use-here"
                    onClick={() => globalThis.location.reload()}
                    style="padding:5px 12px;border-radius:8px;border:0;background:#fff;color:#1f3d1b;cursor:pointer;font:inherit;font-size:13px;font-weight:700"
                  >
                    {t("demoMode.useHere")}
                  </button>
                </div>
              </div>
            )}
            {mirrored && !look.elsewhere && (
              <div
                data-cy="demo-stage-layer"
                aria-hidden="true"
                style={`${box};z-index:${Z};cursor:crosshair;touch-action:none;background:transparent`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  sendClick(e.clientX, e.clientY);
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
            )}
            {
              /* REQ-451 (demo M1) — his arrow where their screen has it, while apart from his cursor;
                REQ-642 (cycle 5, m10) — where their screen REPORTED it, tagged "You", the tag
                outside his element and off its neighbours; REQ-646 (cycle 5, m63) — none of his
                pointer while another window has the demo */
            }
            {mirrored && !look.elsewhere && ghost && (
              <PointerGhost
                at={ghost.at}
                outside={ghost.outside}
                dir={ghost.dir}
                color={myColor}
                z={Z + 1}
                label={t("demoMode.pointerGhost")}
                bounds={fit}
                rect={sentRef.current && !ghost.outside
                  ? rectOnStage(sentRef.current)
                  : null}
              />
            )}
            {/* REQ-642 (setup-14d) — his own pointer, always, where he pointed: his colour, "You" */}
            {mirrored && !look.elsewhere && (
              <OwnPointer
                color={myColor}
                z={Z + 1}
                label={t("demoMode.pointerGhost")}
                tagged={!ghost}
                bind={bindOwn}
              />
            )}
            {
              /* REQ-393 (demo M8) — his mouse is beside the frame: said, on its outline; REQ-642 —
                in the chrome row above the frame, never over the replica */
            }
            {mirrored && !look.elsewhere && off && (
              <div
                data-cy="demo-pointer-off"
                role="status"
                style={`position:absolute;left:${
                  fit.left + fit.width / 2
                }px;top:${
                  stageBadgeTop(fit.top - bannerH)
                }px;transform:translateX(-50%);z-index:${
                  Z + 2
                };pointer-events:none;white-space:nowrap;box-sizing:border-box;height:${STAGE_BADGE_H}px;line-height:${
                  STAGE_BADGE_H - 2
                }px;max-width:calc(100vw - 16px);overflow:hidden;text-overflow:ellipsis;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.85);background:#1f3d1b;color:#fff;font:inherit;font-size:12.5px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.45)`}
              >
                {t("demoMode.pointerOff", { name })}
              </div>
            )}
            {/* REQ-645 (demo cycle 5 m36) — another of their tabs is shown now: said, until he moves */}
            {mirrored && !look.elsewhere && tabNote !== null && !off && (
              <div
                data-cy="demo-tab-switched"
                role="status"
                style={`position:absolute;left:${
                  fit.left + fit.width / 2
                }px;top:${
                  fit.top - bannerH
                }px;transform:translate(-50%,-50%);z-index:${
                  Z + 2
                };pointer-events:none;white-space:nowrap;max-width:${
                  Math.max(200, fit.width)
                }px;overflow:hidden;text-overflow:ellipsis;padding:4px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.85);background:#3d2e1b;color:#fff;font:inherit;font-size:12.5px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.45)`}
              >
                {t("demoMode.tabSwitched", { name, path: tabNote })}
              </div>
            )}
            {/* REQ-538 (demo cycle 4 M1) — his arrow is not on their screen: said, until it is */}
            {mirrored && !look.elsewhere && absent && !off && tabNote === null && (
              <div
                data-cy="demo-pointer-absent"
                role="status"
                style={`position:absolute;left:${
                  fit.left + fit.width / 2
                }px;top:${
                  stageBadgeTop(fit.top - bannerH)
                }px;transform:translateX(-50%);z-index:${
                  Z + 2
                };pointer-events:none;white-space:nowrap;box-sizing:border-box;height:${STAGE_BADGE_H}px;line-height:${
                  STAGE_BADGE_H - 2
                }px;max-width:calc(100vw - 16px);overflow:hidden;text-overflow:ellipsis;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.85);background:#3d2e1b;color:#fff;font:inherit;font-size:12.5px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.45)`}
              >
                {t("demoMode.pointerAbsent", { name })}
              </div>
            )}
          </>
        )}
      <DemoPointer
        pointer={glide.pointer}
        outside={glide.outside}
        rect={glide.rect}
        waves={waves}
        name={name}
        color={CUSTOMER_COLOR}
        z={Z + 1}
        attach={glide.attach}
        bounds={fit}
      />
      {demo?.presenters.filter((p) => p.userId !== demo.pid).map((p) => (
        <PeerPointer
          key={p.userId}
          name={p.name}
          color={p.color}
          z={Z + 1}
          cmd={cmds[p.userId] ?? null}
          bounds={fit}
        />
      ))}
      {demo && (
        <div
          ref={pillRef}
          data-cy="demo-pill"
          role="status"
          style={pillStyle}
        >
          <strong>{t("demoMode.title")}</strong>
          {/* REQ-374 (demo p8) — the customer's pointer colour is named, as the chips name each presenter's */}
          <span style="display:inline-flex;align-items:center;gap:6px">
            <span
              data-cy="demo-customer-dot"
              aria-hidden="true"
              style={`width:10px;height:10px;border-radius:50%;background:${CUSTOMER_COLOR};box-shadow:0 0 0 2px rgba(255,255,255,.85)`}
            />
            {t("demoMode.presenting", { name })}
          </span>
          <PresenterChips presenters={demo.presenters} me={demo.pid} t={t} />
          <span
            data-cy="demo-status"
            style={live.key === "elsewhere"
              // REQ-646 (cycle 5, m63) — a plain note, not a chip that reads like a button
              ? "opacity:.8;font-size:12px;font-style:italic"
              : "padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"}
          >
            {statusLabel}
          </span>
          {dev && statsText && (
            <span
              data-cy="demo-mirror-stats"
              title={MIRROR_STATS_LEGEND}
              style="opacity:.7;font-size:11px;font-family:ui-monospace,monospace;cursor:help"
            >
              {statsText}
            </span>
          )}
          {status === "replaced" && !ended && (
            <button
              type="button"
              data-cy="demo-use-here"
              onClick={() => globalThis.location.reload()}
              style="padding:4px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.75);background:transparent;color:#fff;cursor:pointer;font:inherit;font-size:12px;font-weight:700"
            >
              {t("demoMode.useHere")}
            </button>
          )}
          {mirrored && (
            <span
              data-cy="demo-screen"
              title={t("demoMode.pointOnlyHint")}
              style="opacity:.8;font-size:12px;cursor:help"
            >
              {t("demoMode.theirScreen", {
                name,
                w: mirrored.w,
                h: mirrored.h,
              })}
            </span>
          )}
          {/* REQ-537 (m36) — with other presenters, Leave is the secondary way out (outlined) */}
          {stageLeaveShown(demo.presenters.length) && !ended && (
            <button
              type="button"
              data-cy="demo-leave"
              onClick={() => void leave()}
              disabled={leavingHere}
              style="padding:4px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.75);background:transparent;color:#fff;cursor:pointer;font:inherit;font-size:12px;font-weight:700"
            >
              {t("demoMode.leave")}
            </button>
          )}
          {/* REQ-235 — End asks first */}
          <EndDemo onEnd={end} disabled={ended || leavingHere} t={t} />
        </div>
      )}
    </div>
  );
}
