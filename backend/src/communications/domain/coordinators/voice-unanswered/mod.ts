/** REQ-900/901 — the Dial result: taken → hang up; otherwise exactly one fallback arm. */
import { Injectable } from "#danet/core";
import { safePhone } from "@communications/dto/mod.ts";
import {
  CommsConfigSource,
  publicUrl,
  ROUTES,
  wsUrl,
} from "@communications/domain/data/config/mod.ts";
import {
  envLine,
  type ResolvedLine,
} from "@communications/domain/business/line-resolution/mod.ts";
import { selectFallback } from "@communications/domain/business/fallback/mod.ts";
import {
  connectRelay,
  forwardTo,
  hangup,
  record,
} from "@communications/domain/business/twiml/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";
import { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";

@Injectable()
export class VoiceUnanswered {
  constructor(
    private calls: CallStore,
    private threads: ThreadStore,
    private cfgSource: CommsConfigSource,
  ) {}

  /** `on`: the line that rang (REQ-904); the env line when absent */
  async handle(
    params: Record<string, string>,
    on?: ResolvedLine,
  ): Promise<string> {
    const cfg = this.cfgSource.get();
    const resolved = on ?? envLine(cfg);
    const arm = selectFallback(
      { mode: cfg.fallback, forwardTo: cfg.forwardTo },
      params.DialCallStatus ?? "",
    );
    const call = params.CallSid
      ? await this.calls.findBySid(params.CallSid)
      : null;
    const taken = arm === "hangup" &&
      ["completed", "answered"].includes(params.DialCallStatus ?? "");
    if (call) {
      await this.calls.patch(call.id, {
        handledBy: taken ? "client" : arm === "hangup" ? "none" : arm,
      });
      if (!taken) {
        await this.threads.touch({
          line: call.line,
          peer: call.peer,
          at: new Date().toISOString(),
          preview: "Missed call",
          unread: true,
        });
      }
    }
    const line = resolved.number || safePhone(params.To ?? "");
    switch (arm) {
      case "agent":
        return connectRelay({
          url: wsUrl(cfg, ROUTES.relay),
          action: publicUrl(cfg, ROUTES.voiceRelayDone),
          welcomeGreeting: cfg.agentGreeting,
          parameters: call ? { callId: call.id } : {},
        });
      case "voicemail":
        return record({
          sayFirst:
            "Sorry we missed you. Please leave your name, number and a short message after the tone.",
          maxLengthSec: 120,
          recordingStatusCallback: publicUrl(cfg, ROUTES.voiceRecording),
        });
      case "forward":
        return forwardTo({ number: cfg.forwardTo, callerId: line });
      default:
        return hangup();
    }
  }
}
