import { Body, Context, Controller, Delete, Get, Post, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import { WipeAccount } from "@users/domain/coordinators/wipe-account/mod.ts";
import { parseUpdateUser } from "@users/dto/user.ts";
import { requireUser, readSessionId, UnauthorizedError } from "@users/domain/coordinators/require-user/mod.ts";

/**
 * /me — endpoints that act on the currently-authenticated User.
 *
 * Every method calls requireUser() first; UnauthorizedError bubbles up and
 * (post-Danet-guard-wiring) maps to a 401 response.
 */
@Controller("me")
export class MeController {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
    private logoutCoord: Logout,
    private wipeCoord: WipeAccount,
  ) {}

  @Get()
  async me(@Context() ctx: ExecutionContext) {
    return await requireUser(ctx, this.sessions, this.users);
  }

  @Put()
  async update(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const patch = parseUpdateUser(body);
    return await this.users.update(user.id, patch);
  }

  /**
   * POST /me/onboarded — mark first-sign-in onboarding as finished (or
   * skipped). Body `{ skipped?: boolean }` (defaults to false = a real
   * finish). Idempotent: the first call stamps the server's now-ISO onto
   * `onboardedAt`; later calls are no-ops that keep the first timestamp, so
   * `/welcome` bounces to `/dashboard` forever after (skip is permanent).
   */
  @Post("onboarded")
  async onboarded(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const skipped = Boolean((body as { skipped?: unknown } | null)?.skipped);
    return await this.users.markOnboarded(user.id, skipped);
  }

  @Delete()
  async closeAccount(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const sessionId = readSessionId(ctx);
    if (!sessionId) throw new UnauthorizedError();
    await this.users.delete(user.id);
    await this.logoutCoord.run(sessionId);
    return { ok: true };
  }

  /**
   * GET /me/wipe — irreversibly delete the authenticated user and 100% of
   * their data (invoices, quotes, customers, paperwork, files, sessions, …).
   * Scoped entirely by the calling session's user; there is no way to wipe
   * anyone else. The user's sessions are part of the sweep, so this also logs
   * them out as a side effect.
   *
   * A GET (rather than DELETE) by request — it's hit straight from the
   * Settings "danger zone" button.
   */
  @Get("wipe")
  async wipe(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.wipeCoord.run(user.id);
  }
}
