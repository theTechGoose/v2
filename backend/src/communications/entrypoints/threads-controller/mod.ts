/** REQ-899 — GET /communications/threads, GET /communications/threads/:peer */
import { Context, Controller, Get, Param } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { Threads } from "@communications/domain/coordinators/threads/mod.ts";

@Controller("communications/threads")
export class ThreadsController {
  constructor(private threads: Threads, private users: UserStore, private sessions: SessionStore) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    await requireUser(ctx, this.sessions, this.users);
    return await this.threads.list();
  }

  @Get(":peer")
  async get(@Context() ctx: ExecutionContext, @Param("peer") peer: string) {
    await requireUser(ctx, this.sessions, this.users);
    return await this.threads.get(decodeURIComponent(peer));
  }
}
