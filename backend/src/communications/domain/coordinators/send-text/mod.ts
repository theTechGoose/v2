/** REQ-899/904 — send a text from a line: thread first, dispatch, record the outcome. */
import { Injectable } from "#danet/core";
import {
  BadRequestError,
  safePhone,
  type SendTextInput,
  type TextMessage,
} from "@communications/dto/mod.ts";
import {
  CommsConfigSource,
  publicUrl,
  ROUTES,
} from "@communications/domain/data/config/mod.ts";
import {
  envLine,
  type ResolvedLine,
} from "@communications/domain/business/line-resolution/mod.ts";
import { TwilioClient } from "@communications/domain/data/twilio-client/mod.ts";
import { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";
import { TextMessageStore } from "@communications/domain/data/text-message-store/mod.ts";

export interface SendTextOutcome {
  ok: boolean;
  message: TextMessage;
  reason?: string;
}

@Injectable()
export class SendText {
  constructor(
    private twilio: TwilioClient,
    private threads: ThreadStore,
    private texts: TextMessageStore,
    private cfgSource: CommsConfigSource,
  ) {}

  /** `on` is the resolved line to send from; the env line when absent */
  async send(
    input: SendTextInput,
    on?: ResolvedLine,
  ): Promise<SendTextOutcome> {
    const cfg = this.cfgSource.get();
    const from = on ?? envLine(cfg);
    const line = from.number || "dev";
    const to = safePhone(input.to);
    if (!to) throw new BadRequestError("to must be a valid phone number");
    const at = new Date().toISOString();
    const thread = await this.threads.touch({
      line,
      peer: to,
      at,
      preview: input.body.slice(0, 140),
      unread: false,
    });
    const res = await this.twilio.sendMessage({
      to,
      body: input.body,
      from: from.number,
      accountSid: from.accountSid,
      ...(cfg.publicUrl
        ? { statusCallback: publicUrl(cfg, ROUTES.smsStatus) }
        : {}),
    });
    const message = await this.texts.create({
      threadId: thread.id,
      line,
      peer: to,
      direction: "outbound",
      body: input.body,
      mediaUrls: [],
      ...(res.sid ? { providerSid: res.sid } : {}),
      status: !res.ok ? "failed" : res.status === "dev" ? "dev" : "queued",
      ...(res.code !== undefined ? { errorCode: res.code } : {}),
    });
    return {
      ok: res.ok,
      message,
      ...(res.ok ? {} : { reason: res.reason ?? "send failed" }),
    };
  }
}
