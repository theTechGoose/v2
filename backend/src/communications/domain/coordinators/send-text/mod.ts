/** REQ-899/904 — send a text from a line: thread first, dispatch, record the outcome. REQ-920a: a subaccount line waits for its VERIFIED campaign. */
import { Injectable } from "#danet/core";
import { BadRequestError, safePhone, type SendTextInput, type TextMessage } from "@communications/dto/mod.ts";
import { CommsConfigSource, publicUrl, ROUTES } from "@communications/domain/data/config/mod.ts";
import { envLine, type ResolvedLine } from "@communications/domain/business/line-resolution/mod.ts";
import { TwilioClient } from "@communications/domain/data/twilio-client/mod.ts";
import { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";
import { TextMessageStore } from "@communications/domain/data/text-message-store/mod.ts";
import { A2pStore } from "@communications/domain/data/a2p-store/mod.ts";
import { maySendFromSubaccount } from "@communications/domain/business/a2p/mod.ts";

/** REQ-920a — 403: a customer's number may not text until its A2P campaign is VERIFIED */
export class A2pUnregisteredError extends Error {
  readonly status: number = 403;
  readonly code = "a2p_unregistered";
  constructor() {
    super("this number can't text yet: its texting registration (A2P 10DLC) has to be approved first");
    this.name = "A2pUnregisteredError";
  }
}

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
    private a2p: A2pStore = new A2pStore(),
  ) {}

  /** `on` is the resolved line to send from; the env line when absent */
  async send(input: SendTextInput, on?: ResolvedLine): Promise<SendTextOutcome> {
    const cfg = this.cfgSource.get();
    const from = on ?? envLine(cfg);
    const line = from.number || "dev";
    const to = safePhone(input.to);
    if (!to) throw new BadRequestError("to must be a valid phone number");
    if (from.kind === "subaccount" && cfg.a2pGate && !maySendFromSubaccount(await this.a2p.findBySubaccount(from.accountSid))) {
      throw new A2pUnregisteredError();
    }
    const at = new Date().toISOString();
    const thread = await this.threads.touch({ line, peer: to, at, preview: input.body.slice(0, 140), unread: false });
    const res = await this.twilio.sendMessage({
      to,
      body: input.body,
      from: from.number,
      accountSid: from.accountSid,
      ...(cfg.publicUrl ? { statusCallback: publicUrl(cfg, ROUTES.smsStatus) } : {}),
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
    return { ok: res.ok, message, ...(res.ok ? {} : { reason: res.reason ?? "send failed" }) };
  }
}
