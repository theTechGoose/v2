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
 * REQ-187 — inside the stage's replica frame it renders nothing: the customer has no banner.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { adminClient, type WhoAmI } from "../clients/admin.ts";
import { clearBannerRoom, setBannerRoom } from "../lib/banner-room.ts";
import { isReplicaFrame } from "../lib/demo-mode/replica.ts";
import { ImpersonationBannerView } from "../components/ImpersonationBannerView.tsx";

export default function ImpersonationBanner() {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [busy, setBusy] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const replica = isReplicaFrame();
  const shown = Boolean(who?.impersonating) && !replica;

  useEffect(() => {
    if (replica) return;
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

  async function stop() {
    setBusy(true);
    try {
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
      onStop={stop}
      el={el}
    />
  );
}
