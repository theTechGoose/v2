/**
 * REQ-187 — the stage: the staff's demo page. A dark stage with ONE frame — the app, as the
 * customer (impersonation), rendered at exactly the customer's layout viewport and scaled to fit
 * this window. The customer's app reports its view over the link and the stage applies it:
 * the frame's size, its page (navigated in place), the same scrolled elements, and the page-local
 * state (sidebar flags, map centre/zoom) handed into the frame for its islands to take.
 *
 * Point only: a transparent layer covers the frame; the presenter's moves and clicks go out as
 * fractions of the frame (REQ-188) and never reach it. The customer's pointer is drawn at the
 * same fraction of the frame. The pill: the customer's name, the link status, the frame size,
 * End — which hands the presenter their own account back (stop-impersonating → /admin).
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
  CUSTOMER_COLOR,
  DEFAULT_VIEW,
  fitScale,
  fracToPoint,
  mergeView,
  type PeerMessage,
  pointToFrac,
  type Presenter,
  type View,
} from "../../shared/demo-mode/protocol.ts";
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
  applyScroll,
  pushViewTo,
  REPLICA_FRAME_NAME,
} from "../lib/demo-mode/replica.ts";
import { useGlide } from "../lib/demo-mode/use-glide.ts";
import DemoPointer, {
  type Wave,
  WAVE_MS,
} from "../components/demo-mode/DemoPointer.tsx";
import PeerPointer, {
  type PointerCmd,
} from "../components/demo-mode/PeerPointer.tsx";
import PresenterChips from "../components/demo-mode/PresenterChips.tsx";
import {
  STAGE_PILL_BOTTOM,
  stageInsetBottom,
} from "../../shared/demo-mode/pill.ts";

interface Demo {
  id: string;
  presenterName: string;
  targetName: string;
  targetUserId: string;
  /** REQ-214 — everyone presenting, and which of them this browser is */
  presenters: Presenter[];
  pid: string | null;
}

/** the same demo with the same presenters (a roster change re-renders, a poll's echo does not) */
const sameDemo = (a: Demo | null, b: Demo) =>
  a?.id === b.id &&
  JSON.stringify(a.presenters) === JSON.stringify(b.presenters);

const Z = 2147483000;
/** room around the frame; the bottom band is the pill's measured height (REQ-228) */
const INSET = { top: 16, right: 16, left: 16 };

const framePath = (win: Window | null) => {
  try {
    return win ? win.location.pathname + win.location.search : null;
  } catch {
    return null;
  }
};

export default function DemoStage() {
  const [demo, setDemo] = useState<Demo | null>(null);
  /** the server said there is no demo for this session */
  const [gone, setGone] = useState(false);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [peerOnline, setPeerOnline] = useState(false);
  const [ended, setEnded] = useState(false);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const viewRef = useRef<View>(DEFAULT_VIEW);
  /** the customer's app has reported at least once (before that, targetPath from the poll stands in) */
  const heardRef = useRef(false);
  const [stage, setStage] = useState({ w: 1, h: 1 });
  const [bannerH, setBannerH] = useState(0);
  /** REQ-228 — the pill's real height: the frame keeps out of that band, however it wraps */
  const [pillH, setPillH] = useState(0);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const [waves, setWaves] = useState<Wave[]>([]);
  /** REQ-214 — the latest thing each colleague did, by pid */
  const [cmds, setCmds] = useState<Record<string, PointerCmd>>({});
  const seq = useRef(0);
  const demoRef = useRef<Demo | null>(null);
  demoRef.current = demo;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameLoaded = useRef(false);
  const linkRef = useRef<DemoLink | null>(null);
  const peerOnlineRef = useRef(false);
  peerOnlineRef.current = peerOnline;
  const pollRef = useRef<(() => void) | null>(null);
  const waveId = useRef(0);
  const glide = useGlide();
  /** the frame's first page; later pages are navigated in place (a new src would reload it) */
  const firstSrc = useRef<string | null>(null);

  const fit = useMemo(
    () =>
      fitScale(stage, view, {
        ...INSET,
        top: INSET.top + bannerH,
        bottom: stageInsetBottom(pillH),
      }),
    [stage.w, stage.h, view.w, view.h, bannerH, pillH],
  );
  const fitRef = useRef(fit);
  fitRef.current = fit;
  /** REQ-188 — the frame's box on this screen: fractions of the customer's viewport map onto it */
  const fitBox = () => fitRef.current;

  /** this side's moves, rated leading + trailing so the rest position always goes out */
  const throttle = useMemo(() =>
    moveThrottle<Pt>({
      gap: () =>
        linkRef.current?.isDirect() ? MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS,
      send: ({ x, y }) =>
        linkRef.current?.send(
          {
            k: "move",
            a: pointToFrac({ x, y }, fitBox()),
            t: performance.now(),
          },
          true,
        ),
    }), []);

  /** the view into the frame: its page, its scrolls, and the page islands' state */
  const applyView = (v: View) => {
    const frame = frameRef.current;
    const win = frame?.contentWindow ?? null;
    if (!frame || !win) return;
    if (!frameLoaded.current) return; // applied on load
    const at = framePath(win);
    if (at !== null && at !== v.path) {
      frameLoaded.current = false;
      try {
        win.location.replace(v.path);
      } catch {
        frameLoaded.current = true;
      }
      return; // the rest lands on load
    }
    try {
      applyScroll(win, v.scroll);
    } catch {
      // the frame is mid-navigation
    }
    pushViewTo(frame, v);
  };
  const onFrameLoad = () => {
    frameLoaded.current = true;
    const v = viewRef.current;
    const win = frameRef.current?.contentWindow ?? null;
    // a page may have redirected inside the frame; the customer's view still rules
    const at = framePath(win);
    if (at !== null && at !== v.path && heardRef.current) {
      applyView(v);
      return;
    }
    try {
      if (win) applyScroll(win, v.scroll);
    } catch {
      // not ours to scroll yet
    }
    if (frameRef.current) pushViewTo(frameRef.current, v);
    // scrolls settle after layout; once more a beat later
    setTimeout(() => {
      try {
        if (win && frameLoaded.current) {
          applyScroll(win, viewRef.current.scroll);
        }
      } catch {
        // gone
      }
    }, 120);
  };
  const takeView = (next: View) => {
    viewRef.current = next;
    setView(next);
    applyView(next);
  };

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
          // AMENDMENT — same screen at once: the customer's last reported page, until they report
          if (!heardRef.current && a.targetPath) {
            const v = viewRef.current;
            if (v.path !== a.targetPath) takeView({ ...v, path: a.targetPath });
          }
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

  // 2. the link
  useEffect(() => {
    if (!demo) return;
    let lastT = 0;
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
    const link = connectDemo({
      sessionId: demo.id,
      role: "presenter",
      pid: demo.pid ?? undefined,
      onPresence: (pid, online) => {
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
        // the customer reports the whole view on its own
      },
      onPeer: (m: PeerMessage, from: PeerFrom) => {
        if (from.role === "presenter") {
          // REQ-214 — a colleague's pointer, at the same fraction of the frame
          const pid = from.pid ?? "";
          if (!pid || pid === demoRef.current?.pid) return;
          if (m.k === "move") {
            if (!newerMove(lastTOf.get(pid) ?? 0, m.t)) return;
            lastTOf.set(pid, m.t ?? lastTOf.get(pid) ?? 0);
            command(pid, { kind: "move", at: fracToPoint(m.a, fitBox()) });
          } else if (m.k === "click") {
            command(pid, { kind: "click", at: fracToPoint(m.a, fitBox()) });
          } else if (m.k === "leave") {
            command(pid, { kind: "leave" });
          }
          return;
        }
        switch (m.k) {
          case "move":
            if (!newerMove(lastT, m.t)) break;
            lastT = m.t ?? lastT;
            glide.glideTo(fracToPoint(m.a, fitBox()));
            break;
          case "click": {
            const at = fracToPoint(m.a, fitBox());
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
          case "view":
            heardRef.current = true;
            takeView(mergeView(viewRef.current, m.v));
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
    return () => {
      throttle.cancel();
      link.close();
      linkRef.current = null;
      glide.hide();
      setCmds({});
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
    linkRef.current?.send({ k: "click", a: pointToFrac({ x, y }, fitBox()) });

  if (firstSrc.current === null && (heardRef.current || demo)) {
    firstSrc.current = view.path;
  }
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
    `position:fixed;left:50%;transform:translateX(-50%);bottom:${STAGE_PILL_BOTTOM}px;z-index:${
      Z + 3
    };display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:9px 14px;border-radius:14px;background:#1f3d1b;color:#fff;font:inherit;font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.35)`;

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
        : (
          <>
            <div
              style={`position:absolute;left:${fit.left}px;top:${
                fit.top - bannerH
              }px;width:${fit.width}px;height:${fit.height}px;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.6);background:#fff;overflow:hidden`}
            >
              {firstSrc.current !== null && (
                <iframe
                  ref={frameRef}
                  data-cy="demo-frame"
                  name={REPLICA_FRAME_NAME}
                  title={t("demoMode.theirScreen", {
                    name,
                    w: view.w,
                    h: view.h,
                  })}
                  src={firstSrc.current}
                  width={view.w}
                  height={view.h}
                  onLoad={onFrameLoad}
                  style={`display:block;border:0;width:${view.w}px;height:${view.h}px;transform:scale(${fit.s});transform-origin:0 0;pointer-events:none;background:#fff`}
                />
              )}
            </div>
            <div
              data-cy="demo-stage-layer"
              aria-hidden="true"
              style={`position:absolute;left:${fit.left}px;top:${
                fit.top - bannerH
              }px;width:${fit.width}px;height:${fit.height}px;z-index:${Z};cursor:crosshair;touch-action:none;background:transparent`}
              onPointerMove={(e) => {
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
              onPointerLeave={() => linkRef.current?.send({ k: "leave" })}
              onContextMenu={(e) => e.preventDefault()}
            />
          </>
        )}
      <DemoPointer
        pointer={glide.pointer}
        waves={waves}
        name={name}
        color={CUSTOMER_COLOR}
        z={Z + 1}
        attach={glide.attach}
      />
      {demo?.presenters.filter((p) => p.userId !== demo.pid).map((p) => (
        <PeerPointer
          key={p.userId}
          name={p.name}
          color={p.color}
          z={Z + 1}
          cmd={cmds[p.userId] ?? null}
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
          <span
            data-cy="demo-screen"
            title={t("demoMode.pointOnlyHint")}
            style="opacity:.8;font-size:12px;cursor:help"
          >
            {t("demoMode.theirScreen", { name, w: view.w, h: view.h })}
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
      )}
    </div>
  );
}
