/**
 * REQ-153 — HTTP client for demo mode.
 *
 * Backend reference: demo-mode/entrypoints/demo-mode-controller/mod.ts
 *   POST /demo-mode/sessions { userId }   → { id, targetUserId, targetPath, createdAt }   (super-admin)
 *   GET  /demo-mode/active?path=/x        → DemoActive                        (any session; `path` = where this app is)
 *   POST /demo-mode/sessions/:id/end      → { ok: true }                      (a participant)
 * The socket is lib/demo-mode/transport.ts.
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { Role } from "../../shared/demo-mode/protocol.ts";

export interface DemoActive {
  role: Role | null;
  session: {
    id: string;
    presenterName: string;
    targetName: string;
    targetUserId: string;
  } | null;
  /** the presenter only: where the customer's app last said it was (within 20 s), else null */
  targetPath: string | null;
}

export interface DemoStarted {
  id: string;
  targetUserId: string;
  /** where the customer's app last said it was (within 20 s), else null */
  targetPath: string | null;
  createdAt: string;
}

/** REQ-179 — the tab's own signal that Demo was just CLICKED on /admin: `detail` is
 *  `{ targetUserId, targetName }`; the overlay shows "Opening…" before the server answers */
export const DEMO_OPENING_EVENT = "pm:demo-opening";
/** the tab's own signal that /admin opened a demo: `detail` is the DemoStarted plus `targetName`
 *  (the overlay takes it straight, no second ask); no detail → the overlay asks the server */
export const DEMO_STARTED_EVENT = "pm:demo-started";

export const demoModeClient = {
  start: (userId: string, opts: ApiOptions = {}) =>
    api.post<DemoStarted>("/demo-mode/sessions", { userId }, opts),
  /** `path`: where this app is right now — the server keeps it 20 s so the presenter lands there at once */
  active: ({ path, ...opts }: ApiOptions & { path?: string } = {}) =>
    api.get<DemoActive>(
      path
        ? `/demo-mode/active?path=${encodeURIComponent(path)}`
        : "/demo-mode/active",
      opts,
    ),
  end: (id: string, reason?: "declined", opts: ApiOptions = {}) =>
    api.post<{ ok: true }>(
      `/demo-mode/sessions/${id}/end`,
      reason ? { reason } : undefined,
      opts,
    ),
};
