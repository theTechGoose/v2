/**
 * REQ-214 — who is presenting: a chip per presenter with their colour dot and name; the
 * caller's own chip says so. Drawn in the customer's pill and on every stage.
 */
import { t } from "../../lib/i18n.ts";
import type { Presenter } from "../../../shared/demo-mode/protocol.ts";

export default function PresenterChips(
  { presenters, me, nowrap }: {
    presenters: Presenter[];
    me?: string | null;
    /** REQ-228 — on one line (the customer's pill never grows over the page) */
    nowrap?: boolean;
  },
) {
  return (
    <span
      style={`display:inline-flex;gap:6px;flex-wrap:${
        nowrap ? "nowrap" : "wrap"
      };align-items:center`}
    >
      {presenters.map((p) => (
        <span
          key={p.userId}
          data-cy="demo-presenter"
          data-pid={p.userId}
          data-color={p.color}
          style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px 2px 6px;border-radius:999px;background:rgba(255,255,255,.14);font-size:11.5px;font-weight:700;white-space:nowrap"
        >
          <span
            aria-hidden="true"
            style={`width:10px;height:10px;border-radius:50%;background:${p.color};box-shadow:0 0 0 2px rgba(255,255,255,.85)`}
          />
          {p.name}
          {me && p.userId === me ? ` (${t("demoMode.you")})` : ""}
        </span>
      ))}
    </span>
  );
}
