import { Context, Controller, Delete, Get, Param, Post, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import { NotifyOnEvent } from "@communication/domain/coordinators/notify-on-event/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

@Controller("notifications")
export class NotificationController {
  // The NotifyOnEvent dep isn't used by methods below — it's listed so Danet
  // eagerly constructs it on first request (which triggers its EventBus
  // subscription in the constructor). Without this dep edge, the listener
  // would never wire up because nothing else depends on it.
  constructor(
    private store: NotificationStore,
    _eagerNotifier: NotifyOnEvent,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /**
   * GET /notifications[?limit=&unreadOnly=true]
   * Newest-first. Default limit 50.
   * Powers the topbar `ActivityTicker` (poll) + the dashboard "What we handled today" panel.
   */
  @Get()
  async list(
    @Context() ctx: ExecutionContext,
    @Query("limit") limit?: string,
    @Query("unreadOnly") unreadOnly?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const cap = limit ? Math.min(200, Math.max(1, Number(limit) | 0)) : 50;
    const onlyUnread = unreadOnly === "true";
    return await this.store.listByUser(user.id, { limit: cap, unreadOnly: onlyUnread });
  }

  /** GET /notifications/unread-count — drives the bell's red dot. */
  @Get("unread-count")
  async unreadCount(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return { count: await this.store.unreadCount(user.id) };
  }

  /** POST /notifications/:id/read — toggle a single notification to read. */
  @Post(":id/read")
  async markRead(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.markRead(id, user.id);
  }

  /** POST /notifications/read-all — clear the bell badge in one shot. */
  @Post("read-all")
  async markAllRead(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.markAllRead(user.id);
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
