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
import { t } from "../lib/i18n.ts";
import { fmtPhone } from "../lib/format.ts";
import { clearBannerRoom, setBannerRoom } from "../lib/banner-room.ts";

export default function ImpersonationBanner() {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [busy, setBusy] = useState(false);
  /** REQ-232 — the demo this staff presents, while the banner asks whether to leave it */
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(
    null,
  );
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

  const acting = who.user;
  const actingLabel = acting
    ? (acting.name || acting.businessName || fmtPhone(acting.phoneNumber))
    : "another user";

  /** REQ-232 (M21) — `confirmed`: the staff said yes to leaving the demo they present */
  async function stop(confirmed = false) {
    setBusy(true);
    if (!confirmed) {
      // a demo this staff presents? ask first — Return takes them out of it
      try {
        const a = await demoModeClient.active();
        if (a.session && a.role === "presenter") {
          setLeaving({ id: a.session.id, name: a.session.targetName });
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

  const btn =
    "padding:5px 12px;border-radius:8px;border:0;background:#fff;color:#7a2e2e;cursor:pointer;font:inherit;font-weight:700";

  return (
    <div
      ref={el}
      // REQ-153 — demo mode's pointer paths never count this banner (the staff side alone has it)
      data-demo-skip
      role="status"
      data-cy="imp-banner"
      style="position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 14px;background:#7a2e2e;color:#fff;font:inherit;font-size:13px;font-weight:600;box-shadow:0 1px 6px rgba(0,0,0,.25)"
    >
      <span>
        Impersonating <strong>{actingLabel}</strong>
        {who.impersonator?.name ? ` (as ${who.impersonator.name})` : ""}
      </span>
      {leaving
        ? (
          <>
            <span>{t("demoMode.returnAsk", { name: leaving.name })}</span>
            <button
              type="button"
              data-cy="imp-leave-demo"
              onClick={() => stop(true)}
              disabled={busy}
              style={btn}
            >
              {busy ? "Returning…" : t("demoMode.leave")}
            </button>
            <button
              type="button"
              data-cy="imp-leave-cancel"
              onClick={() => setLeaving(null)}
              disabled={busy}
              style="padding:5px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.7);background:transparent;color:#fff;cursor:pointer;font:inherit;font-weight:700"
            >
              {t("common.cancel")}
            </button>
          </>
        )
        : (
          <button
            type="button"
            onClick={() => stop()}
            disabled={busy}
            style={btn}
          >
            {busy ? "Returning…" : "Return to your account"}
          </button>
        )}
    </div>
  );
}
