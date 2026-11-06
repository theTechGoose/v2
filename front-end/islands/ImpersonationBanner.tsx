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
 * REQ-184 — it makes room for itself: it sits in the page's flow (sticky at the top, never over the
 * content) and publishes its height as --pm-banner-h, which the dashboard shell, its mobile top bar
 * and the mobile sidebar drawer subtract or start below — the staff never loses the top of the
 * customer's page under the red bar.
 *
 * REQ-187 — inside the stage's replica frame it renders nothing: the customer has no banner.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { adminClient, type WhoAmI } from "../clients/admin.ts";
import { fmtPhone } from "../lib/format.ts";
import { isReplicaFrame } from "../lib/demo-mode/replica.ts";

export default function ImpersonationBanner() {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty("--pm-banner-h", `${el.offsetHeight}px`);
    publish();
    const ro = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(publish);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--pm-banner-h");
    };
  }, [shown]);

  if (!shown || !who) return null;

  const acting = who.user;
  const actingLabel = acting
    ? (acting.name || acting.businessName || fmtPhone(acting.phoneNumber))
    : "another user";

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
    <div
      ref={ref}
      // REQ-153 — demo mode's pointer paths never count this banner (the staff side alone has it)
      data-demo-skip
      role="status"
      style="position:sticky;top:0;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 14px;background:#7a2e2e;color:#fff;font:inherit;font-size:13px;font-weight:600;box-shadow:0 1px 6px rgba(0,0,0,.25)"
    >
      <span>
        Impersonating <strong>{actingLabel}</strong>
        {who.impersonator?.name ? ` (as ${who.impersonator.name})` : ""}
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        style="padding:5px 12px;border-radius:8px;border:0;background:#fff;color:#7a2e2e;cursor:pointer;font:inherit;font-weight:700"
      >
        {busy ? "Returning…" : "Return to your account"}
      </button>
    </div>
  );
}
