/**
 * Persistent "you are impersonating" banner. Mounted globally in _app.tsx.
 *
 * On mount it asks the backend (/admin/whoami) whether the current session is
 * an impersonation session. If so it pins a banner to the top of the viewport
 * naming who you're acting as, with a "Return to your account" control that
 * hits /admin/stop-impersonating (server swaps the cookie back) and reloads.
 *
 * Renders nothing for ordinary sessions, so it's safe to mount everywhere.
 */
import { useEffect, useState } from "preact/hooks";
import { adminClient, type WhoAmI } from "../clients/admin.ts";
import { fmtPhone } from "../lib/format.ts";

export default function ImpersonationBanner() {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!who?.impersonating) return null;

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
      role="status"
      style="position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 14px;background:#7a2e2e;color:#fff;font:inherit;font-size:13px;font-weight:600;box-shadow:0 1px 6px rgba(0,0,0,.25)"
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
