/**
 * Persistent "you are impersonating" banner. Mounted globally in _app.tsx.
 *
 * On mount it asks the backend (/admin/whoami) whether the current session is
 * an impersonation session. If so it pins a banner to the top of the viewport
 * naming who you're acting as, with a "Return to your account" control that
 * hits /admin/stop-impersonating (server swaps the cookie back) and reloads.
 *
 * Renders nothing for ordinary sessions, so it's safe to mount everywhere.
 *
 * REQ-181: the banner makes room for itself. The shells are viewport-high and do not
 * scroll, so a fixed banner over them hid the brand, the top bar and the first card. While
 * shown, the banner publishes its height (`--banner-h` on <html>, re-measured when it wraps)
 * and pads the body; the shells' CSS subtracts it (lib/banner-room.ts).
 *
 * REQ-242 — it is marked `data-demo-skip`: the stage measures it by that, and the demo mirror never
 * records it (the customer's screen has no banner).
 *
 * REQ-232 (M21) — during a demo this staff presents, "Return to your account" asks first ("…takes
 * you out of the demo with {name}"), then LEAVES the demo (POST /demo-mode/sessions/:id/leave: it
 * ends when the last presenter leaves) and only then hands the account back — so /admin is where
 * it stays, not a stop on the way back to the stage.
 *
 * REQ-537 (demo-loop cycle 4, m36) — not drawn on the stage (/demo/stage): the stage pill's End is
 * its one exit (and, with other presenters, its "Leave the demo"); every other page keeps the bar.
 *
 * REQ-855 (demo-loop cycle dm3, m5) — one notice per page: nor while this staff PRESENTS the demo
 * (asked of /demo-mode/active on mount, once whoami says impersonating, before anything is drawn —
 * the presenter's pill is then the notice and carries the way out and the language), nor over
 * /admin's guide gate (it has both exits). When the overlay says the demo is gone
 * (DEMO_PRESENTING_EVENT), the bar comes back: an impersonation is never left unsaid.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { adminClient, type WhoAmI } from "../clients/admin.ts";
import { DEMO_PRESENTING_EVENT, demoModeClient } from "../clients/demo-mode.ts";
import { clearBannerRoom, setBannerRoom } from "../lib/banner-room.ts";
import { ImpersonationBannerView } from "../components/ImpersonationBannerView.tsx";
import {
  impersonationBannerOn,
  impersonationBarShown,
} from "../../shared/demo-mode/stage-chrome.ts";

export default function ImpersonationBanner() {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [busy, setBusy] = useState(false);
  /** REQ-232 — the demo this staff presents, while the banner asks whether to leave it */
  /** REQ-298 — `presenters`: how many present; alone, leaving ends the demo for the customer */
  const [leaving, setLeaving] = useState<
    { id: string; name: string; presenters: number } | null
  >(null);
  /** REQ-855 — this staff presents the demo this impersonation is for: the pill is the notice */
  const [presenting, setPresenting] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  // REQ-537 — on the stage the pill is the one exit: no bar (and no whoami asked for it)
  const [onPage] = useState(() =>
    typeof globalThis.location === "undefined" ||
    impersonationBannerOn(globalThis.location.pathname)
  );
  const shown = onPage && Boolean(who) && impersonationBarShown({
    path: globalThis.location?.pathname ?? "",
    impersonating: who?.impersonating === true,
    superAdmin: who?.superAdmin === true,
    presenting,
  });

  useEffect(() => {
    if (!onPage) return;
    let alive = true;
    adminClient.whoami()
      .then(async (w) => {
        // REQ-855 — an impersonation is asked whether it is a demo this staff presents BEFORE the
        // bar can be drawn (no red flash beside the pill); the demo side away: a plain bar
        const a = w.impersonating
          ? await demoModeClient.active().catch(() => null)
          : null;
        if (!alive) return;
        setPresenting(a?.role === "presenter" && Boolean(a.session));
        setWho(w);
      })
      .catch(() => {/* not logged in / backend down — show nothing */});
    // REQ-855 — the overlay says the presented demo appeared or went while this page is up
    const onPresenting = (e: Event) =>
      setPresenting((e as CustomEvent).detail === true);
    globalThis.addEventListener(DEMO_PRESENTING_EVENT, onPresenting);
    return () => {
      alive = false;
      globalThis.removeEventListener(DEMO_PRESENTING_EVENT, onPresenting);
    };
  }, []);

  // REQ-181: publish the banner's height while it is on screen; release it when it goes.
  useEffect(() => {
    const node = el.current;
    if (!shown || !node) return;
    const root = document.documentElement.style;
    const body = document.body.style;
    const measure = () =>
      setBannerRoom(root, body, node.getBoundingClientRect().height);
    measure();
    const ro = typeof ResizeObserver === "function"
      ? new ResizeObserver(measure)
      : null;
    ro?.observe(node);
    return () => {
      ro?.disconnect();
      clearBannerRoom(root, body);
    };
  }, [shown]);

  if (!shown || !who) return null;

  /** REQ-232 (M21) — `confirmed`: the staff said yes to leaving the demo they present */
  async function stop(confirmed = false) {
    setBusy(true);
    if (!confirmed) {
      // a demo this staff presents? ask first — Return takes them out of it
      try {
        const a = await demoModeClient.active();
        if (a.session && a.role === "presenter") {
          setLeaving({
            id: a.session.id,
            name: a.session.targetName,
            presenters: a.session.presenters.length,
          });
          setBusy(false);
          return;
        }
      } catch {
        // the demo side is away: nothing to leave
      }
    }
    try {
      // leave first: an account handed back with the demo still on would be sent to the stage again
      if (leaving) await demoModeClient.leave(leaving.id).catch(() => {});
      await adminClient.stopImpersonating();
      globalThis.location.href = "/admin";
    } catch {
      setBusy(false);
    }
  }

  return (
    <ImpersonationBannerView
      who={who}
      busy={busy}
      onStop={() => stop()}
      el={el}
      leaving={leaving}
      onLeave={() => stop(true)}
      onCancelLeave={() => setLeaving(null)}
    />
  );
}
