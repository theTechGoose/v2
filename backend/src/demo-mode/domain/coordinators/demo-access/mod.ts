import { Injectable } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import {
  type Session,
  SessionStore,
} from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import {
  readSessionId,
  UnauthorizedError,
} from "@users/domain/coordinators/require-user/mod.ts";
import type { User } from "@users/dto/user.ts";
import type { Role } from "#demo-mode/protocol.ts";
import { roleFor } from "@demo-mode/domain/business/demo-role/mod.ts";
import { DemoSessionStore } from "@demo-mode/domain/data/demo-session-store/mod.ts";
import type { DemoSession } from "@demo-mode/dto/demo-session.ts";

export class DemoNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("demo_not_found");
    this.name = "DemoNotFoundError";
  }
}
export class DemoForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super("not_in_this_demo");
    this.name = "DemoForbiddenError";
  }
}

export interface Caller {
  session: Session;
  user: User;
}

/**
 * REQ-153 — who is calling, and what they are in a demo. The session comes from the header or
 * the cookie as everywhere (`readSessionId`), or — for the socket, whose browser API cannot set
 * a header and whose non-browser clients have no cookie — from the `token` query parameter.
 */
@Injectable()
export class DemoAccess {
  constructor(
    private sessions: SessionStore,
    private users: UserStore,
    private demos: DemoSessionStore,
  ) {}

  async caller(ctx: ExecutionContext, token?: string | null): Promise<Caller> {
    const sessionId = readSessionId(ctx) ?? token ?? null;
    if (!sessionId) throw new UnauthorizedError();
    const session = await this.sessions.get(sessionId);
    if (!session) throw new UnauthorizedError();
    let user: User;
    try {
      user = await this.users.get(session.userId);
    } catch {
      throw new UnauthorizedError();
    }
    if (user.deletedAt) throw new UnauthorizedError();
    return { session, user };
  }

  /** the demo `id` and the caller's role in it; 404 when there is no such demo, 403 when they are nobody in it */
  async roleIn(
    caller: Caller,
    id: string,
    opts: { evenEnded?: boolean } = {},
  ): Promise<{ demo: DemoSession; role: Role }> {
    const demo = await this.demos.get(id);
    if (!demo) throw new DemoNotFoundError();
    const role = roleFor(
      caller.session,
      caller.user,
      opts.evenEnded ? { ...demo, endedAt: undefined } : demo,
    );
    if (!role) throw new DemoForbiddenError();
    return { demo, role };
  }

  /** the live demo the caller is in, as presenter (own or impersonation session) or viewer */
  async current(
    caller: Caller,
  ): Promise<{ demo: DemoSession; role: Role } | null> {
    const { session, user } = caller;
    const candidates = session.impersonatorId
      ? [await this.demos.presentingBy(session.impersonatorId)]
      : [
        await this.demos.activeFor(user.id),
        await this.demos.presentingBy(user.id),
      ];
    for (const demo of candidates) {
      if (!demo) continue;
      const role = roleFor(session, user, demo);
      if (role) return { demo, role };
    }
    return null;
  }
}
