import type { Presenter } from "#demo-mode/protocol.ts";

/** REQ-153 — a demo: staff (the presenters) guiding one user (the target, the viewer).
 *  REQ-214 — `presenters` lists everyone presenting, each with a name and a colour of their own;
 *  `presenterUserId` is the one who opened it (a demo written before the list has only that). */
export interface DemoSession {
  id: string;
  targetUserId: string;
  presenterUserId: string;
  presenters?: Presenter[];
  createdAt: string;
  endedAt?: string;
}
