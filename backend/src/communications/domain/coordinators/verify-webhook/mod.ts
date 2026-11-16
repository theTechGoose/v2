/**
 * REQ-899/904 — the gate in front of every Twilio webhook. The request names
 * its account; that picks the line (and so the auth token Twilio signed with);
 * no valid signature for that line, no entry (403).
 */
import { Injectable } from "#danet/core";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { verifyTwilioSignature } from "@communications/domain/business/twilio-signature/mod.ts";
import { parseForm, webhookFromParts } from "@communications/domain/business/webhook-request/mod.ts";
import type { ResolvedLine } from "@communications/domain/business/line-resolution/mod.ts";
import { LineContext, UnknownLineError } from "@communications/domain/coordinators/line-context/mod.ts";

export class WebhookForbiddenError extends Error {
  readonly status: number = 403;
  constructor() {
    super("twilio signature invalid");
    this.name = "WebhookForbiddenError";
  }
}

export interface VerifiedWebhook {
  /** the form fields, as Twilio names them (From, To, Body, CallSid, …) */
  params: Record<string, string>;
  line: ResolvedLine;
}

@Injectable()
export class VerifyWebhook {
  constructor(private lineContext: LineContext, private cfgSource: CommsConfigSource) {}

  async verify(req: Request): Promise<VerifiedWebhook> {
    const cfg = this.cfgSource.get();
    const rawBody = req.method === "GET" ? "" : await req.text();
    const params = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : parseForm(rawBody);
    let line: ResolvedLine;
    try {
      line = await this.lineContext.forWebhook(params);
    } catch (err) {
      if (err instanceof UnknownLineError) throw new WebhookForbiddenError();
      throw err;
    }
    if (!line.authToken) throw new WebhookForbiddenError();
    const publicOrigin = cfg.publicUrl || new URL(req.url).origin;
    const webhook = webhookFromParts({
      authToken: line.authToken,
      publicOrigin,
      requestUrl: req.url,
      rawBody,
      signature: req.headers.get("x-twilio-signature"),
    });
    if (!(await verifyTwilioSignature(webhook))) throw new WebhookForbiddenError();
    return { params: webhook.params, line };
  }
}
