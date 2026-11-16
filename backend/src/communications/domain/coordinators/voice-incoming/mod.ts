/** REQ-900 — the line was called: log it and ring every softphone; the Dial's result goes to voice.unanswered. */
import { Injectable } from "#danet/core";
import { safePhone } from "@communications/dto/mod.ts";
import { CommsConfigSource, publicUrl, ROUTES } from "@communications/domain/data/config/mod.ts";
import { envLine, type ResolvedLine } from "@communications/domain/business/line-resolution/mod.ts";
import { ringClients } from "@communications/domain/business/twiml/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";
import { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";

@Injectable()
export class VoiceIncoming {
  constructor(private calls: CallStore, private threads: ThreadStore, private cfgSource: CommsConfigSource) {}

  /** `on`: the line that was called (REQ-904); the env line when absent */
  async handle(params: Record<string, string>, on?: ResolvedLine): Promise<string> {
    const cfg = this.cfgSource.get();
    const resolved = on ?? envLine(cfg);
    const peer = safePhone(params.From ?? "");
    const line = safePhone(params.To ?? "") || resolved.number;
    const at = new Date().toISOString();
    await this.calls.create({ line, peer, direction: "inbound", providerSid: params.CallSid ?? "", status: "ringing", handledBy: "none", startedAt: at });
    await this.threads.touch({ line, peer, at, preview: "Incoming call", unread: false });
    return ringClients({
      identities: resolved.ringIdentities,
      timeoutSec: cfg.ringTimeoutSec,
      action: publicUrl(cfg, ROUTES.voiceUnanswered),
      callerId: peer,
    });
  }
}
