/**
 * REQ-376 (demo-loop cycle 2, issues m20 + nc-second-demo) — /admin while this browser guides a
 * customer. Impersonation is browser-wide (placePresenter → adminClient.impersonate swaps the
 * session cookie), so a second staff tab on /admin resolves the CUSTOMER as its user. The gate
 * used to bounce that to the customer's /dashboard with no word; it now renders an interstitial
 * (components/AdminGuideGate.tsx) from what this module reads:
 *
 *   - `adminGateFor` (pure): whoami + /demo-mode/active → whom this browser is guiding, the demo to
 *     go back to (null when the impersonation is not a demo) and the PRESENTER's language (REQ-341:
 *     under impersonation the resolved user is the customer). null when it is no impersonation.
 *   - `adminGateForRequest`: the same, asked of the backend in process with the request's session
 *     (like lib/presenter-lang.ts). A failed whoami is null — the plain /dashboard redirect stands.
 */
import { getSessionId } from "./auth.ts";
import { ssrBackendGetAuthed } from "./backend-fetch.ts";
import type { Lang } from "./i18n.ts";
import { customerLabel } from "./admin-console.ts";
import { presenterLang } from "./presenter-lang.ts";
import type { WhoAmI } from "../clients/admin.ts";
import type { DemoActive } from "../clients/demo-mode.ts";

export interface AdminGate {
  /** whom this browser acts as: a real name, else the business, else the phone */
  customer: string;
  /** the demo this staff presents (Back to the demo), null for a plain impersonation */
  demoId: string | null;
  /** how many present that demo (REQ-298: alone, leaving ends it for the customer) */
  presenters: number;
  /** the presenter's own language */
  lang: Lang;
}

export function adminGateFor(
  who: WhoAmI | null | undefined,
  active: DemoActive | null | undefined,
): AdminGate | null {
  if (!who?.authenticated || who.impersonating !== true) return null;
  const demo = active?.role === "presenter" && active.session
    ? active.session
    : null;
  return {
    customer: customerLabel(who.user) || demo?.targetName || "",
    demoId: demo?.id ?? null,
    presenters: demo ? Math.max(demo.presenters?.length ?? 0, 1) : 0,
    lang: presenterLang(who, undefined),
  };
}

export async function adminGateForRequest(
  req: Request,
): Promise<AdminGate | null> {
  const sessionId = getSessionId(req);
  if (!sessionId) return null;
  try {
    const who = await ssrBackendGetAuthed<WhoAmI>("/admin/whoami", sessionId);
    if (!who.ok || !who.data?.impersonating) return null;
    const active = await ssrBackendGetAuthed<DemoActive>(
      "/demo-mode/active",
      sessionId,
    ).catch(() => null);
    return adminGateFor(who.data, active?.ok ? active.data : null);
  } catch {
    return null;
  }
}
