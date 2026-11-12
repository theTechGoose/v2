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
 * Point only: a transparent layer covers the frame; the presenter's moves and clicks go out as
 * fractions of the frame (REQ-188) plus the mirrored element under them (REQ-242 — the customer's
 * app puts the pointer on that same element) and never reach the frame. The customer's pointer is
 * drawn the same way back. The presenter's resting pointer is sent again when the customer's page
 * joins and after every snapshot; the customer's pointer goes when their page changes or their app
 * drops. The pill: the customer's name, the link status, the frame size, End — which hands the
 * presenter their own account back (stop-impersonating → /admin).
 *
 * REQ-214 — several staff may present at once: the other presenters' pointers are drawn on the
 * frame too, each in their colour with their name, and the pill lists who is presenting.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { t } from "../lib/i18n.ts";
import { demoModeClient } from "../clients/demo-mode.ts";
import { adminClient } from "../clients/admin.ts";
import {
  ACTIVE_POLL_MS,
  type Anchor,
  CUSTOMER_COLOR,
  fitScale,
  fracToPoint,
  type PeerMessage,
  pointToFrac,
  type Presenter,
} from "../../shared/demo-mode/protocol.ts";
import {
  createMirrorReceiver,
  MIRROR_GAP_MS,
  type MirrorFrame,
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
  createReplayer,
  MIRROR_SRCDOC,
  type Replayer,
} from "../lib/demo-mode/mirror-replay.ts";
import { useGlide } from "../lib/demo-mode/use-glide.ts";
import DemoPointer, {
  type Wave,
  WAVE_MS,
} from "../components/demo-mode/DemoPointer.tsx";
import PeerPointer, {
  type PointerCmd,
} from "../components/demo-mode/PeerPointer.tsx";
import PresenterChips from "../components/demo-mode/PresenterChips.tsx";

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
/** room around the frame: the pill sits in the bottom band */
const INSET = { top: 16, right: 16, bottom: 76, left: 16 };
/** before the first snapshot: the frame is there (its shell loads) but nothing is shown */
const HIDDEN: Screen = { w: 1, h: 1, path: "" };
/** REQ-242 — when a snapshot's scrolls are applied again (its stylesheets and images loading) */
const SETTLE_MS = [150, 600, 1_500];

export default function DemoStage() {
  const [demo, setDemo] = useState<Demo | null>(null);
  /** the server said there is no demo for this session */
  const [gone, setGone] = useState(false);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [peerOnline, setPeerOnline] = useState(false);
  const [ended, setEnded] = useState(false);
  /** REQ-242 — null until the customer's first snapshot is in the frame */
  const [mirrored, setMirrored] = useState<Screen | null>(null);
  const [stage, setStage] = useState({ w: 1, h: 1 });
  const [bannerH, setBannerH] = useState(0);
  const [waves, setWaves] = useState<Wave[]>([]);
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
  /** REQ-242 — where this presenter's pointer rests on the stage; null once it left the frame */
  const lastMoveRef = useRef<Pt | null>(null);
  /** REQ-180 — the customer's last move clock seen; REQ-242 — it is their page's performance.now(),
   *  which starts over with every page, so it is forgotten whenever their page changes */
  const lastTRef = useRef(0);
  const linkRef = useRef<DemoLink | null>(null);
  const peerOnlineRef = useRef(false);
  peerOnlineRef.current = peerOnline;
  const pollRef = useRef<(() => void) | null>(null);
  const waveId = useRef(0);
  const glide = useGlide();

  const screen = mirrored ?? HIDDEN;
  const fit = useMemo(
    () => fitScale(stage, screen, { ...INSET, top: INSET.top + bannerH }),
    [stage.w, stage.h, screen.w, screen.h, bannerH],
  );
  const fitRef = useRef(fit);
  fitRef.current = fit;
  /** REQ-188 — the frame's box on this screen: fractions of the customer's viewport map onto it */
  const fitBox = () => fitRef.current;

  /** REQ-242 — a point of this screen as the customer's: the fraction of the frame and, when the
   *  replay has one there, the mirrored element under it and where in its box */
  const anchorOf = (p: Pt): Anchor => {
    const f = fitBox();
    const a = pointToFrac(p, f);
    const load = loadRef.current;
    const n = load
      ? replayerRef.current?.anchorAt((p.x - f.left) / f.s, (p.y - f.top) / f.s)
      : null;
    return n && load ? { ...a, n: { ...n, l: load } } : a;
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
   *  joined (or was just mirrored afresh) has not seen it */
  const resendPointer = () => {
    const p = lastMoveRef.current;
    if (!p) return;
    linkRef.current?.send({ k: "move", a: anchorOf(p), t: performance.now() });
  };

  /** REQ-242 — the replay and the customer's screen came apart: a fresh snapshot, please */
  const askResync = () => {
    const now = Date.now();
    if (now - lastAskRef.current < MIRROR_GAP_MS) return;
    lastAskRef.current = now;
    linkRef.current?.send({ k: "resync" });
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
    if (!rep.apply(f)) {
      askResync();
      return;
    }
    if (load !== loadRef.current) lastTRef.current = 0; // another page: another clock
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
      // a new page, or a fresh copy of it: the customer's pointer was on the old one
      glide.hide();
      resendPointer();
      // its scrolls once more when its styles and images are in
      for (const ms of SETTLE_MS) {
        setTimeout(() => replayerRef.current?.settle(), ms);
      }
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
    replayerRef.current = createReplayer(doc);
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

  // 1. which demo: on load, every 5 s while the customer's app is not connected
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
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
    const rx = createMirrorReceiver({ onFrame: take });
    const link = connectDemo({
      sessionId: demo.id,
      role: "presenter",
      pid: demo.pid ?? undefined,
      onPresence: (pid, online) => {
        lastTOf.delete(pid); // their stage came or went: its clock starts over
        if (!online) {
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
        // the customer's app dropped: their pointer is nowhere now (the mirror keeps their last screen)
        if (!online) {
          glide.hide();
          lastTRef.current = 0;
        }
        if (wasOnline && !online && s !== "ended") pollRef.current?.();
        wasOnline = online;
        if (s === "closed") {
          demoModeClient.active().then((a) => {
            if (!a.session) {
              setDemo(null);
              setGone(true);
            }
          }).catch(() => setDemo(null));
        }
      },
      onPeerOnline: () => {
        // the customer's page joined (a new clock) and its snapshot is on the way: show it this
        // pointer at rest
        lastTRef.current = 0;
        resendPointer();
      },
      onPeer: (m: PeerMessage, from: PeerFrom) => {
        if (from.role === "presenter") {
          // REQ-214 — a colleague's pointer, on the same element of the mirror
          const pid = from.pid ?? "";
          if (!pid || pid === demoRef.current?.pid) return;
          if (m.k === "move") {
            if (!newerMove(lastTOf.get(pid) ?? 0, m.t)) return;
            lastTOf.set(pid, m.t ?? lastTOf.get(pid) ?? 0);
            command(pid, { kind: "move", at: toStage(m.a) });
          } else if (m.k === "click") {
            command(pid, { kind: "click", at: toStage(m.a) });
          } else if (m.k === "leave") {
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
            glide.glideTo(toStage(m.a));
            break;
          case "click": {
            const at = toStage(m.a);
            glide.glideTo(at);
            const id = ++waveId.current;
            setWaves((w) => [...w, { id, ...at }]);
            setTimeout(
              () => setWaves((w) => w.filter((x) => x.id !== id)),
              WAVE_MS,
            );
            break;
          }
          case "leave":
            glide.hide();
            break;
        }
      },
      onEnded: () => {
        setEnded(true);
        glide.hide();
        setCmds({});
        setTimeout(() => {
          setDemo(null);
          setEnded(false);
          void backToOwnAccount();
        }, 1500);
      },
    });
    linkRef.current = link;
    // a frame missing for too long: the customer starts the mirror over
    const stall = setInterval(() => {
      if (rx.stalled()) askResync();
    }, 500);
    return () => {
      clearInterval(stall);
      throttle.cancel();
      link.close();
      linkRef.current = null;
      rx.reset();
      loadRef.current = null;
      glide.hide();
      setCmds({});
      setMirrored(null);
      setPeerOnline(false);
      setStatus("connecting");
    };
  }, [demo?.id]);

  /** REQ-153 — the demo over, the presenter is handed their own account back */
  async function backToOwnAccount() {
    try {
      const who = await adminClient.whoami();
      if (who.impersonating) await adminClient.stopImpersonating();
    } catch {
      // not impersonating, or signed out
    }
    globalThis.location.href = "/admin";
  }

  async function end() {
    linkRef.current?.end();
    try {
      if (demo) await demoModeClient.end(demo.id);
    } catch {
      // the socket's end reaches the server too
    }
    setEnded(true);
    setTimeout(() => void backToOwnAccount(), 800);
  }

  const sendClick = (x: number, y: number) =>
    linkRef.current?.send({ k: "click", a: anchorOf({ x, y }) });

  const name = demo?.targetName ?? "";
  const statusLabel = ended || status === "ended"
    ? t("demoMode.ended")
    : status === "direct"
    ? t("demoMode.direct")
    : status === "relay"
    ? t("demoMode.relay")
    : status === "waiting"
    ? t("demoMode.waitingFor", { name })
    : "…";
  const pillStyle =
    `position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:${
      Z + 3
    };display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:9px 14px;border-radius:14px;background:#1f3d1b;color:#fff;font:inherit;font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.35)`;
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
            {!mirrored && (
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
                  <strong>{t("demoMode.connecting", { name })}</strong>
                </div>
              </div>
            )}
            <div
              style={`${box};border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.6);background:#fff;overflow:hidden;visibility:${
                mirrored ? "visible" : "hidden"
              }`}
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
                width={screen.w}
                height={screen.h}
                onLoad={onFrameLoad}
                style={`display:block;border:0;width:${screen.w}px;height:${screen.h}px;transform:scale(${fit.s});transform-origin:0 0;pointer-events:none;background:#fff`}
              />
            </div>
            {mirrored && (
              <div
                data-cy="demo-stage-layer"
                aria-hidden="true"
                style={`${box};z-index:${Z};cursor:crosshair;touch-action:none;background:transparent`}
                onPointerMove={(e) => {
                  lastMoveRef.current = { x: e.clientX, y: e.clientY };
                  if (linkRef.current) {
                    throttle.push({
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  sendClick(e.clientX, e.clientY);
                }}
                onPointerLeave={() => {
                  lastMoveRef.current = null;
                  throttle.cancel();
                  linkRef.current?.send({ k: "leave" });
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
            )}
          </>
        )}
      <DemoPointer
        pointer={glide.pointer}
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
        <div data-cy="demo-pill" role="status" style={pillStyle}>
          <strong>{t("demoMode.title")}</strong>
          <span>{t("demoMode.presenting", { name })}</span>
          <PresenterChips presenters={demo.presenters} me={demo.pid} />
          <span
            data-cy="demo-status"
            style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700"
          >
            {statusLabel}
          </span>
          {mirrored && (
            <span
              data-cy="demo-screen"
              style="opacity:.8;font-size:12px"
            >
              {t("demoMode.theirScreen", {
                name,
                w: mirrored.w,
                h: mirrored.h,
              })} · {t("demoMode.pointOnlyHint")}
            </span>
          )}
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
      )}
    </div>
  );
}
