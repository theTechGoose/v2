import type { Role } from "#demo-mode/protocol.ts";
import type { DemoSession } from "@demo-mode/dto/demo-session.ts";

/**
 * REQ-153 — who a session is in a demo. The demo's super admin presents, impersonating the
 * target (the usual case — they see the user's own pages) or on their own session (still a
 * super admin — a demoted one is nobody); the target user on their OWN session views; anyone
 * else, another admin impersonating included, is nobody. An ended demo has no roles. Pure.
 */
export function roleFor(
  session: { userId: string; impersonatorId?: string },
  user: { superAdmin?: boolean },
  demo: DemoSession,
): Role | null {
  if (demo.endedAt) return null;
  if (session.impersonatorId) {
    return session.impersonatorId === demo.presenterUserId &&
        session.userId === demo.targetUserId
      ? "presenter"
      : null;
  }
  if (session.userId === demo.presenterUserId) {
    return user.superAdmin === true ? "presenter" : null;
  }
  if (session.userId === demo.targetUserId) return "viewer";
  return null;
}
