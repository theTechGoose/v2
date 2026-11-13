/**
 * REQ-806 — /ops: the approve-link door, its own endpoints. Nothing here signs anyone in or
 * touches /auth or /admin; an approved ask yields a read-only 30-minute view of one account.
 *
 *   POST /ops/requests                 { account, reason } → 200 { id, pollToken, expiresAt }
 *   GET  /ops/requests/:id             x-ops-poll: <pollToken> → { status, sessionId? (once) }
 *   GET  /ops/approvals/:token         → { account, reason, status, expiresAt, minutes }
 *   POST /ops/approvals/:token/approve → { status: "approved" }
 *   POST /ops/approvals/:token/deny    → { status: "denied" }
 */
import { Body, Context, Controller, Get, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { OpsAccess } from "@users/domain/coordinators/ops-access/mod.ts";

@Controller("ops")
export class OpsAccessController {
  constructor(private ops: OpsAccess) {}

  @Post("requests")
  async ask(@Body() body: unknown) {
    const b = (body ?? {}) as { account?: unknown; reason?: unknown };
    return await this.ops.ask({
      account: typeof b.account === "string" ? b.account : "",
      reason: typeof b.reason === "string" ? b.reason : "",
    });
  }

  @Get("requests/:id")
  async poll(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    return await this.ops.poll(id, ctx.req.header("x-ops-poll") ?? "");
  }

  @Get("approvals/:token")
  async describe(@Param("token") token: string) {
    return await this.ops.describe(token);
  }

  @Post("approvals/:token/approve")
  async approve(@Param("token") token: string) {
    return await this.ops.decide(token, "approve");
  }

  @Post("approvals/:token/deny")
  async deny(@Param("token") token: string) {
    return await this.ops.decide(token, "deny");
  }
}
