/**
 * REQ-229 (demo issues test-setup-claims-pixel-staff-registration, demo-lifecycle-m4) — the
 * CompleteRegistration /welcome renders, decided from WHO the session is, not just which account
 * it shows: GET /admin/whoami (in process, like the page's profile read) says whether the session
 * is a super admin's or an impersonation, and shared/meta-pixel/pixel.ts registrationEventFor
 * turns that into the event or null. A whoami that fails is null — fail closed.
 */
import { getSessionId } from "./auth.ts";
import { ssrBackendGetAuthed } from "./backend-fetch.ts";
import {
  type PixelEvent,
  type PixelSession,
  registrationEventFor,
} from "../../shared/meta-pixel/pixel.ts";

export async function registrationForRequest(
  req: Request,
): Promise<PixelEvent | null> {
  const sessionId = getSessionId(req);
  if (!sessionId) return null;
  try {
    const res = await ssrBackendGetAuthed<PixelSession>(
      "/admin/whoami",
      sessionId,
    );
    return res.ok ? registrationEventFor(res.data) : null;
  } catch {
    return null;
  }
}
