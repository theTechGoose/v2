/**
 * REQ-146 — /me/admins: the phone numbers the owner lets into the account.
 * Reading is for anyone in the account; inviting and removing are the owner's
 * alone (an acting admin gets 403 `acting_as_admin`).
 */
import { Body, Context, Controller, Delete, Get, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireOwner, requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { AccountAdmins } from "@users/domain/coordinators/account-admins/mod.ts";

@Controller("me/admins")
export class AdminsController {
  constructor(private admins: AccountAdmins, private users: UserStore, private sessions: SessionStore) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.admins.list(user);
  }

  /** `{ phoneNumber, name }` → 201 the record; the text goes out to the number. REQ-632: the name is required — missing, blank or the sign-up placeholder is 400 `name_required` */
  @Post()
  async invite(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const owner = await requireOwner(ctx, this.sessions, this.users);
    const b = (body && typeof body === "object" ? body : {}) as { phoneNumber?: unknown; name?: unknown };
    const rec = await this.admins.invite(owner, b);
    return ctx.json(rec, 201);
  }

  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const owner = await requireOwner(ctx, this.sessions, this.users);
    await this.admins.remove(owner, id);
    return { ok: true };
  }
}
