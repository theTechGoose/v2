/** REQ-900 — the TwiML App's voice URL: a softphone dialed `To`; bridge it as the line and log it. */
import { Injectable } from "#danet/core";
import { safePhone } from "@communications/dto/mod.ts";
import { CommsConfigSource, publicUrl, ROUTES } from "@communications/domain/data/config/mod.ts";
import { dialNumber, say } from "@communications/domain/business/twiml/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";
import { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";

const E164 = /^\+[1-9]\d{6,14}$/;

@Injectable()
export class VoiceOutgoing {
  constructor(private calls: CallStore, private threads: ThreadStore, private cfgSource: CommsConfigSource) {}

  async handle(params: Record<string, string>): Promise<string> {
    const cfg = this.cfgSource.get();
    const to = safePhone(params.To ?? "");
    if (!E164.test(to)) {
      return `<?xml version="1.0" encoding="UTF-8"?><Response>${say("That number could not be dialed.")}<Hangup/></Response>`;
    }
    const line = cfg.from || "dev";
    const at = new Date().toISOString();
    await this.calls.create({ line, peer: to, direction: "outbound", providerSid: params.CallSid ?? "", status: "initiated", handledBy: "client", startedAt: at });
    await this.threads.touch({ line, peer: to, at, preview: "Outgoing call", unread: false });
    return dialNumber({
      callerId: line,
      to,
      statusCallback: publicUrl(cfg, ROUTES.voiceStatus),
    });
  }
}
