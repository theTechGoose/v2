import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type { Notification, NotificationType } from "@communication/dto/notification.ts";

const PREFIX = "notification";
const INDEX_PREFIX = "notification_by_user";    // [INDEX_PREFIX, userId, createdAt, id] → id

/**
 * NotificationStore — per-user, append-only-ish notification feed.
 *
 * Storage:
 *   ["notification", id]                                → Notification
 *   ["notification_by_user", userId, createdAt, id]     → id
 *
 * The composite key on the index lets `listByUser` scan in createdAt order
 * (descending for newest-first) without a separate sort step. createdAt
 * uses ISO format which sorts lexicographically — same trick as
 * agent-message-store.
 */
@Injectable()
export class NotificationStore {
  async create(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    entityType?: Notification["entityType"];
    entityId?: string;
  }): Promise<Notification> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const n: Notification = {
      id,
      userId: input.userId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      body: input.body,
      read: false,
      createdAt,
    };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], n)
      .set([INDEX_PREFIX, input.userId, createdAt, id], id)
      .commit();
    return n;
  }

  async get(id: string): Promise<Notification> {
    const kv = await getKv();
    const r = await kv.get<Notification>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Notification> {
    const n = await this.get(id);
    if (n.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return n;
  }

  async listByUser(userId: string, options: { limit?: number; unreadOnly?: boolean } = {}): Promise<Notification[]> {
    const kv = await getKv();
    const out: Notification[] = [];
    const cap = options.limit ?? 50;
    const iter = kv.list<string>({ prefix: [INDEX_PREFIX, userId] }, { reverse: true });    // newest-first
    for await (const e of iter) {
      const r = await kv.get<Notification>([PREFIX, e.value]);
      if (!r.value) continue;
      if (options.unreadOnly && r.value.read) continue;
      out.push(r.value);
      if (out.length >= cap) break;
    }
    return out;
  }

  async unreadCount(userId: string): Promise<number> {
    const items = await this.listByUser(userId, { unreadOnly: true, limit: 100 });
    return items.length;
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    const existing = await this.getOwned(id, userId);
    if (existing.read) return existing;
    const updated: Notification = { ...existing, read: true, readAt: new Date().toISOString() };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const unread = await this.listByUser(userId, { unreadOnly: true, limit: 1_000 });
    const now = new Date().toISOString();
    const kv = await getKv();
    const op = kv.atomic();
    for (const n of unread) {
      op.set([PREFIX, n.id], { ...n, read: true, readAt: now });
    }
    await op.commit();
    return { count: unread.length };
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_PREFIX, existing.userId, existing.createdAt, id])
      .commit();
  }
}
