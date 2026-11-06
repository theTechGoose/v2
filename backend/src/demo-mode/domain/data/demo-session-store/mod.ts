import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { SESSION_TTL_MS, WHERE_TTL_MS } from "#demo-mode/protocol.ts";
import type { DemoSession } from "@demo-mode/dto/demo-session.ts";

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
 * `end` stamps it and drops the two pointers so `active` says nothing at once.
 */
@Injectable()
export class DemoSessionStore {
  async create(
    targetUserId: string,
    presenterUserId: string,
  ): Promise<DemoSession> {
    const kv = await getKv();
    const session: DemoSession = {
      id: crypto.randomUUID(),
      targetUserId,
      presenterUserId,
      createdAt: new Date().toISOString(),
    };
    await kv.atomic()
      .set(K.session(session.id), session, { expireIn: SESSION_TTL_MS })
      .set(K.active(targetUserId), session.id, { expireIn: SESSION_TTL_MS })
      .set(K.presenting(presenterUserId), session.id, {
        expireIn: SESSION_TTL_MS,
      })
      .commit();
    return session;
  }

  async get(id: string): Promise<DemoSession | null> {
    const kv = await getKv();
    return (await kv.get<DemoSession>(K.session(id))).value;
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
    if (
      (await kv.get<string>(K.presenting(session.presenterUserId))).value === id
    ) op.delete(K.presenting(session.presenterUserId));
    await op.commit();
    return ended;
  }
}
