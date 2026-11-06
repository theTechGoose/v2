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
 * REQ-187 — the customer's screen is the truth: connected, this side REPORTS its view (the whole
 * of it on join, patches after: viewport size, page, scrolled elements, and whatever the page
 * islands report — sidebar flags, map centre/zoom) and draws the presenter's pointer at the
 * fraction of its own viewport (REQ-188) plus a loud expanding wave where they clicked, above the
 * app with pointer events off: a click there is never an action here. Inside the stage's frame
 * and on the stage itself this island is inert.
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
  fracToPoint,
  type PeerMessage,
  pointToFrac,
  type Role,
  STAGE_PATH,
  VIEW_GAP_MS,
  type ViewPatch,
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
} from "../lib/demo-mode/transport.ts";
import {
  collectScroll,
  isReplicaFrame,
  onReportedView,
  requestViews,
  scrollPosOf,
} from "../lib/demo-mode/replica.ts";
import { useGlide } from "../lib/demo-mode/use-glide.ts";
import DemoPointer, {
  type Wave,
  WAVE_MS,
} from "../components/demo-mode/DemoPointer.tsx";

interface Demo {
  id: string;
  role: Role;
  presenterName: string;
  targetName: string;
  targetUserId: string;
}

const Z = 2147483000;

const here = () => globalThis.location.pathname + globalThis.location.search;
/** REQ-188 — this side's layout viewport as a box */
const viewportBox = () => ({
  left: 0,
  top: 0,
  width: globalThis.innerWidth || 1,
  height: globalThis.innerHeight || 1,
});

export default function DemoModeOverlay() {
  /** REQ-187 — inside the stage's frame, or on the stage: the stage owns the demo */
  const inert = typeof globalThis.location !== "undefined" &&
    (isReplicaFrame() || globalThis.location.pathname === STAGE_PATH);
  const [demo, setDemo] = useState<Demo | null>(null);
  /** REQ-179 — Demo was just clicked on /admin: the pill says Opening… until the server answers */
  const [opening, setOpening] = useState<{ targetName: string } | null>(null);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [peerOnline, setPeerOnline] = useState(false);
  const [waves, setWaves] = useState<Wave[]>([]);
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
  const waveId = useRef(0);
  const glide = useGlide();

  /** this side's moves, rated leading + trailing so the rest position always goes out */
  const throttle = useMemo(() =>
    moveThrottle<Pt>({
      gap: () =>
        linkRef.current?.isDirect() ? MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS,
      send: ({ x, y }) =>
        linkRef.current?.send(
          {
            k: "move",
            a: pointToFrac({ x, y }, viewportBox()),
            t: performance.now(),
          },
          true,
        ),
    }), []);

  /** REQ-187 — this side's view patches, batched: scalar fields merge, scrolls merge by element */
  const pending = useRef<ViewPatch | null>(null);
  const viewTimer = useRef<number | undefined>(undefined);
  const flushView = () => {
    viewTimer.current = undefined;
    const p = pending.current;
    pending.current = null;
    if (p && linkRef.current) linkRef.current.send({ k: "view", v: p });
  };
  const report = (patch: ViewPatch) => {
    const cur = pending.current ?? {};
    const scroll = patch.scroll
      ? [
        ...(cur.scroll ?? []).filter((s) =>
          !patch.scroll!.some((n) => n.sel === s.sel)
        ),
        ...patch.scroll,
      ]
      : cur.scroll;
    pending.current = { ...cur, ...patch, ...(scroll ? { scroll } : {}) };
    if (viewTimer.current === undefined) {
      viewTimer.current = setTimeout(flushView, VIEW_GAP_MS);
    }
  };
  /** the whole view, on join */
  const wholeView = (): ViewPatch => ({
    w: globalThis.innerWidth,
    h: globalThis.innerHeight,
    path: here(),
    sb: document.querySelector(".sb--collapsed") !== null,
    drawer: document.querySelector(".sb--open") !== null,
    scroll: collectScroll(document),
  });

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
          setDemo((d) => d?.id === found.id ? d : found);
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
    let lastT = 0;
    let wasOnline = false;
    const link = connectDemo({
      sessionId: demo.id,
      role: demo.role,
      onStatus: (s) => {
        setStatus(s);
        const online = s === "direct" || s === "relay";
        setPeerOnline(online);
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
        // REQ-187 — the whole view at once, then the page islands' own state
        report(wholeView());
        requestViews();
      },
      onPeer: (m: PeerMessage) => {
        switch (m.k) {
          case "move":
            // REQ-180: a move that arrives after a later one is ignored; the rest glide
            if (!newerMove(lastT, m.t)) break;
            lastT = m.t ?? lastT;
            glide.glideTo(fracToPoint(m.a, viewportBox()));
            break;
          case "click": {
            const at = fracToPoint(m.a, viewportBox());
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
            // the stage never reports; nothing to apply here
            break;
        }
      },
      onEnded: () => {
        setEnded(true);
        glide.hide();
        setTimeout(() => {
          setDemo(null);
          setEnded(false);
        }, 1500);
      },
    });
    linkRef.current = link;
    return () => {
      throttle.cancel();
      clearTimeout(viewTimer.current);
      viewTimer.current = undefined;
      pending.current = null;
      link.close();
      linkRef.current = null;
      glide.hide();
      setPeerOnline(false);
      setStatus("connecting");
    };
  }, [demo?.id]);

  // 3. REQ-187 — the customer's view: the page (partials, history), the size, every scroll, and
  //    what the page islands report
  useEffect(() => {
    if (!demo || demo.role !== "viewer") return;
    let last = here();
    const tick = () => {
      const now = here();
      if (now !== last) {
        last = now;
        report({ path: now });
      }
    };
    const timer = setInterval(tick, 500);
    const onResize = () =>
      report({ w: globalThis.innerWidth, h: globalThis.innerHeight });
    const onScroll = (e: Event) => {
      const s = scrollPosOf(e.target);
      if (s) report({ scroll: [s] });
    };
    const off = onReportedView(report);
    addEventListener("popstate", tick);
    addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      clearInterval(timer);
      off();
      removeEventListener("popstate", tick);
      removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [demo?.id]);

  // 4. this side's pointer, document-wide (REQ-188: as a fraction of this viewport)
  useEffect(() => {
    if (!demo || demo.role !== "viewer") return;
    const onMove = (e: PointerEvent) => {
      if (linkRef.current) throttle.push({ x: e.clientX, y: e.clientY });
    };
    const onDown = (e: PointerEvent) =>
      linkRef.current?.send({
        k: "click",
        a: pointToFrac({ x: e.clientX, y: e.clientY }, viewportBox()),
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

  const name = demo.presenterName;
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
      <DemoPointer
        pointer={glide.pointer}
        waves={waves}
        name={name}
        color="#2f6d29"
        z={Z + 1}
        attach={glide.attach}
      />
      <div data-cy="demo-pill" role="status" style={pillStyle}>
        <strong>{t("demoMode.title")}</strong>
        <span>{t("demoMode.guiding", { name })}</span>
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
