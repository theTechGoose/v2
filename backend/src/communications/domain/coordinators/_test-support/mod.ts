/** shared by the communications int tests: an in-memory KV, a configured line, a capturing Twilio seat */
import { resetKv } from "@core/data/kv/mod.ts";
import { type CommsConfigSource, configFromEnv } from "@communications/domain/data/config/mod.ts";
import type { SendMessageInput, SendMessageResult, TwilioClient } from "@communications/domain/data/twilio-client/mod.ts";
import type { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";
import type { TextMessageStore } from "@communications/domain/data/text-message-store/mod.ts";
import type { CallStore } from "@communications/domain/data/call-store/mod.ts";
import type { LineStore } from "@communications/domain/data/line-store/mod.ts";

export const LINE = "+18432588463";
export const PEER = "+15125551234";
export const TEST_AUTH_TOKEN = "test-auth-token";
export const PUBLIC_URL = "https://api.test";

export const TEST_ENV: Record<string, string> = {
  COMMS_TWILIO_ACCOUNT_SID: "ACtest",
  COMMS_TWILIO_AUTH_TOKEN: TEST_AUTH_TOKEN,
  COMMS_TWILIO_FROM: LINE,
  COMMS_TWILIO_API_KEY_SID: "SKtest",
  COMMS_TWILIO_API_KEY_SECRET: "sk-secret",
  COMMS_TWILIO_TWIML_APP_SID: "APtest",
  COMMS_PUBLIC_URL: PUBLIC_URL,
  COMMS_RING_IDENTITIES: "u_1,u_2",
};

/** a fresh in-memory KV plus the test line as a FIXED config (the process env is never touched: the int lane runs files in parallel in one process) */
export async function freshLine(overrides: Record<string, string | undefined> = {}): Promise<{ restore: () => Promise<void>; cfg: CommsConfigSource }> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const cfg = configFromEnv({ ...TEST_ENV, ...overrides });
  return { cfg, restore: () => resetKv() };
}

export class CapturingTwilio {
  sent: SendMessageInput[] = [];
  next: SendMessageResult = { ok: true, sid: "SM1", status: "queued" };
  sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    this.sent.push(input);
    return Promise.resolve(this.next);
  }
}
export const asTwilio = (c: CapturingTwilio) => c as unknown as TwilioClient;

export async function stores(): Promise<{ threads: ThreadStore; texts: TextMessageStore; calls: CallStore; lines: LineStore }> {
  const [{ ThreadStore }, { TextMessageStore }, { CallStore }, { LineStore }] = await Promise.all([
    import("@communications/domain/data/thread-store/mod.ts"),
    import("@communications/domain/data/text-message-store/mod.ts"),
    import("@communications/domain/data/call-store/mod.ts"),
    import("@communications/domain/data/line-store/mod.ts"),
  ]);
  return { threads: new ThreadStore(), texts: new TextMessageStore(), calls: new CallStore(), lines: new LineStore() };
}

/** a Twilio-shaped webhook Request, signed with the test token */
export async function signedRequest(path: string, params: Record<string, string>, opts: { sign?: boolean; token?: string } = {}): Promise<Request> {
  const { twilioSignature } = await import("@communications/domain/business/twilio-signature/mod.ts");
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (opts.sign !== false) headers["x-twilio-signature"] = await twilioSignature(opts.token ?? TEST_AUTH_TOKEN, `${PUBLIC_URL}${path}`, params);
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers, body });
}
