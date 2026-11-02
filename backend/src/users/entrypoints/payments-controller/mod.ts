import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";

/**
 * REQ-133 — /payments: what the CRM tells this app, service to service. Raphael, 2026-11-02:
 * "The front end should not be doing any business logic, only presentation logic. Put all of
 * that in the back." The CRM posts a charge's settlement by a deferred job after the payer is
 * answered; when that job lands it tells this app the due settled (`POST /payments/due-settled`),
 * so the watch on that due (REQ-131) looks at once and the plan is active the moment the money is
 * — no page presses anything, no minute waited. Gated by `PPWK_SETTLED_TOKEN` (constant-time
 * compared to the bearer token; unset → hard-closed in dev and prod alike). A due no watch names
 * is acknowledged and nothing is looked at; the sweep's minute covers a notice that never comes.
 */
@Controller("payments")
export class PaymentsController {
  constructor(private leads: CrmLeadCapture) {}

  @Post("due-settled")
  async dueSettled(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const expected = Deno.env.get("PPWK_SETTLED_TOKEN") ?? "";
    const presented = (ctx.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!expected || !presented || !constantTimeEqual(expected, presented)) {
      throw Object.assign(new Error("forbidden: the settled token did not match"), { status: 403 });
    }
    const dueId = (body as { dueId?: unknown } | null)?.dueId;
    if (typeof dueId !== "string" || !dueId.trim()) {
      throw Object.assign(new Error("due-required: body.dueId names the due that settled"), { status: 400 });
    }
    const looked = await this.leads.lookNow(dueId.trim());
    return { ok: true as const, looked };
  }
}

/** length-checked constant-time string comparison */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}
