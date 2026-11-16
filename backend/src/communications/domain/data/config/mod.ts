import { Injectable } from "#danet/core";

/**
 * REQ-899..901 — the line's configuration, all from `COMMS_*` env so the new
 * Twilio account never mixes with the OTP account's `TWILIO_*`.
 */
export interface CommsConfig {
  accountSid: string;
  authToken: string;
  /** the line, E.164 */
  from: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  /** https origin Twilio reaches us at (no trailing slash); webhooks and the relay url are built on it */
  publicUrl: string;
  fallback: string;
  forwardTo: string;
  agentPrompt: string;
  agentGreeting: string;
  /** seconds the softphone rings before the fallback */
  ringTimeoutSec: number;
  /** softphone identities to ring (COMMS_RING_IDENTITIES, comma-separated); empty → ring "agent_default" */
  ringIdentities: string[];
  /** true when no account SID is configured: send logs instead of dispatching */
  devMode: boolean;
  /** Twilio REST origin (COMMS_TWILIO_BASE_URL; tests point it at a local server) */
  baseUrl: string;
}

export const DEFAULT_AGENT_PROMPT =
  "You are the phone receptionist for a small local business. Be warm and brief: one or two short sentences per turn. " +
  "Find out the caller's name, the best number to reach them, and what they need; confirm the details back to them; " +
  "then say someone will call them back shortly and end the call by appending [END_CALL] to your last sentence. " +
  "Never invent prices, availability or promises. If the caller speaks Spanish or Portuguese, answer in that language.";

export const DEFAULT_AGENT_GREETING = "Thanks for calling. I'm the assistant here. Who am I speaking with?";

export function readCommsConfig(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): CommsConfig {
  const accountSid = env("COMMS_TWILIO_ACCOUNT_SID")?.trim() ?? "";
  const identities = (env("COMMS_RING_IDENTITIES") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    accountSid,
    authToken: env("COMMS_TWILIO_AUTH_TOKEN")?.trim() ?? "",
    from: env("COMMS_TWILIO_FROM")?.trim() ?? "",
    apiKeySid: env("COMMS_TWILIO_API_KEY_SID")?.trim() ?? "",
    apiKeySecret: env("COMMS_TWILIO_API_KEY_SECRET")?.trim() ?? "",
    twimlAppSid: env("COMMS_TWILIO_TWIML_APP_SID")?.trim() ?? "",
    publicUrl: (env("COMMS_PUBLIC_URL") ?? env("PUBLIC_BACKEND_URL") ?? "").trim().replace(/\/+$/, ""),
    fallback: env("COMMS_FALLBACK")?.trim() ?? "",
    forwardTo: env("COMMS_FORWARD_TO")?.trim() ?? "",
    agentPrompt: env("COMMS_AGENT_PROMPT")?.trim() || DEFAULT_AGENT_PROMPT,
    agentGreeting: env("COMMS_AGENT_GREETING")?.trim() || DEFAULT_AGENT_GREETING,
    ringTimeoutSec: Number(env("COMMS_RING_TIMEOUT_SEC") ?? 20) || 20,
    ringIdentities: identities.length ? identities : ["agent_default"],
    devMode: !accountSid,
    baseUrl: (env("COMMS_TWILIO_BASE_URL") ?? "https://api.twilio.com").replace(/\/+$/, ""),
  };
}

/** the public https URL of one of our routes */
export function publicUrl(cfg: Pick<CommsConfig, "publicUrl">, path: string): string {
  return `${cfg.publicUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** the same route as a websocket URL (https → wss) */
export function wsUrl(cfg: Pick<CommsConfig, "publicUrl">, path: string): string {
  return publicUrl(cfg, path).replace(/^http/, "ws");
}

export const ROUTES = {
  sms: "/communications/twilio/sms",
  smsStatus: "/communications/twilio/sms-status",
  voiceOutgoing: "/communications/twilio/voice/outgoing",
  voiceIncoming: "/communications/twilio/voice/incoming",
  voiceUnanswered: "/communications/twilio/voice/unanswered",
  voiceRelayDone: "/communications/twilio/voice/relay-done",
  voiceStatus: "/communications/twilio/voice/status",
  voiceRecording: "/communications/twilio/voice/recording",
  relay: "/communications/voice/relay",
} as const;

/**
 * The injectable seat for the config. Coordinators take this instead of
 * reading env themselves, so an int test hands them a fixed config and the
 * parallel lane's env churn cannot reach them (the gate caught that race).
 */
@Injectable()
export class CommsConfigSource {
  get(): CommsConfig {
    return readCommsConfig();
  }
}

/** a config built from an env-shaped map (tests): same derivations as production, nothing from the process env */
export function configFromEnv(env: Record<string, string | undefined>): CommsConfigSource {
  const cfg = readCommsConfig((k) => env[k]);
  return { get: () => cfg } as CommsConfigSource;
}
