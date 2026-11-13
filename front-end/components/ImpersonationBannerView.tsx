import type { Ref } from "preact";
import type { WhoAmI } from "../clients/admin.ts";
import { fmtPhone } from "../lib/format.ts";
import { staffBarT } from "../lib/staff-bar-t.ts";
import { returnAskText } from "../../shared/demo-mode/restart.ts";

/**
 * REQ-269 (demo i18n-formatting-m2) — the bar itself, in the app language: its copy comes
 * from the dictionaries (`impersonation.*`) through t(), so it follows langSignal like the
 * page under it instead of staying English on a Spanish screen.
 *
 * REQ-723 (demo-loop cycle 5, p18-7d) — but in the STAFF member's language, not the impersonated
 * customer's: the bar is staff chrome (like REQ-544's demo pill), so its t is `staffBarT(who)`
 * (whoami's `impersonator.language`, the live app language only when the staff has none).
 */
export function ImpersonationBannerView(
  { who, busy, onStop, el, leaving, onLeave, onCancelLeave }: {
    who: WhoAmI;
    busy: boolean;
    onStop: () => void;
    el?: Ref<HTMLDivElement>;
    /** REQ-232 (M21) — the demo this staff presents, while the bar asks whether to leave it;
     *  REQ-298 — `presenters`: how many present (alone, the question says leaving ends it) */
    leaving?: { id: string; name: string; presenters: number } | null;
    onLeave?: () => void;
    onCancelLeave?: () => void;
  },
) {
  const btn =
    "padding:5px 12px;border-radius:8px;border:0;background:#fff;color:#7a2e2e;cursor:pointer;font:inherit;font-weight:700";
  const t = staffBarT(who);
  const acting = who.user;
  const actingLabel = acting
    ? (acting.name || acting.businessName || fmtPhone(acting.phoneNumber))
    : t("impersonation.anotherUser");

  // REQ-298 — alone on the demo, leaving ends it for the customer: the question says so
  const ask = leaving ? returnAskText(leaving.presenters, leaving.name) : null;

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
        {t("impersonation.acting")} <strong>{actingLabel}</strong>
        {who.impersonator?.name
          ? ` ${t("impersonation.as", { name: who.impersonator.name })}`
          : ""}
      </span>
      {leaving && ask
        ? (
          <>
            <span data-cy="imp-leave-ask">{t(ask.key, ask.vars)}</span>
            <button
              type="button"
              data-cy="imp-leave-demo"
              onClick={onLeave}
              disabled={busy}
              style={btn}
            >
              {busy ? t("impersonation.returning") : t("demoMode.leave")}
            </button>
            <button
              type="button"
              data-cy="imp-leave-cancel"
              onClick={onCancelLeave}
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
            onClick={onStop}
            disabled={busy}
            style={btn}
          >
            {busy ? t("impersonation.returning") : t("impersonation.return")}
          </button>
        )}
    </div>
  );
}
