/**
 * REQ-376 (demo-loop cycle 2, m20 + nc-second-demo) — /admin's interstitial "Return to your
 * account": leaves the demo this staff presents (if any), hands the account back, lands on the
 * console — where Demo is reachable again. The page around it already says what leaving does.
 */
import { useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { returnToOwnAccount } from "../lib/return-to-account.ts";

export default function AdminGateReturn(
  { lang, demoId, primary }: {
    lang: Lang;
    demoId: string | null;
    primary: boolean;
  },
) {
  const [busy, setBusy] = useState(false);
  const style = primary
    ? "padding:10px 18px;border-radius:10px;border:0;background:#2f6d29;color:#fff;cursor:pointer;font:inherit;font-weight:700"
    : "padding:10px 18px;border-radius:10px;border:1px solid #2f6d29;background:#fff;color:#2f6d29;cursor:pointer;font:inherit;font-weight:700";
  return (
    <button
      type="button"
      data-cy="admin-gate-return"
      disabled={busy}
      style={style}
      onClick={async () => {
        setBusy(true);
        try {
          await returnToOwnAccount(demoId);
        } catch {
          setBusy(false);
        }
      }}
    >
      {busy
        ? tFor(lang, "impersonation.returning")
        : tFor(lang, "impersonation.return")}
    </button>
  );
}
