/**
 * REQ-901 — one ConversationRelay websocket session. The protocol is the pure
 * `relay` state machine; this coordinator runs its effects: persist turns on
 * the call, ask the LLM, and hand back the JSON frames to send.
 */
import { Inject, Injectable } from "#danet/core";
import { LLM_CLIENT, type LLMClient } from "@agents/domain/business/llm/base/mod.ts";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { initialRelayState, reduceRelay, type RelayEffect, type RelayFrame, type RelayState, replyEffects } from "@communications/domain/business/relay/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";

export interface RelaySessionState {
  state: RelayState;
  systemPrompt: string;
}

export interface RelayStep {
  /** JSON frames to send to Twilio, in order */
  outbound: string[];
  /** true once the session asked Twilio to end (close after flushing) */
  end: boolean;
}

const FALLBACK_REPLY = "Sorry, I didn't catch that. Could you say it again?";

@Injectable()
export class RelaySession {
  constructor(private calls: CallStore, @Inject(LLM_CLIENT) private llm: LLMClient, private cfgSource: CommsConfigSource) {}

  start(): RelaySessionState {
    const cfg = this.cfgSource.get();
    return { state: initialRelayState(), systemPrompt: cfg.agentPrompt };
  }

  async handleFrame(session: RelaySessionState, raw: string): Promise<RelayStep> {
    let frame: RelayFrame;
    try {
      frame = JSON.parse(raw) as RelayFrame;
    } catch {
      console.warn("[communications/relay] non-JSON frame ignored");
      return { outbound: [], end: false };
    }
    const step = reduceRelay(session.state, frame);
    session.state = step.state;
    return await this.run(session, step.effects);
  }

  private async run(session: RelaySessionState, effects: RelayEffect[]): Promise<RelayStep> {
    const out: RelayStep = { outbound: [], end: false };
    for (const effect of effects) {
      switch (effect.kind) {
        case "record":
          await this.record(session, effect.turn);
          break;
        case "send":
          out.outbound.push(JSON.stringify(effect.message));
          break;
        case "end":
          out.outbound.push(JSON.stringify({ type: "end" }));
          out.end = true;
          break;
        case "ask-llm": {
          const reply = await this.ask(session, effect.history);
          const next = replyEffects(session.state, reply);
          session.state = next.state;
          const nested = await this.run(session, next.effects);
          out.outbound.push(...nested.outbound);
          out.end = out.end || nested.end;
          break;
        }
      }
    }
    return out;
  }

  private async ask(session: RelaySessionState, history: RelayState["history"]): Promise<string> {
    const s = session.state;
    const context = [
      s.from ? `Caller number: ${s.from}.` : "",
      s.to ? `They called: ${s.to}.` : "",
      "You are on a phone call: keep every reply under 40 words, no lists, no markdown.",
    ].filter(Boolean).join(" ");
    try {
      const res = await this.llm.respond({
        systemPrompt: `${session.systemPrompt}\n\n${context}`,
        messages: history,
        userId: "communications-voice-agent",
      });
      return res.text?.trim() || FALLBACK_REPLY;
    } catch (err) {
      console.error("[communications/relay] llm failed:", (err as Error).message);
      return FALLBACK_REPLY;
    }
  }

  private async record(session: RelaySessionState, turn: { role: "caller" | "agent"; text: string; lang?: string; interrupted?: boolean }): Promise<void> {
    const callId = session.state.callId;
    if (!callId) return;
    try {
      await this.calls.appendTranscript(callId, { ...turn, at: new Date().toISOString() });
    } catch (err) {
      console.error("[communications/relay] transcript not saved:", (err as Error).message);
    }
  }
}
