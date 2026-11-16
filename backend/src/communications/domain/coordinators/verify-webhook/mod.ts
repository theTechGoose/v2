/** REQ-899 — the gate in front of every Twilio webhook: no valid signature, no entry (403). */
import { Injectable } from "#danet/core";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { verifyTwilioSignature } from "@communications/domain/business/twilio-signature/mod.ts";
import { webhookFromParts } from "@communications/domain/business/webhook-request/mod.ts";

export class WebhookForbiddenError extends Error {
  readonly status: number = 403;
  constructor() {
    super("twilio signature invalid");
    this.name = "WebhookForbiddenError";
  }
}

@Injectable()
export class VerifyWebhook {
  constructor(private cfgSource: CommsConfigSource) {}

  /** the request's form fields, once Twilio's signature over them checks out */
  async verify(req: Request): Promise<Record<string, string>> {
    const cfg = this.cfgSource.get();
    const rawBody = req.method === "GET" ? "" : await req.text();
    const publicOrigin = cfg.publicUrl || new URL(req.url).origin;
    const webhook = webhookFromParts({
      authToken: cfg.authToken,
      publicOrigin,
      requestUrl: req.url,
      rawBody,
      signature: req.headers.get("x-twilio-signature"),
    });
    if (!(await verifyTwilioSignature(webhook))) throw new WebhookForbiddenError();
    return webhook.params;
  }
}
