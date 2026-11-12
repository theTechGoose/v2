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
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { adminClient, type WhoAmI } from "../clients/admin.ts";
import { demoModeClient } from "../clients/demo-mode.ts";
import { clearBannerRoom, setBannerRoom } from "../lib/banner-room.ts";
import { ImpersonationBannerView } from "../components/ImpersonationBannerView.tsx";

export default function ImpersonationBanner() {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [busy, setBusy] = useState(false);
  /** REQ-232 — the demo this staff presents, while the banner asks whether to leave it */
  /** REQ-298 — `presenters`: how many present; alone, leaving ends the demo for the customer */
  const [leaving, setLeaving] = useState<
    { id: string; name: string; presenters: number } | null
  >(null);
  const el = useRef<HTMLDivElement>(null);
  const shown = Boolean(who?.impersonating);

  useEffect(() => {
    let alive = true;
    adminClient.whoami()
      .then((w) => {
        if (alive) setWho(w);
      })
      .catch(() => {/* not logged in / backend down — show nothing */});
    return () => {
      alive = false;
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
