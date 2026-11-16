/**
 * REQ-232 (M21) / REQ-376 — hand a staff's own account back to this browser: leave the demo they
 * present first (an account handed back with the demo still on would be sent to the stage again —
 * the demo ends when the last presenter leaves), then stop impersonating (the server swaps the
 * cookie back), then the admin console — the order the impersonation banner's stop() keeps
 * (pinned there by REQ-232). Used by /admin's interstitial (components/AdminGuideGate.tsx). Throws when the account could not be handed back.
 * REQ-855 (demo-loop cycle dm3, rc-17) — `lang`: the console opens in it (`?lang=`, REQ-829), the
 * language the presenter was reading the gate in.
 */
import { adminClient } from "../clients/admin.ts";
import { demoModeClient } from "../clients/demo-mode.ts";
import { ADMIN_PATH, withLang } from "../../shared/demo-mode/ended.ts";

export async function returnToOwnAccount(
  leaveDemoId: string | null | undefined,
  lang?: string | null,
): Promise<void> {
  if (leaveDemoId) await demoModeClient.leave(leaveDemoId).catch(() => {});
  await adminClient.stopImpersonating();
  globalThis.location.href = withLang(ADMIN_PATH, lang);
}
