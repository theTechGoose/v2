/**
 * REQ-916 — the softphone's pure state machine. The island owns the Twilio
 * Device and feeds its events in here; what to render is a function of the
 * state alone.
 *
 *   idle → registering → ready → dialing (Call) | ringing (incoming)
 *        → in-call → ready (the device stays registered) … unregistered → idle
 *   any → error (one-line reason); register again from error retries.
 */

/** Twilio's browser Voice SDK, loaded at page open with a dynamic import — never bundled, never in a deno.json */
export const VOICE_SDK_URL = "https://esm.sh/@twilio/voice-sdk@2.19.0";

export type PhonePhase =
  | "idle"
  | "registering"
  | "ready"
  | "dialing"
  | "ringing"
  | "in-call"
  | "error";

export interface PhoneState {
  phase: PhonePhase;
  /** the other party (E.164) while dialing / ringing / in a call */
  peer?: string;
  direction?: "inbound" | "outbound";
  /** epoch ms the call connected */
  startedAt?: number;
  muted: boolean;
  /** why it is not registered: sdk | noKey | noLine | mic | twilio */
  reason?: string;
}

export type PhoneEvent =
  | { type: "register" }
  | { type: "registered" }
  | { type: "unregistered" }
  | { type: "failed"; reason: string }
  | { type: "dial"; to: string }
  | { type: "incoming"; from: string }
  | { type: "accepted"; at: number }
  | { type: "declined" }
  | { type: "ended" }
  | { type: "callFailed" }
  | { type: "mute"; muted: boolean };

export function initialPhone(): PhoneState {
  return { phase: "idle", muted: false };
}

const READY: PhoneState = { phase: "ready", muted: false };

export function phoneReducer(s: PhoneState, e: PhoneEvent): PhoneState {
  switch (e.type) {
    case "register":
      return s.phase === "idle" || s.phase === "error"
        ? { phase: "registering", muted: false }
        : s;
    case "registered":
      return s.phase === "registering" || s.phase === "idle" ? READY : s;
    case "unregistered":
      return initialPhone();
    case "failed":
      return { phase: "error", muted: false, reason: e.reason };
    case "dial":
      return s.phase === "ready"
        ? { phase: "dialing", muted: false, peer: e.to, direction: "outbound" }
        : s;
    case "incoming":
      return s.phase === "ready"
        ? {
          phase: "ringing",
          muted: false,
          peer: e.from,
          direction: "inbound",
        }
        : s;
    case "accepted":
      return s.phase === "dialing" || s.phase === "ringing"
        ? { ...s, phase: "in-call", startedAt: e.at }
        : s;
    case "declined":
      return s.phase === "ringing" ? READY : s;
    case "ended":
    case "callFailed":
      return s.phase === "dialing" || s.phase === "ringing" ||
          s.phase === "in-call"
        ? READY
        : s;
    case "mute":
      return s.phase === "in-call" ? { ...s, muted: e.muted } : s;
  }
}

/**
 * The dictionary key of the one-line "not registered" reason. `stage` says
 * where it failed when the error itself cannot (loading the SDK).
 */
export function reasonKey(err: unknown, stage?: "sdk"): string {
  const e = (err ?? {}) as {
    status?: number;
    name?: string;
    code?: number;
  };
  if (stage === "sdk") return "comms.phone.reason.sdk";
  if (e.status === 503) return "comms.phone.reason.noKey";
  if (e.status === 409) return "comms.phone.reason.noLine";
  // NotAllowedError: the browser said no; 31402 / 31208: Twilio's "media acquisition failed" / "permission denied"
  if (
    e.name === "NotAllowedError" || e.name === "PermissionDeniedError" ||
    e.code === 31402 || e.code === 31208 || e.code === 31401
  ) return "comms.phone.reason.mic";
  return "comms.phone.reason.twilio";
}

/** ms until the token should be re-minted: 60 s before expiry, or at half its remaining life when under a minute is left; never negative */
export function refreshDelayMs(expiresAt: string, now: number): number {
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return 0;
  const left = exp - now;
  if (left <= 0) return 0;
  return left > 60_000 ? left - 60_000 : Math.floor(left / 2);
}

/** an in-call timer: "m:ss", or "h:mm:ss" past the hour */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** the DTMF keypad */
export const KEYPAD = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "*",
  "0",
  "#",
];
