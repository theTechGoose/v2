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
 *
 * REQ-214 — several staff may present at once: one pointer per presenter, each in that
 * presenter's colour with their name on it; the pill names them all with their colour dots.
 *
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
  fracToPoint,
  type PeerMessage,
  pointToFrac,
  type Presenter,
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
  type PeerFrom,
} from "../lib/demo-mode/transport.ts";
import {
  collectScroll,
  isReplicaFrame,
  onReportedView,
  requestViews,
  scrollPosOf,
} from "../lib/demo-mode/replica.ts";
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

export default function DemoModeOverlay() {
  /** REQ-187 — inside the stage's frame, or on the stage: the stage owns the demo */
  const inert = typeof globalThis.location !== "undefined" &&
    (isReplicaFrame() || globalThis.location.pathname === STAGE_PATH);
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
    const link = connectDemo({
      sessionId: demo.id,
      role: demo.role,
      onPresence: () => pollRef.current?.(),
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
      onPeer: (m: PeerMessage, from: PeerFrom) => {
        if (from.role !== "presenter") return;
        const pid = who(from);
        switch (m.k) {
          case "move":
            // REQ-180: a move that arrives after a later one is ignored; the rest glide
            if (!newerMove(lastT.get(pid) ?? 0, m.t)) break;
            lastT.set(pid, m.t ?? lastT.get(pid) ?? 0);
            command(pid, { kind: "move", at: fracToPoint(m.a, viewportBox()) });
            break;
          case "click":
            command(pid, {
              kind: "click",
              at: fracToPoint(m.a, viewportBox()),
            });
            break;
          case "leave":
            command(pid, { kind: "leave" });
            break;
          case "view":
            // the stage never reports; nothing to apply here
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
    return () => {
      throttle.cancel();
      clearTimeout(viewTimer.current);
      viewTimer.current = undefined;
      pending.current = null;
      link.close();
      linkRef.current = null;
      setCmds({});
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

  // REQ-235 — the demo is over: who ended it, in the pill's place, until dismissed (Demo clicked
  // here again takes over)
  if (notice && !opening) {
    const said = endedText(notice);
    return (
      <div data-demo-overlay>
        <div data-cy="demo-ended" role="status" style={pillStyle}>
          <strong>{t("demoMode.title")}</strong>
          <span>{t(said.key, said.vars)}</span>
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
  const statusLabel = status === "ended"
    ? t("demoMode.ended")
    : status === "direct"
    ? t("demoMode.direct")
    : status === "relay"
    ? t("demoMode.relay")
    : status === "waiting"
    ? t("demoMode.waiting")
    : "…";

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
        {/* REQ-235 — End asks first */}
        <EndDemo onEnd={end} />
      </div>
    </div>
  );
}
