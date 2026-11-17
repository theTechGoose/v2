/**
 * REQ-899..901/904 — the eight URLs Twilio calls. Every one goes through
 * VerifyWebhook first (which line, then 403 without that line's signature)
 * and answers either TwiML (text/xml) or an empty 204.
 */
import { Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { VerifyWebhook } from "@communications/domain/coordinators/verify-webhook/mod.ts";
import { ReceiveText } from "@communications/domain/coordinators/receive-text/mod.ts";
import { TextStatus } from "@communications/domain/coordinators/text-status/mod.ts";
import { VoiceOutgoing } from "@communications/domain/coordinators/voice-outgoing/mod.ts";
import { VoiceIncoming } from "@communications/domain/coordinators/voice-incoming/mod.ts";
import { VoiceUnanswered } from "@communications/domain/coordinators/voice-unanswered/mod.ts";
import { RelayDone } from "@communications/domain/coordinators/relay-done/mod.ts";
import { CallStatus } from "@communications/domain/coordinators/call-status/mod.ts";
import { CallRecording } from "@communications/domain/coordinators/call-recording/mod.ts";
import { emptyResponse } from "@communications/domain/business/twiml/mod.ts";

function twiml(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
}
const ack = () => new Response(null, { status: 204 });

@Controller("communications/twilio")
export class TwilioWebhooksController {
  constructor(
    private verify: VerifyWebhook,
    private receiveText: ReceiveText,
    private textStatus: TextStatus,
    private outgoing: VoiceOutgoing,
    private incoming: VoiceIncoming,
    private unanswered: VoiceUnanswered,
    private relayDone: RelayDone,
    private callStatus: CallStatus,
    private callRecording: CallRecording,
  ) {}

  @Post("sms")
  async sms(@Context() ctx: ExecutionContext): Promise<Response> {
    await this.receiveText.receive((await this.verify.verify(ctx.req.raw)).params);
    return twiml(emptyResponse());
  }

  @Post("sms-status")
  async smsStatus(@Context() ctx: ExecutionContext): Promise<Response> {
    await this.textStatus.apply((await this.verify.verify(ctx.req.raw)).params);
    return ack();
  }

  @Post("voice/outgoing")
  async voiceOutgoing(@Context() ctx: ExecutionContext): Promise<Response> {
    const { params, line } = await this.verify.verify(ctx.req.raw);
    return twiml(await this.outgoing.handle(params, line));
  }

  @Post("voice/incoming")
  async voiceIncoming(@Context() ctx: ExecutionContext): Promise<Response> {
    const { params, line } = await this.verify.verify(ctx.req.raw);
    return twiml(await this.incoming.handle(params, line));
  }

  @Post("voice/unanswered")
  async voiceUnanswered(@Context() ctx: ExecutionContext): Promise<Response> {
    const { params, line } = await this.verify.verify(ctx.req.raw);
    return twiml(await this.unanswered.handle(params, line));
  }

  @Post("voice/relay-done")
  async voiceRelayDone(@Context() ctx: ExecutionContext): Promise<Response> {
    return twiml(await this.relayDone.handle((await this.verify.verify(ctx.req.raw)).params));
  }

  @Post("voice/status")
  async voiceStatus(@Context() ctx: ExecutionContext): Promise<Response> {
    await this.callStatus.apply((await this.verify.verify(ctx.req.raw)).params);
    return ack();
  }

  @Post("voice/recording")
  async voiceRecording(@Context() ctx: ExecutionContext): Promise<Response> {
    await this.callRecording.apply((await this.verify.verify(ctx.req.raw)).params);
    return ack();
  }
}
