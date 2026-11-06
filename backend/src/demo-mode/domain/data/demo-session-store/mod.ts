import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import {
  type Presenter,
  SESSION_TTL_MS,
  WHERE_TTL_MS,
} from "#demo-mode/protocol.ts";
import type { DemoSession } from "@demo-mode/dto/demo-session.ts";
import { presentersOf } from "@demo-mode/domain/business/demo-role/mod.ts";

const K = {
  session: (id: string) => ["demo-mode", "session", id] as const,
  /** the one demo a user is being shown — a new demo for the same user replaces it */
  active: (userId: string) => ["demo-mode", "active", userId] as const,
  /** the demo a super admin is presenting */
  presenting: (userId: string) => ["demo-mode", "presenting", userId] as const,
  /** the page a user's app last said it was on — kept WHERE_TTL_MS, so the presenter lands there at once */
  where: (userId: string) => ["demo-mode", "where", userId] as const,
};

/**
 * REQ-153 — demo sessions in KV. A demo lives two hours at most (every key expires with it);
 * `end` stamps it and drops the pointers so `active` says nothing at once.
 * REQ-214 — a demo has a LIST of presenters: `join` adds one (and points them at it), `leave`
 * takes one off; the list is written with a check, so two joins at once both land.
 */
@Injectable()
export class DemoSessionStore {
  async create(
    targetUserId: string,
    presenter: Presenter,
  ): Promise<DemoSession> {
    const kv = await getKv();
    const session: DemoSession = {
      id: crypto.randomUUID(),
      targetUserId,
      presenterUserId: presenter.userId,
      presenters: [presenter],
      createdAt: new Date().toISOString(),
    };
    await kv.atomic()
      .set(K.session(session.id), session, { expireIn: SESSION_TTL_MS })
      .set(K.active(targetUserId), session.id, { expireIn: SESSION_TTL_MS })
      .set(K.presenting(presenter.userId), session.id, {
        expireIn: SESSION_TTL_MS,
      })
      .commit();
    return session;
  }

  async get(id: string): Promise<DemoSession | null> {
    const kv = await getKv();
    return (await kv.get<DemoSession>(K.session(id))).value;
  }

  /** REQ-214 — another presenter on a live demo (already on it: unchanged); null when it is gone */
  async join(id: string, presenter: Presenter): Promise<DemoSession | null> {
    const kv = await getKv();
    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = await kv.get<DemoSession>(K.session(id));
      const session = entry.value;
      if (!session || session.endedAt) return null;
      const have = presentersOf(session);
      if (have.some((p) => p.userId === presenter.userId)) {
        return { ...session, presenters: have };
      }
      const next: DemoSession = {
        ...session,
        presenters: [...have, presenter],
      };
      const res = await kv.atomic()
        .check(entry)
        .set(K.session(id), next, { expireIn: SESSION_TTL_MS })
        .set(K.presenting(presenter.userId), id, { expireIn: SESSION_TTL_MS })
        .commit();
      if (res.ok) return next;
    }
    return null;
  }

  /** REQ-214 — a presenter off a demo; their pointer goes when it names this demo. The demo as it
   *  stands after (nobody left is the caller's cue to end it); null when it is gone */
  async leave(id: string, userId: string): Promise<DemoSession | null> {
    const kv = await getKv();
    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = await kv.get<DemoSession>(K.session(id));
      const session = entry.value;
      if (!session) return null;
      const next: DemoSession = {
        ...session,
        presenters: presentersOf(session).filter((p) => p.userId !== userId),
      };
      const op = kv.atomic()
        .check(entry)
        .set(K.session(id), next, { expireIn: SESSION_TTL_MS });
      if ((await kv.get<string>(K.presenting(userId))).value === id) {
        op.delete(K.presenting(userId));
      }
      if ((await op.commit()).ok) return next;
    }
    return null;
  }

  private async live(pointer: Deno.KvKey): Promise<DemoSession | null> {
    const kv = await getKv();
    const id = (await kv.get<string>(pointer)).value;
    if (!id) return null;
    const session = await this.get(id);
    return session && !session.endedAt ? session : null;
  }

  /** the demo being shown to `userId`, if one is on */
  activeFor(userId: string): Promise<DemoSession | null> {
    return this.live(K.active(userId));
  }

  /** the demo `userId` is presenting, if one is on */
  presentingBy(userId: string): Promise<DemoSession | null> {
    return this.live(K.presenting(userId));
  }

  /** AMENDMENT — same screen at once: the page `userId`'s own app is on, for the next WHERE_TTL_MS */
  async here(userId: string, path: string): Promise<void> {
    const kv = await getKv();
    await kv.set(K.where(userId), path, { expireIn: WHERE_TTL_MS });
  }

  /** where `userId`'s app last said it was, if within WHERE_TTL_MS */
  async whereIs(userId: string): Promise<string | null> {
    const kv = await getKv();
    return (await kv.get<string>(K.where(userId))).value;
  }

  /** stamp the end; the pointers go only when they still name this demo */
  async end(id: string): Promise<DemoSession | null> {
    const kv = await getKv();
    const session = await this.get(id);
    if (!session) return null;
    if (session.endedAt) return session;
    const ended: DemoSession = {
      ...session,
      endedAt: new Date().toISOString(),
    };
    const op = kv.atomic().set(K.session(id), ended, {
      expireIn: SESSION_TTL_MS,
    });
    if ((await kv.get<string>(K.active(session.targetUserId))).value === id) {
      op.delete(K.active(session.targetUserId));
    }
    for (const p of presentersOf(session)) {
      if ((await kv.get<string>(K.presenting(p.userId))).value === id) {
        op.delete(K.presenting(p.userId));
      }
    }
    await op.commit();
    return ended;
  }
}
