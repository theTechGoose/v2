/** REQ-153 — a demo: a super admin (the presenter) guiding one user (the target, the viewer). */
export interface DemoSession {
  id: string;
  targetUserId: string;
  presenterUserId: string;
  createdAt: string;
  endedAt?: string;
}
