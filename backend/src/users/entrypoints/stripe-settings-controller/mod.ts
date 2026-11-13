/**
 * REQ-212 — /me/stripe: the business's own Stripe connection.
 *   GET    → the status (never the secret)
 *   PUT    { publishableKey, secretKey } → checked, sealed, stored; 422 with the reason otherwise
 *          (REQ-803: 409 square_connected while the business's Square is connected)
 *   DELETE → forgotten
 */
import { Body, Context, Controller, Delete, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsString } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import {
  ConnectStripe,
  StripeConnectError,
} from "@users/domain/coordinators/connect-stripe/mod.ts";

class ConnectStripeDto {
  @IsString()
  publishableKey!: string;
  @IsString()
  secretKey!: string;
}

@Controller("me/stripe")
export class StripeSettingsController {
  constructor(
    private sessions: SessionStore,
    private users: UserStore,
    private stripe: ConnectStripe,
  ) {}

  @Get()
  async status(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.stripe.status(user.id));
  }

  @Put()
  async connect(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = plainToInstance(ConnectStripeDto, body ?? {});
    const pk = typeof dto.publishableKey === "string" ? dto.publishableKey : "";
    const sk = typeof dto.secretKey === "string" ? dto.secretKey : "";
    try {
      return ctx.json(await this.stripe.connect(user.id, pk, sk));
    } catch (e) {
      if (e instanceof StripeConnectError) {
        return ctx.json(
          { error: e.code, message: e.message },
          e.status === 503 ? 503 : e.status === 409 ? 409 : 422, // REQ-803: 409 square_connected
        );
      }
      throw e;
    }
  }

  @Delete()
  async disconnect(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.stripe.disconnect(user.id));
  }
}
