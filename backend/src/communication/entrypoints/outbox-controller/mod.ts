import { Context, Controller, Get, Param, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { OutboxStore } from "@communication/domain/data/outbox-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

/**
 * OutboxController — REQ-784 (demo-loop cycle dv1, issue d12; Raphael: "And
 * yes to a sent message outbox."). Every email and text the business sent,
 * or tried to send, to a customer:
 *
 *   GET /outbox?limit=   the signed-in account's entries, newest first,
 *                        without bodies (the /messages list)
 *   GET /outbox/:id      one entry with its content exactly as sent
 *
 * Scoped to the account `requireUser` resolves; another account's entry is
 * refused by the store (403).
 */
@Controller("outbox")
export class OutboxController {
  constructor(
    private store: OutboxStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async list(
    @Context() ctx: ExecutionContext,
    @Query("limit") limit?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const n = Number(limit);
    return await this.store.listByUser(
      user.id,
      Number.isFinite(n) && n > 0 ? { limit: n } : {},
    );
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
  }
}
