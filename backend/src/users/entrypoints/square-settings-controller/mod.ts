/**
 * REQ-803 — /me/square: the business's own Square connection.
 *   GET    → the status (never the token)
 *   PUT    { accessToken, locationId? } → checked with Square, sealed, stored; 422 with the
 *          reason otherwise; 409 stripe_connected while Stripe is connected (one at a time)
 *   DELETE → forgotten
 */
import { Body, Context, Controller, Delete, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import {
  ConnectSquare,
  SquareConnectError,
} from "@users/domain/coordinators/connect-square/mod.ts";

@Controller("me/square")
export class SquareSettingsController {
  constructor(
    private sessions: SessionStore,
    private users: UserStore,
    private square: ConnectSquare,
  ) {}

  @Get()
  async status(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.square.status(user.id));
  }

  @Put()
  async connect(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body && typeof body === "object" ? body : {}) as Record<
      string,
      unknown
    >;
    const token = typeof b.accessToken === "string" ? b.accessToken : "";
    const location = typeof b.locationId === "string" ? b.locationId : "";
    try {
      return ctx.json(await this.square.connect(user.id, token, location));
    } catch (e) {
      if (e instanceof SquareConnectError) {
        return ctx.json(
          { error: e.code, message: e.message },
          e.status === 503 ? 503 : e.status === 409 ? 409 : 422,
        );
      }
      throw e;
    }
  }

  @Delete()
  async disconnect(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.square.disconnect(user.id));
  }
}
