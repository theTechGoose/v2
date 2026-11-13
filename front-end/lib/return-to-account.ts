/**
 * REQ-232 (M21) / REQ-376 — hand a staff's own account back to this browser: leave the demo they
 * present first (an account handed back with the demo still on would be sent to the stage again —
 * the demo ends when the last presenter leaves), then stop impersonating (the server swaps the
 * cookie back), then the admin console — the order the impersonation banner's stop() keeps
 * (pinned there by REQ-232). Used by /admin's interstitial (components/AdminGuideGate.tsx). Throws when the account could not be handed back.
 */
import { adminClient } from "../clients/admin.ts";
import { demoModeClient } from "../clients/demo-mode.ts";

export async function returnToOwnAccount(
  leaveDemoId: string | null | undefined,
): Promise<void> {
  if (leaveDemoId) await demoModeClient.leave(leaveDemoId).catch(() => {});
  await adminClient.stopImpersonating();
  globalThis.location.href = "/admin";
}
