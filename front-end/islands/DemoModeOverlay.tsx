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
import {
  ACTIVE_POLL_MS,
  type Anchor,
  fracToPoint,
  type PeerMessage,
  pointToFrac,
  type Presenter,
  type Role,
  STAGE_PATH,
} from "../../shared/demo-mode/protocol.ts";
import {
  createMirrorSender,
  type MirrorSender,
} from "../../shared/demo-mode/mirror.ts";
import {
  MOVE_GAP_DIRECT_MS,
  MOVE_GAP_RELAY_MS,
  moveThrottle,
  newerMove,
  type Pt,
} from "../../shared/demo-mode/motion.ts";
import { type ActivePoll, activePoll } from "../lib/demo-mode/active-poll.ts";
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
  clampRect,
  CONTROL_SELECTOR,
  pickPillSlot,
  PILL_COMPACT_MAX_W,
  PILL_MARGIN,
  pillSlots,
  samplePoints,
} from "../../shared/demo-mode/pill.ts";
import type { Rect } from "../../shared/demo-mode/protocol.ts";

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

const here = () => globalThis.location.pathname + globalThis.location.search;
/** REQ-228 — how often the pill re-checks what is under it (the page changes under a fixed box) */
const PILL_CHECK_MS = 700;

/** REQ-228 — how many distinct page controls lie under a box (the demo's own chrome not counted) */
function controlsUnder(r: Rect): number {
  const found = new Set<Element>();
  for (const { x, y } of samplePoints(r)) {
    const top = document.elementsFromPoint(x, y)
      .find((el) => !el.closest("[data-demo-overlay]"));
    const ctl = top?.closest(CONTROL_SELECTOR);
    if (ctl) found.add(ctl);
  }
  return found.size;
}

/** REQ-228 — the pill's next box: its current one while clear, else the first clear slot */
function placePill(el: HTMLElement, current: Rect | null): Rect {
  const view = { w: globalThis.innerWidth, h: globalThis.innerHeight };
  const size = { w: el.offsetWidth, h: el.offsetHeight };
  const cur = current
    ? clampRect({ ...current, width: size.w, height: size.h }, view)
    : null;
  return pickPillSlot(cur, pillSlots(view, size), controlsUnder);
}

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
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

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
  const linkRef = useRef<DemoLink | null>(null);
  /** REQ-228 — the pill, where it sits, and whether it is the phone's compact one */
  const pillRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<Rect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const impersonatingRef = useRef<boolean | null>(null);
  const placingRef = useRef(false);
  /** REQ-232 — this staff page is on its way to the stage (the pill says Opening…) */
  const [placing, setPlacing] = useState(false);
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

  /** REQ-242 — a point of this screen for the presenters: the fraction of this viewport and the
   *  mirrored element under it (their stage puts the pointer on that same element) */
  const anchorOf = (p: Pt): Anchor => {
    const a = pointToFrac(p, viewportBox());
    const recorder = recorderRef.current;
    const sender = senderRef.current;
    if (!recorder || !sender) return a;
    const id = recorder.idOf(document.elementFromPoint(p.x, p.y));
    const el = id === null ? null : recorder.nodeOf(id);
    if (id === null || !el) return a;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return a;
    return {
      ...a,
      n: {
        id,
        x: clamp01((p.x - r.left) / r.width),
        y: clamp01((p.y - r.top) / r.height),
        l: sender.load,
      },
    };
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
      }
      if (globalThis.location.pathname !== STAGE_PATH) {
        moving = true;
        globalThis.location.assign(STAGE_PATH);
      }
    } finally {
      placingRef.current = false;
      // on its way: the pill keeps saying Opening… until the stage loads
      if (!moving) setPlacing(false);
    }
  }

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
  // REQ-235 — a new demo takes the notice's place
  useEffect(() => {
    if (demo) setNotice(null);
  }, [demo?.id]);

  // 1. is there a demo for this session? on load, every 5 s while this side is not connected to the
  //    other, and when /admin opens one here. Every ask says where this app is. REQ-232 — the answer
  //    only REPORTS: a staff page goes to the stage when it opened the demo (the started event) or
  //    its staff click Back to the demo — never because a poll found the demo (demo-lifecycle-m3, M21).
  //    REQ-222 (M11): the schedule is the connection state's, not a chain's — see effect 1b.
  useEffect(() => {
    if (inert) return;
    let alive = true;
    const poller = activePoll({
      every: ACTIVE_POLL_MS,
      connected: () => peerOnlineRef.current,
      ask: async () => {
        // signed out, or the backend is away: it throws, nothing to draw, ask again later
        const a = await demoModeClient.active({ path: here() });
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
    // REQ-242 — this screen, recorded (paused until a presenter is there) and sent over the link
    let link: DemoLink | null = null;
    const sender = createMirrorSender({ send: (m) => link?.send(m) });
    const recorder = createRecorder(document, {
      emit: (f) => void sender.push(f),
    });
    senderRef.current = sender;
    recorderRef.current = recorder;
    link = connectDemo({
      sessionId: demo.id,
      role: demo.role,
      onPresence: (pid, online) => {
        lastT.delete(pid); // their stage came or went: its clock starts over
        // a presenter who left takes their pointer along
        if (!online) command(pid, { kind: "leave" });
        pollRef.current?.();
      },
      onStatus: (s) => {
        setStatus(s);
        const online = s === "direct" || s === "relay";
        setPeerOnline(online);
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
        // REQ-242 — a presenter joined: the whole screen at once, then every change
        recorder.snapshot();
      },
      onPeer: (m: PeerMessage, from: PeerFrom) => {
        if (from.role !== "presenter") return;
        const pid = who(from);
        switch (m.k) {
          case "move":
            // REQ-180: a move that arrives after a later one is ignored; the rest glide
            if (!newerMove(lastT.get(pid) ?? 0, m.t)) break;
            lastT.set(pid, m.t ?? lastT.get(pid) ?? 0);
            command(pid, { kind: "move", at: toScreen(m.a) });
            break;
          case "click":
            command(pid, { kind: "click", at: toScreen(m.a) });
            break;
          case "leave":
            command(pid, { kind: "leave" });
            break;
          case "resync":
            // REQ-242 — a stage missed a frame: the whole screen again
            recorder.snapshot();
            break;
        }
      },
      onEnded: (by, _reason, pid) => {
        // REQ-235 — who ended it, in the pill's place at once, kept until dismissed
        const d = demoRef.current;
        setNotice(whoEnded({ by, pid }, {
          role: "viewer",
          presenters: d?.presenters ?? [],
          presenterName: d?.presenterName,
        }));
        setCmds({});
        setDemo(null);
      },
    });
    linkRef.current = link;
    // the page is going (a reload, another page): its pointer goes with it
    const onHide = () => link?.send({ k: "leave" });
    globalThis.addEventListener("pagehide", onHide);
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
      globalThis.removeEventListener("focus", claim);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", claim, { capture: true });
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
    const onMove = (e: PointerEvent) => {
      if (linkRef.current) throttle.push({ x: e.clientX, y: e.clientY });
    };
    const onDown = (e: PointerEvent) =>
      linkRef.current?.send({
        k: "click",
        a: anchorOf({ x: e.clientX, y: e.clientY }),
      });
    const onLeave = () => linkRef.current?.send({ k: "leave" });
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
      document.removeEventListener("pointermove", onMove, { capture: true });
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [demo?.id]);

  // 5. REQ-228 — the pill sits where no control of the page is under it, and moves when one comes
  // REQ-235 — the ended notice is a pill too: it keeps clear of the page's controls the same way
  const shown = !inert && Boolean(demo || opening || notice);
  useEffect(() => {
    if (!shown) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const place = () => {
      const el = pillRef.current;
      if (!el || typeof document.elementsFromPoint !== "function") return;
      setCompact(narrow());
      const next = placePill(el, posRef.current);
      const cur = posRef.current;
      if (!cur || cur.left !== next.left || cur.top !== next.top) {
        posRef.current = next;
        setPos({ left: next.left, top: next.top });
      }
    };
    const later = () => {
      clearTimeout(settle);
      settle = setTimeout(place, 150);
    };
    place();
    const timer = setInterval(place, PILL_CHECK_MS);
    addEventListener("resize", later);
    document.addEventListener("scroll", later, {
      capture: true,
      passive: true,
    });
    const ro = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(later);
    if (pillRef.current) ro?.observe(pillRef.current);
    return () => {
      clearInterval(timer);
      clearTimeout(settle);
      ro?.disconnect();
      removeEventListener("resize", later);
      document.removeEventListener("scroll", later, { capture: true });
    };
  }, [shown, demo?.role]);

  if (inert) return null;

  const at = pos
    ? `left:${pos.left}px;top:${pos.top}px`
    : `left:${PILL_MARGIN}px;bottom:${PILL_MARGIN}px`;
  const pillStyle = `position:fixed;${at};z-index:${
    Z + 3
  };display:flex;gap:10px;align-items:center;flex-wrap:nowrap;white-space:nowrap;max-width:calc(100vw - ${
    2 * PILL_MARGIN
  }px);box-sizing:border-box;padding:7px 12px;border-radius:14px;background:#1f3d1b;color:#fff;font:inherit;font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.35)`;
  /** one line: a long name is cut, not wrapped */
  const cut = "overflow:hidden;text-overflow:ellipsis;min-width:0";

  // REQ-235 — the demo is over: who ended it, in the pill's place, until dismissed (Demo clicked
  // here again takes over)
  if (notice && !opening) {
    const said = endedText(notice);
    return (
      <div data-demo-overlay>
        <div
          ref={pillRef}
          data-cy="demo-ended"
          role="status"
          style={pillStyle}
        >
          <strong>{t("demoMode.title")}</strong>
          <span style={cut}>{t(said.key, said.vars)}</span>
          <button
            type="button"
            data-cy="demo-ended-dismiss"
            aria-label={t("demoMode.dismiss")}
            title={t("demoMode.dismiss")}
            onClick={() => setNotice(null)}
            style="padding:0 6px;border:0;background:transparent;color:#fff;cursor:pointer;font:inherit;font-size:18px;line-height:1;opacity:.85"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  if (!demo) {
    if (!opening) return null;
    // REQ-179 — Demo was just clicked: the pill is up before the server answers
    return (
      <div data-demo-overlay>
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
                style="padding:5px 12px;border-radius:8px;border:0;background:#fff;color:#1f3d1b;cursor:pointer;font:inherit;font-size:12px;font-weight:700"
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
  // REQ-232 (demo-lifecycle-p1) — plain words: is the staff here or not; never how the bytes travel
  const statusLabel = status === "ended"
    ? t("demoMode.ended")
    : status === "direct" || status === "relay"
    ? t("demoMode.connected")
    : t("demoMode.connecting");

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
      <div ref={pillRef} data-cy="demo-pill" role="status" style={pillStyle}>
        <span
          data-cy="demo-details"
          style={`display:${
            compact && !open ? "none" : "inline-flex"
          };gap:10px;align-items:center;${cut}`}
        >
          <strong>{t("demoMode.title")}</strong>
          <span style={cut}>{guidingText}</span>
          <PresenterChips presenters={presenters} nowrap />
        </span>
        <button
          type="button"
          data-cy="demo-more"
          aria-expanded={!compact || open}
          aria-label={guidingText}
          title={guidingText}
          onClick={() => setOpen((o) => !o)}
          style={`display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:${
            compact ? "pointer" : "default"
          }`}
        >
          {compact && (
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
