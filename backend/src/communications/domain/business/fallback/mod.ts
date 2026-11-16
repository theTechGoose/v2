/**
 * REQ-900 — what the line does when the softphone did not take the call.
 * Exactly one arm runs per call. Pure: the coordinator reads the env and the
 * Dial result and asks here.
 */
export type FallbackArm = "agent" | "voicemail" | "forward" | "hangup";

export interface FallbackConfig {
  /** COMMS_FALLBACK: agent | voicemail | forward | hangup (default voicemail) */
  mode?: string;
  /** COMMS_FORWARD_TO: the E.164 to forward to when mode is forward */
  forwardTo?: string;
}

/** Twilio's DialCallStatus values that mean the call was taken by the softphone */
const TAKEN = new Set(["completed", "answered"]);

export function selectFallback(config: FallbackConfig, dialCallStatus: string): FallbackArm {
  if (TAKEN.has(dialCallStatus)) return "hangup";
  switch (config.mode) {
    case "agent":
      return "agent";
    case "hangup":
      return "hangup";
    case "forward":
      return config.forwardTo?.trim() ? "forward" : "voicemail";
    default:
      return "voicemail";
  }
}
