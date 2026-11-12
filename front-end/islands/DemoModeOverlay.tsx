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
  const [ended, setEnded] = useState(false);
  const linkRef = useRef<DemoLink | null>(null);
  const impersonatingRef = useRef<boolean | null>(null);
  const placingRef = useRef(false);
  const peerOnlineRef = useRef(false);
  peerOnlineRef.current = peerOnline;
  const pollRef = useRef<(() => void) | null>(null);
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
   *  the first time) and goes to the stage (REQ-187), which shows the customer's page. */
  async function placePresenter(d: Demo) {
    if (placingRef.current) return;
    placingRef.current = true;
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
        globalThis.location.assign(STAGE_PATH);
      }
    } finally {
      placingRef.current = false;
    }
  }

  // 1. is there a demo for this session? on load, every 5 s while this side is not connected to the
  //    other, and when /admin opens one here. Every ask says where this app is.
  useEffect(() => {
    if (inert) return;
    let alive = true;
    let timer: number | undefined;
    const check = async () => {
      clearTimeout(timer);
      try {
        const a = await demoModeClient.active({ path: here() });
        if (!alive) return;
        if (a.session && a.role) {
          const found: Demo = { role: a.role, ...a.session };
          setDemo((d) => sameDemo(d, found) ? d : found);
          if (a.role === "presenter") void placePresenter(found);
        } else {
          setDemo(null);
        }
        setOpening(null);
      } catch {
        // signed out, or the backend is away — nothing to draw
      }
      if (alive && !peerOnlineRef.current) {
        timer = setTimeout(check, ACTIVE_POLL_MS);
      }
    };
    pollRef.current = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !peerOnlineRef.current) {
        void check();
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
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      globalThis.removeEventListener(DEMO_OPENING_EVENT, onOpening);
      globalThis.removeEventListener(DEMO_STARTED_EVENT, onStarted);
    };
  }, []);

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
      onEnded: () => {
        setEnded(true);
        setCmds({});
        setTimeout(() => {
          setDemo(null);
          setEnded(false);
        }, 1500);
      },
    });
    linkRef.current = link;
    // the page is going (a reload, another page): its pointer goes with it
    const onHide = () => link?.send({ k: "leave" });
    globalThis.addEventListener("pagehide", onHide);
    return () => {
      globalThis.removeEventListener("pagehide", onHide);
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

  if (inert) return null;

  const pillStyle = `position:fixed;left:12px;bottom:12px;z-index:${
    Z + 3
  };display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:9px 14px;border-radius:14px;background:#1f3d1b;color:#fff;font:inherit;font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.35)`;

  if (!demo) {
    if (!opening) return null;
    // REQ-179 — Demo was just clicked: the pill is up before the server answers
    return (
      <div data-demo-overlay>
        <div data-cy="demo-pill" role="status" style={pillStyle}>
          <strong>{t("demoMode.title")}</strong>
          <span>{t("demoMode.presenting", { name: opening.targetName })}</span>
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

  // the presenter's own pill lives on the stage; until it gets there, say so
  if (demo.role === "presenter") {
    return (
      <div data-demo-overlay>
        <div data-cy="demo-pill" role="status" style={pillStyle}>
          <strong>{t("demoMode.title")}</strong>
          <span>{t("demoMode.presenting", { name: demo.targetName })}</span>
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

  // REQ-214 — the presenters, by name; a demo written before the list has the one
  const presenters: Presenter[] = demo.presenters.length > 0
    ? demo.presenters
    : [{ userId: "", name: demo.presenterName, color: "#2f6d29" }];
  const names = presenters.map((p) => p.name).join(", ");
  const statusLabel = ended || status === "ended"
    ? t("demoMode.ended")
    : status === "direct"
    ? t("demoMode.direct")
    : status === "relay"
    ? t("demoMode.relay")
    : status === "waiting"
    ? t("demoMode.waiting")
    : "…";

  async function end() {
    const link = linkRef.current;
    link?.end();
    try {
      await demoModeClient.end(demo!.id);
    } catch {
      // the socket's end reaches the server too; either way this side is done
    }
    setEnded(true);
    setTimeout(() => {
      setDemo(null);
      setEnded(false);
    }, 800);
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
      <div data-cy="demo-pill" role="status" style={pillStyle}>
        <strong>{t("demoMode.title")}</strong>
        <span>
          {presenters.length > 1
            ? t("demoMode.guidingMany", { names })
            : t("demoMode.guiding", { name: names })}
        </span>
        <PresenterChips presenters={presenters} />
        <span
          data-cy="demo-status"
          style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"
        >
          {statusLabel}
        </span>
        <button
          type="button"
          data-cy="demo-end"
          disabled={ended}
          onClick={end}
          style="padding:5px 12px;border-radius:8px;border:0;background:#fff;color:#7a2e2e;cursor:pointer;font:inherit;font-size:12px;font-weight:700"
        >
          {t("demoMode.end")}
        </button>
      </div>
    </div>
  );
}
