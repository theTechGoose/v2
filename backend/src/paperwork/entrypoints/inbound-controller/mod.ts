/**
 * REQ-175 — Postmark's inbound webhook: a customer's reply to a paperwork
 * email (sent with Reply-To reply+<token>@<inbound domain>) lands in the
 * contractor's Messages, in that customer's thread.
 *
 *   POST /inbound/postmark   (public — Postmark calls it; no session)
 *
 * When POSTMARK_INBOUND_TOKEN is set the call must carry it, as `?token=`
 * on the webhook URL or as the password of the URL's basic auth; an unknown
 * reply token is refused with 404 so nothing ever lands in the wrong thread.
 */
import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { ReplyTokenStore } from "@paperwork/domain/data/reply-token-store/mod.ts";
import { parseInboundReply } from "@paperwork/domain/business/inbound-reply/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";

function webhookAuthorized(ctx: ExecutionContext): boolean {
  const expected = Deno.env.get("POSTMARK_INBOUND_TOKEN")?.trim();
  if (!expected) return true;
  const url = new URL(ctx.req.url);
  if (url.searchParams.get("token") === expected) return true;
  const auth = ctx.req.header("authorization") ?? "";
  if (auth.startsWith("Basic ")) {
    try {
      const [, pass] = atob(auth.slice(6)).split(":");
      if (pass === expected) return true;
    } catch { /* not base64 */ }
  }
  return false;
}

@Controller("inbound")
export class InboundController {
  constructor(
    private tokens: ReplyTokenStore,
    private log: LogPaperworkMessage,
  ) {}

  @Post("postmark")
  async postmark(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    if (!webhookAuthorized(ctx)) {
      return ctx.json({ ok: false, reason: "unauthorized" }, 401);
    }
    const reply = parseInboundReply(body);
    if (!reply.token) {
      return ctx.json(
        { ok: false, reason: "no reply token on the recipient" },
        400,
      );
    }
    const owner = await this.tokens.resolve(reply.token);
    if (!owner) {
      return ctx.json({ ok: false, reason: "unknown reply token" }, 404);
    }
    const who = reply.fromName
      ? `${reply.fromName} <${reply.from ?? ""}>`
      : (reply.from ?? "the customer");
    const message = await this.log.run({
      userId: owner.userId,
      customerId: owner.customerId,
      channel: "email",
      role: "user",
      // the thread says who wrote, whatever renders it
      content: `${who} replied:\n\n${reply.text || "(empty reply)"}`,
      ...(reply.subject ? { subject: reply.subject } : {}),
      ...(reply.from ? { fromAddress: reply.from } : {}),
    });
    if (!message) {
      return ctx.json({ ok: false, reason: "could not record the reply" }, 500);
    }
    console.log(
      `[inbound] reply from ${who} → user ${owner.userId} customer ${owner.customerId} (message ${message.id})`,
    );
    return ctx.json({
      ok: true,
      messageId: message.id,
      conversationId: message.conversationId,
    });
  }
}
