/**
 * REQ-929 — sign out after inactivity. Mounted by the app shell on every signed-in page with the
 * person's own minutes (0 = Never: renders nothing, listens to nothing but Settings' change).
 *
 * Activity (pointer, key, touch, wheel, scroll) in ANY tab of this browser keeps the session:
 * each tab stamps `IDLE_LAST_KEY` in localStorage (throttled) and reads the others' stamps. In
 * the last minute a banner counts down with "Stay signed in"; at the deadline the tab signs out
 * the way the sidebar does — `pm:logout` first (polls stand down, REQ-907's 401 bounce is off),
 * the dash cache cleared, the server session deleted — and lands on /login?idle=1.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { langSignal, tFor } from "../lib/i18n.ts";
import { clearDashCache } from "../lib/dash-cache.ts";
import {
  fmtCountdown,
  IDLE_LAST_KEY,
  IDLE_MINUTES_EVENT,
  idlePhase,
  isIdleLogoutMinutes,
  parseLastActivity,
} from "../../shared/idle-logout/mod.ts";

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "touchstart",
  "wheel",
  "scroll",
];
/** once the banner shows, drifting the mouse or a scroll no longer counts: a deliberate tap, click
 *  or key does (else the pointer moving onto "Stay signed in" would unmount it under the click) */
const PASSIVE_EVENTS = new Set(["pointermove", "wheel", "scroll"]);
/** how often this tab writes its stamp for the others (a move every frame must not hit storage) */
const WRITE_EVERY_MS = 5_000;

function readShared(): number | null {
  try {
    return parseLastActivity(globalThis.localStorage?.getItem(IDLE_LAST_KEY));
  } catch {
    return null;
  }
}
function writeShared(now: number) {
  try {
    globalThis.localStorage?.setItem(IDLE_LAST_KEY, String(now));
  } catch { /* private mode: this tab still times itself */ }
}

export default function IdleLogout({ minutes: initial }: { minutes: number }) {
  const [minutes, setMinutes] = useState(initial);
  const [warnMs, setWarnMs] = useState<number | null>(null);
  const last = useRef(0);
  const lastWrite = useRef(0);
  const signingOut = useRef(false);
  const tickRef = useRef<() => void>(() => {});

  function bump(force: boolean) {
    const now = Date.now();
    last.current = now;
    if (force || now - lastWrite.current >= WRITE_EVERY_MS) {
      lastWrite.current = now;
      writeShared(now);
    }
  }

  // Settings saved a new value: follow it at once, and count from now
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<{ minutes?: unknown }>).detail?.minutes;
      if (isIdleLogoutMinutes(m)) setMinutes(m);
    };
    globalThis.addEventListener(IDLE_MINUTES_EVENT, on);
    return () => globalThis.removeEventListener(IDLE_MINUTES_EVENT, on);
  }, []);

  useEffect(() => {
    if (!(minutes > 0)) {
      setWarnMs(null);
      return;
    }
    // opening (or reloading) a page is activity
    bump(true);

    async function signOut() {
      if (signingOut.current) return;
      signingOut.current = true;
      globalThis.dispatchEvent(new Event("pm:logout"));
      clearDashCache();
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
      } catch {
        /* the proxy clears the cookie when the backend is down; leave anyway */
      }
      globalThis.location.href = "/login?idle=1";
    }

    function tick() {
      if (signingOut.current) {
        return;
      }
      const shared = readShared();
      const lastActivity = Math.max(last.current, shared ?? 0);
      const { phase, remainingMs } = idlePhase({
        minutes,
        lastActivity,
        now: Date.now(),
      });
      if (phase === "expired") {
        setWarnMs(null);
        signOut();
      } else if (phase === "warn") setWarnMs(remainingMs);
      else setWarnMs(null);
    }
    tickRef.current = tick;

    const onActivity = (e: Event) => {
      if (warnRef.current !== null && PASSIVE_EVENTS.has(e.type)) return;
      // a deliberate input in the warning stamps at once for the other tabs; the banner hides
      // on the next tick (≤ 1 s), never mid-click
      bump(warnRef.current !== null);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== IDLE_LAST_KEY) return;
      const v = parseLastActivity(e.newValue);
      if (v !== null && v > last.current) last.current = v;
      tick();
    };
    // a backgrounded tab's timers are throttled: check the moment it is shown again
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    for (const ev of ACTIVITY_EVENTS) {
      globalThis.addEventListener(ev, onActivity, {
        capture: true,
        passive: true,
      });
    }
    globalThis.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(tick, 1000);
    tick();
    return () => {
      clearInterval(id);
      for (const ev of ACTIVITY_EVENTS) {
        globalThis.removeEventListener(ev, onActivity, { capture: true });
      }
      globalThis.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [minutes]);

  const warnRef = useRef<number | null>(null);
  warnRef.current = warnMs;

  if (warnMs === null) return null;
  const lang = langSignal.value;
  return (
    <div
      data-cy="idle-warning"
      role="alertdialog"
      aria-live="assertive"
      style="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 32px);padding:14px 18px;border-radius:14px;background:var(--surface,#fff);color:var(--fg,#1d2b2e);box-shadow:0 12px 32px rgba(20,72,82,.22);border:1px solid var(--border,#d9e2e4);font-size:14.5px;font-weight:600"
    >
      <span>
        {tFor(lang, "idleLogout.warning", { time: fmtCountdown(warnMs) })}
      </span>
      <button
        type="button"
        data-cy="idle-stay"
        style="appearance:none;border:0;border-radius:10px;padding:9px 16px;background:var(--brand-teal,#144852);color:#fff;font:inherit;font-weight:700;cursor:pointer"
        onClick={() => {
          bump(true);
          tickRef.current();
        }}
      >
        {tFor(lang, "idleLogout.stay")}
      </button>
    </div>
  );
}
