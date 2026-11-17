/**
 * REQ-901 — Twilio ConversationRelay, as a pure state machine.
 *
 * Twilio turns the caller's speech into `prompt` frames and our text replies
 * into speech. This module decides what each inbound frame means and what the
 * socket handler must do about it (the effects); it never touches I/O, so the
 * whole protocol is unit-tested without a socket or an LLM.
 * https://www.twilio.com/docs/voice/conversationrelay/websocket-messages
 */
import type { LLMTurn } from "@agents/domain/business/llm/base/mod.ts";

export const RELAY_MAX_TURNS = 40;
/** the LLM says this (anywhere in its reply) to hang up after speaking */
export const END_CALL_MARKER = "[END_CALL]";

export type RelayFrame =
  | {
    type: "setup";
    sessionId: string;
    accountSid?: string;
    callSid: string;
    from: string;
    to: string;
    direction?: string;
    customParameters?: Record<string, string>;
  }
  | { type: "prompt"; voicePrompt: string; lang?: string; last: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt: string; durationUntilInterruptMs?: number }
  | { type: "dtmf"; digit: string }
  | { type: "error"; description: string };

export interface TranscriptTurn {
  role: "caller" | "agent";
  text: string;
  lang?: string;
  interrupted?: boolean;
}

export type RelayEffect =
  | { kind: "record"; turn: TranscriptTurn }
  | { kind: "ask-llm"; history: LLMTurn[] }
  | { kind: "send"; message: Record<string, unknown> }
  | { kind: "end"; reason: "agent-ended" | "turn-cap" };

export interface RelayState {
  sessionId: string | null;
  callSid: string | null;
  from: string | null;
  to: string | null;
  /** our Call record id, passed through <Parameter name="callId"> */
  callId: string | null;
  history: LLMTurn[];
  callerTurns: number;
  ended: boolean;
}

export function initialRelayState(): RelayState {
  return { sessionId: null, callSid: null, from: null, to: null, callId: null, history: [], callerTurns: 0, ended: false };
}

interface Step {
  state: RelayState;
  effects: RelayEffect[];
}

function callerTurn(state: RelayState, text: string, lang?: string): Step {
  const history = [...state.history, { role: "user", content: text } as LLMTurn];
  const callerTurns = state.callerTurns + 1;
  const effects: RelayEffect[] = [{ kind: "record", turn: { role: "caller", text, ...(lang ? { lang } : {}) } }];
  if (callerTurns > RELAY_MAX_TURNS) {
    return { state: { ...state, history, callerTurns, ended: true }, effects: [...effects, { kind: "end", reason: "turn-cap" }] };
  }
  return { state: { ...state, history, callerTurns }, effects: [...effects, { kind: "ask-llm", history }] };
}

export function reduceRelay(state: RelayState, frame: RelayFrame): Step {
  if (state.ended) return { state, effects: [] };
  switch (frame.type) {
    case "setup":
      return {
        state: {
          ...state,
          sessionId: frame.sessionId,
          callSid: frame.callSid,
          from: frame.from,
          to: frame.to,
          callId: frame.customParameters?.callId ?? null,
        },
        effects: [],
      };
    case "prompt": {
      if (!frame.last) return { state, effects: [] };
      const text = frame.voicePrompt.trim();
      if (!text) return { state, effects: [] };
      return callerTurn(state, text, frame.lang);
    }
    case "dtmf":
      return callerTurn(state, `(pressed ${frame.digit})`);
    case "interrupt": {
      const heard = frame.utteranceUntilInterrupt.trim();
      const last = state.history.at(-1);
      if (!last || last.role !== "assistant") return { state, effects: [] };
      const history = [...state.history.slice(0, -1), { role: "assistant", content: heard } as LLMTurn];
      return { state: { ...state, history }, effects: [{ kind: "record", turn: { role: "agent", text: heard, interrupted: true } }] };
    }
    default:
      return { state, effects: [] };
  }
}

/** the LLM answered: speak it (one final token), remember it, and end if it asked to */
export function replyEffects(state: RelayState, reply: string): Step {
  const wantsEnd = reply.includes(END_CALL_MARKER);
  const text = reply.replaceAll(END_CALL_MARKER, "").trim();
  const history = text ? [...state.history, { role: "assistant", content: text } as LLMTurn] : state.history;
  const effects: RelayEffect[] = [];
  if (text) {
    effects.push({ kind: "send", message: { type: "text", token: text, last: true } });
    effects.push({ kind: "record", turn: { role: "agent", text } });
  }
  if (wantsEnd) effects.push({ kind: "end", reason: "agent-ended" });
  return { state: { ...state, history, ended: state.ended || wantsEnd }, effects };
}
