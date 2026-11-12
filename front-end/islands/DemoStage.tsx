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
 * REQ-232 — the pill says plainly whether the demo is live: "Live", "Connecting…", or "Waiting for
 * {name}'s app…" — the last only when none of the customer's tabs is left, after a few seconds'
 * grace (a page change in their app is a new socket). The stage follows the tab the customer used
 * last (the link picks it). A newer window of the same staff account takes the demo over: this one
 * says "Open in another window" and offers "Use this window" (a reload takes it back).
 * REQ-235 — End asks first (EndDemo); the end goes to /admin saying who ended it ("You ended the
 * demo", "{customer} ended the demo", "{colleague} ended the demo"), where the overlay keeps it.
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
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
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
  pointToFrac,
  type Presenter,
  type Rect,
  sameAnchor,
} from "../../shared/demo-mode/protocol.ts";
import {
  createMirrorReceiver,
  MIRROR_GAP_MS,
  type MirrorFrame,
  type MirrorLag,
  type MirrorStats,
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
import { placeWavesAgain } from "../lib/demo-mode/pointer-anchor.ts";
import DemoPointer, {
  type Wave,
  WAVE_MS,
} from "../components/demo-mode/DemoPointer.tsx";
import PeerPointer, {
  type PointerCmd,
} from "../components/demo-mode/PeerPointer.tsx";
import PresenterChips from "../components/demo-mode/PresenterChips.tsx";
import EndDemo from "../components/demo-mode/EndDemo.tsx";
import {
  endedHref,
  type EndedNotice,
  whoEnded,
} from "../../shared/demo-mode/ended.ts";
import {
  PILL_FONT,
  pillGhost,
  STAGE_PILL_BOTTOM,
  stageInsetBottom,
  statusKeyOf,
} from "../../shared/demo-mode/pill.ts";
import {
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
/** room around the frame; the bottom band is the pill's measured height (REQ-228) */
const INSET = { top: 16, right: 16, left: 16 };
/** before the first snapshot: the frame is there (its shell loads) but nothing is shown */
const HIDDEN: Screen = { w: 1, h: 1, path: "" };
/** REQ-242 — when a snapshot's scrolls are applied again (its stylesheets and images loading) */
const SETTLE_MS = [150, 600, 1_500];

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
  "mirror (dev): f frames · hb heartbeats · x frames that did not fit · st stalls · rs resyncs asked · old dropped as older · bad undecodable · held waiting for an earlier frame · cv canvas bitmaps arrived/applied/repainted after a resize (REQ-380) · the last frame's age · lag median/worst seconds from the customer's push to the frame handed on · net the same to its last chunk in (encoder + wire) · p2p or ws: how the frames travel (WebRTC, or the server's socket)";
/** REQ-391 — seconds, one decimal; "–" for nothing measured */
const secs = (ms: number | null) => ms === null ? "–" : (ms / 1000).toFixed(1);
function mirrorStatsText(
  s: MirrorStats,
  own: OwnStats,
  lag: MirrorLag,
  direct: boolean,
  cv?: { seen: number; cv: number; repaints: number },
): string {
  const age = own.lastAt
    ? `${((Date.now() - own.lastAt) / 1000).toFixed(1)}s`
    : "–";
  const c = cv ?? { seen: 0, cv: 0, repaints: 0 };
  return `mirror f${s.frames} hb${s.beats} x${own.failed} st${s.stalls} rs${own.resyncs} old${s.older} bad${s.undecodable} held${s.held} cv${c.seen}/${c.cv}/${c.repaints} ${age} lag ${
    secs(lag.p50)
  }/${secs(lag.max)}s net ${secs(lag.netP50)}/${secs(lag.netMax)}s ${
    direct ? "p2p" : "ws"
  }`;
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
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [peerOnline, setPeerOnline] = useState(false);
  const [ended, setEnded] = useState(false);
  /** REQ-242 — null until the customer's first snapshot is in the frame */
  const [mirrored, setMirrored] = useState<Screen | null>(null);
  /** REQ-297 — the screen in the frame is from before the customer's app dropped */
  const [stale, setStale] = useState(false);
  /** REQ-391 — another tab (or page) of the customer's is followed and its snapshot is not in
   *  the frame yet: the frame still shows what came before */
  const [awaiting, setAwaiting] = useState(false);
  /** REQ-391 — how late the frames come (whole seconds, 0: in time) and whether a resync is out;
   *  read off the receiver on the stall tick, set only when it changes */
  const [lagView, setLagView] = useState({ behind: 0, resyncing: false });
  /** REQ-370 (demo m23) — the replay's stylesheets are in (or STYLE_WAIT_MS passed since the first
   *  snapshot): until then the frame stays hidden under "Connecting to {name}…", never unstyled */
  const [styled, setStyled] = useState(false);
  const styledRef = useRef(false);
  /** REQ-370 — when the first snapshot of this demo was applied, and the fallback timer */
  const firstSnapAtRef = useRef<number | null>(null);
  const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** REQ-235 — this stage's End ended it */
  const endedHere = useRef(false);
  const [stage, setStage] = useState({ w: 1, h: 1 });
  const [bannerH, setBannerH] = useState(0);
  /** REQ-228 — the pill's real height: the frame keeps out of that band, however it wraps */
  const [pillH, setPillH] = useState(0);
  const pillRef = useRef<HTMLDivElement | null>(null);
  /** REQ-371 (demo m10) — each wave keeps the anchor it was sent with: placed again with the pointer */
  const [waves, setWaves] = useState<(Wave & { a: Anchor })[]>([]);
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
  /** REQ-393 — the mark of a point beside the frame: off the customer's screen */
  const offFrame = (p: Pt) => outsideBox(p, fitBox()) ? { o: 1 as const } : {};

  /** REQ-242 — a point of this screen as the customer's: the fraction of the frame and, when the
   *  replay has one there, the mirrored element under it and where in its box */
  const anchorOf = (p: Pt): Anchor => {
    const f = fitBox();
    const a = pointToFrac(p, f);
    // REQ-393 — beside the frame: where his mouse meets the frame's edge, marked off their screen
    // (never a node: nothing of theirs is under it)
    if (outsideBox(p, f)) {
      const edge: Anchor = { ...a, o: 1 };
      sentRef.current = edge;
      return edge;
    }
    const load = loadRef.current;
    const rep = replayerRef.current;
    // REQ-305 — never a node of a replay whose stylesheets are not in: the node under the point
    // there is not the one under it on the customer's screen (the fraction is, near enough)
    const n = load && rep?.styled()
      ? rep.anchorAt((p.x - f.left) / f.s, (p.y - f.top) / f.s)
      : null;
    const out = n && load ? { ...a, n: { ...n, l: load } } : a;
    sentRef.current = out; // REQ-305 — every anchor of this pointer goes out: the last one sent
    return out;
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

  /** REQ-242 — where this presenter's pointer rests, once more: the customer's page that just
   *  joined (or was just mirrored afresh) has not seen it. As last sent when that named a node of
   *  the page the replay shows; else as a fraction of the frame only — REQ-305: never on a node
   *  looked for in a replay just built, its styles not in yet (that put it on whatever an
   *  unstyled page stacked under the point: a sidebar link, the phone drawer) */
  const resendPointer = () => {
    const p = lastMoveRef.current;
    if (!p || !fitted()) return;
    const sent = sentRef.current;
    const a = sent?.n?.l && sent.n.l === loadRef.current
      ? sent
      : { ...pointToFrac(p, fitBox()), ...offFrame(p) };
    sentRef.current = a;
    linkRef.current?.send({ k: "move", a, t: performance.now() });
  };
  /** REQ-305 — the resting pointer on the node under it in the styled replay, sent when that is
   *  not what went last (the frame settled under a still mouse); REQ-393 — after every layout
   *  pass, whatever moved under the mouse (their scroll, a change, the stage resized) */
  const restAgain = () => {
    const p = lastMoveRef.current;
    if (!p || !fitted()) return;
    const was = sentRef.current;
    const a = anchorOf(p);
    if (sameAnchor(was, a)) return;
    linkRef.current?.send({ k: "move", a, t: performance.now() });
  };
  /** REQ-393 — restAgain after a layout pass, rated like a move (a scroll is a burst of passes),
   *  on the reliable channel (the last look-up must arrive) */
  const rest = useMemo(() =>
    moveThrottle<null>({
      gap: () =>
        linkRef.current?.isDirect() ? MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS,
      send: () => restAgain(),
    }), []);
  /** REQ-393 — whether his mouse is beside the fitted frame (the outline and the hint) */
  const markOff = () => {
    const p = lastMoveRef.current;
    setOff(!!p && fitted() && outsideBox(p, fitBox()));
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
    glide.glideTo(p.at, p.outside);
  };
  const placePeer = (pid: string, a: Anchor, kind: "move" | "click") => {
    const p = placeOnStage(a);
    placedRef.current.set(pid, { ...p.at, outside: p.outside });
    commandRef.current?.(pid, { kind, at: p.at, outside: p.outside });
  };
  /** REQ-305 — the replay's layout may have moved (a frame applied, its styles, images or fonts
   *  in, a settle, the stage resized): every pointer anchored to its nodes is placed again;
   *  REQ-393 — and this presenter's resting pointer is looked up again under his still mouse */
  const replace = () => {
    checkStyled(); // REQ-370 — a stylesheet of the replay may just have loaded
    showCustomer();
    setWaves((w) => placeWavesAgain(w, (a) => placeOnStage(a).at));
    for (const [pid, a] of peersRef.current) {
      const p = placeOnStage(a);
      const was = placedRef.current.get(pid);
      if (
        was && was.x === p.at.x && was.y === p.at.y &&
        was.outside === p.outside
      ) continue;
      placePeer(pid, a, "move");
    }
    // REQ-393 — the spot under his still mouse may hold another element now: theirs too
    markOff();
    if (lastMoveRef.current) rest.push(null);
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
        resendPointer(); // REQ-305 — at once, a fraction of the frame
      }
      // its scrolls once more as its styles come in; REQ-305 — the pointers too
      SETTLE_MS.forEach((ms) => {
        setTimeout(() => {
          replayerRef.current?.settle();
          replaceRef.current();
        }, ms);
      });
      setStale(false); // REQ-297 — their screen is current again
      setAwaiting(false); // REQ-391 — and it is the followed tab's
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
        if (a.session && a.role === "presenter") {
          const found: Demo = { ...a.session, pid: a.pid };
          setDemo((d) => sameDemo(d, found) ? d : found);
          setGone(false);
        } else {
          setDemo(null);
          setGone(true);
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
    const rx = createMirrorReceiver({
      onFrame: take,
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
    ownRef.current = { failed: 0, resyncs: 0, lastAt: 0 };
    dirtyRef.current = false;
    // REQ-292 — the customer's tab the stage follows: a switch starts the mirror's ordering over
    let followedCid: string | undefined;
    const link = connectDemo({
      sessionId: demo.id,
      role: "presenter",
      pid: demo.pid ?? undefined,
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
        }
        if (s === "waiting") setStale(true);
        if (wasOnline && !online && s !== "ended") pollRef.current?.();
        wasOnline = online;
        if (s === "replaced") {
          // REQ-232 — another window of this account has the demo now: nothing moves here
          customerRef.current = null;
          peersRef.current.clear();
          placedRef.current.clear();
          glide.hide();
          setCmds({});
        }
        if (s === "closed") {
          demoModeClient.active().then((a) => {
            if (!a.session) {
              setDemo(null);
              setGone(true);
            }
          }).catch(() => setDemo(null));
        }
      },
      onPeerOnline: (cid) => {
        // the customer's page joined (a new clock) and its snapshot is on the way: show it this
        // pointer at rest. REQ-309 — another tab (or page) of theirs: the mirror starts over —
        // its page may have loaded earlier, and a frame of the old tab still decoding is dropped
        rx.reset();
        dirtyRef.current = false;
        lastTRef.current = 0;
        // REQ-391 (M4) — until this tab's snapshot is in, the frame is not its screen: never Live
        setAwaiting(true);
        if (cid !== followedCid) {
          // REQ-292 — another of the customer's tabs: its page load may be OLDER than the one
          // shown; the receiver starts over so that tab's snapshot is taken (the mirrored page
          // stays on screen until it comes)
          followedCid = cid;
          rx.reset();
          loadRef.current = null;
        }
        resendPointer();
        // REQ-295 — their new page tells where its pill is; the old ghost goes
        setPillBox(null);
        setPillFace({});
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
            glide.glideTo(p.at, p.outside);
            const id = ++waveId.current;
            setWaves((w) => [...w, { id, ...p.at, a: m.a }]);
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
          case "pill":
            setPillBox(m.r);
            setPillFace({
              compact: m.compact,
              open: m.open,
              status: m.status,
              text: m.text,
              clipped: m.clipped,
            });
            break;
        }
      },
      onEnded: (by, reason, pid) => {
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
      // REQ-391 (M4) — a snapshot asked for and not in: "Catching up…"; how late the frames come
      // in: "Behind N s" when it is over LAG_BEHIND_MS
      const resyncing = dirtyRef.current || rx.stalled();
      const lag = rx.lag();
      behind = behindSeconds(lag.last, behind);
      setLagView((v) =>
        v.behind === behind && v.resyncing === resyncing
          ? v
          : { behind, resyncing }
      );
      if (dev) {
        setStatsText(
          mirrorStatsText(
            rx.stats(),
            ownRef.current,
            lag,
            link.isDirect(),
            replayerRef.current?.stats(),
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
      sentRef.current = null;
      glide.hide();
      setCmds({});
      setMirrored(null);
      setStale(false);
      setAwaiting(false);
      setLagView({ behind: 0, resyncing: false });
      // REQ-370 — the next demo's first frame waits for its own stylesheets
      if (styleTimerRef.current) clearTimeout(styleTimerRef.current);
      styleTimerRef.current = null;
      firstSnapAtRef.current = null;
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
    const seeded = takeCursor(sessionStore());
    if (seeded && !lastMoveRef.current) lastMoveRef.current = seeded;
    const at = (e: PointerEvent) => {
      const p = { x: e.clientX, y: e.clientY };
      lastMoveRef.current = p;
      markOff();
      if (fitted() && linkRef.current) throttle.push(p);
    };
    const gone = () => {
      lastMoveRef.current = null;
      sentRef.current = null;
      throttle.cancel();
      rest.cancel();
      setOff(false);
      linkRef.current?.send({ k: "leave" });
    };
    const hand = () => handCursor(sessionStore(), lastMoveRef.current);
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

  async function end() {
    // REQ-235 + REQ-179 — said at once, before the server answers
    endedHere.current = true;
    setEnded(true);
    linkRef.current?.end();
    try {
      if (demo) await demoModeClient.end(demo.id);
    } catch {
      // the socket's end reaches the server too
    }
    setTimeout(() => void backToOwnAccount({ by: "you" }), 800);
  }

  const sendClick = (x: number, y: number) =>
    linkRef.current?.send({ k: "click", a: anchorOf({ x, y }) });

  const name = demo?.targetName ?? "";
  // REQ-297 — the frame's look: greyed, dimmed and under the waiting overlay while the screen in it
  // is the one from before the customer's app dropped; REQ-370 — hidden until the replay is styled
  const look = stageFrameLook({ status, mirrored: !!mirrored, stale, styled });
  // REQ-232 (demo-lifecycle-p1, m1, m3) — plain words, never the transport
  // REQ-309 (demo m26) — "Live" is the frame's truth: the followed tab's screen is in it
  // REQ-391 (M4) — …and in time: their page gone or not in yet, a resync out, frames late
  const live = stageStatus({
    ended,
    status,
    mirrored: !!mirrored && styled, // REQ-370 — shown only once styled
    awaiting,
    resyncing: lagView.resyncing,
    behind: lagView.behind,
  });
  const statusLabel = live.key === "ended"
    ? t("demoMode.ended")
    : live.key === "elsewhere"
    ? t("demoMode.elsewhere")
    : live.key === "waiting"
    ? t("demoMode.waitingFor", { name })
    : live.key === "loadingNext"
    ? t("demoMode.loadingNext")
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
              <a
                href="/admin"
                style="color:#fff;text-decoration:underline;font-size:13px"
              >
                {t("demoMode.backToAdmin")}
              </a>
            </div>
          </div>
        )
        : demo && (
          <>
            {look.visibility === "hidden" && (
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
            {mirrored && pillBox && (() => {
              // REQ-372 (cycle 2, m1 + m8) — cut to the frame, and a read-only replica of what
              // the pill says: its text (unless compact and closed), its status in this stage's
              // words, and a marker when the pill runs off their screen or past the frame
              const ghost = pillGhost(pillBox, fit);
              if (!ghost) return null;
              const g = ghost.box;
              const cut = ghost.clipped || pillFace.clipped === true;
              const showText = Boolean(pillFace.text) &&
                !(pillFace.compact && !pillFace.open);
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
                  {showText && (
                    <span
                      data-cy="demo-pill-ghost-text"
                      style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis"
                    >
                      {pillFace.text}
                    </span>
                  )}
                  {pillFace.status && (
                    <span
                      data-cy="demo-pill-ghost-status"
                      style="flex:none;padding:1px 4px;border-radius:999px;background:rgba(255,255,255,.18);font-weight:700"
                    >
                      {t(statusKeyOf(pillFace.status))}
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
            {mirrored && (
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
            {/* REQ-393 (demo M8) — his mouse is beside the frame: said, on its outline */}
            {mirrored && off && (
              <div
                data-cy="demo-pointer-off"
                role="status"
                style={`position:absolute;left:${
                  fit.left + fit.width / 2
                }px;top:${
                  fit.top - bannerH
                }px;transform:translate(-50%,-50%);z-index:${
                  Z + 2
                };pointer-events:none;white-space:nowrap;padding:4px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.85);background:#1f3d1b;color:#fff;font:inherit;font-size:12.5px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.45)`}
              >
                {t("demoMode.pointerOff", { name })}
              </div>
            )}
          </>
        )}
      <DemoPointer
        pointer={glide.pointer}
        outside={glide.outside}
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
          <span>{t("demoMode.presenting", { name })}</span>
          <PresenterChips presenters={demo.presenters} me={demo.pid} />
          <span
            data-cy="demo-status"
            style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"
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
          {/* REQ-235 — End asks first */}
          <EndDemo onEnd={end} disabled={ended} />
        </div>
      )}
    </div>
  );
}
