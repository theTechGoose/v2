import {
  type Presenter,
  PRESENTER_COLORS,
  type Role,
} from "#demo-mode/protocol.ts";
import type { DemoSession } from "@demo-mode/dto/demo-session.ts";

/** REQ-214 — the demo's presenters; a demo written before the list has its opener, in the first colour */
export function presentersOf(
  demo: Pick<DemoSession, "presenterUserId" | "presenters">,
): Presenter[] {
  return demo.presenters ??
    [{ userId: demo.presenterUserId, name: "", color: PRESENTER_COLORS[0] }];
}

/**
 * REQ-214 — which presenter a session is in a demo, or null: a listed super admin impersonating
 * the target (the usual case — they see the user's own pages) or on their own session (still a
 * super admin — a demoted one is nobody). An ended demo has none. Pure.
 */
export function presenterIdFor(
  session: { userId: string; impersonatorId?: string },
  user: { superAdmin?: boolean },
  demo: DemoSession,
): string | null {
  if (demo.endedAt) return null;
  const listed = (id: string) =>
    presentersOf(demo).some((p) => p.userId === id);
  if (session.impersonatorId) {
    return listed(session.impersonatorId) &&
        session.userId === demo.targetUserId
      ? session.impersonatorId
      : null;
  }
  if (listed(session.userId)) {
    return user.superAdmin === true ? session.userId : null;
  }
  return null;
}

/**
 * REQ-153 — who a session is in a demo: a presenter (see `presenterIdFor`), the target user on
 * their OWN session (the viewer), or nobody — another admin impersonating included.
 */
export function roleFor(
  session: { userId: string; impersonatorId?: string },
  user: { superAdmin?: boolean },
  demo: DemoSession,
): Role | null {
  if (demo.endedAt) return null;
  if (presenterIdFor(session, user, demo)) return "presenter";
  if (session.impersonatorId) return null;
  if (session.userId === demo.targetUserId) return "viewer";
  return null;
}
