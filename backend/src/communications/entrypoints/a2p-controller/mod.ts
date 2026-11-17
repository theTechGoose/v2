/**
 * REQ-920a — texting registration (A2P 10DLC) for the signed-in user's line.
 *   GET  /communications/a2p           { registration } (null when never started)
 *   POST /communications/a2p           the form → the walk as far as Twilio lets it (400 a2p_invalid names the fields)
 *   POST /communications/a2p/refresh   Twilio's statuses read again; the walk carried on
 * 409 no_line without a line; 409 a2p_house_line for the platform's own line.
 */
import { Body, Context, Controller, Get, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { parseA2pForm } from "@communications/domain/business/a2p/mod.ts";
import { A2pRegistrations } from "@communications/domain/coordinators/a2p-registration/mod.ts";

@Controller("communications/a2p")
export class A2pController {
  constructor(
    private a2p: A2pRegistrations,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return { registration: await this.a2p.get(user.id) };
  }

  @Post()
  async start(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.a2p.start(user.id, parseA2pForm(body));
  }

  @Post("refresh")
  async refresh(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.a2p.refresh(user.id);
  }
}
