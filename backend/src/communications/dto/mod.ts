/** REQ-899..901 — the communications module's records and request shapes. */
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";

export type Direction = "inbound" | "outbound";

/** one conversation per peer phone number on a line */
export interface Thread {
  id: string;
  /** our Twilio number, E.164 */
  line: string;
  /** the other party, E.164 */
  peer: string;
  lastMessageAt: string;
  lastPreview: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TextStatus =
  | "queued" | "sending" | "sent" | "delivered" | "undelivered" | "failed" | "received" | "dev";

export interface TextMessage {
  id: string;
  threadId: string;
  line: string;
  peer: string;
  direction: Direction;
  body: string;
  mediaUrls: string[];
  /** Twilio Message SID (SM…/MM…); absent in dev mode */
  providerSid?: string;
  status: TextStatus;
  errorCode?: number;
  createdAt: string;
  updatedAt: string;
}

export type CallStatus =
  | "queued" | "initiated" | "ringing" | "in-progress" | "completed" | "busy" | "no-answer" | "failed" | "canceled";
export type HandledBy = "none" | "client" | "agent" | "voicemail" | "forward";

export interface CallTranscriptTurn {
  role: "caller" | "agent";
  text: string;
  at: string;
  lang?: string;
  interrupted?: boolean;
}

export interface Call {
  id: string;
  line: string;
  peer: string;
  direction: Direction;
  /** Twilio Call SID (CA…) */
  providerSid: string;
  status: CallStatus;
  handledBy: HandledBy;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  recordingSid?: string;
  recordingUrl?: string;
  recordingDurationSec?: number;
  transcript: CallTranscriptTurn[];
  /** ConversationRelay session outcome: ended | completed | failed */
  relayStatus?: string;
  handoffData?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SendTextInput {
  to: string;
  body: string;
}

export class BadRequestError extends Error {
  readonly status: number = 400;
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export function parseSendText(body: unknown): SendTextInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.to !== "string" || !b.to.trim()) throw new BadRequestError("to is required");
  if (typeof b.body !== "string" || !b.body.trim()) throw new BadRequestError("body is required");
  const to = normalizePhone(b.to);
  if (!/^\+[1-9]\d{1,14}$/.test(to)) throw new BadRequestError("to must be a valid phone number");
  if (b.body.length > 1600) throw new BadRequestError("body is too long (1600 max)");
  return { to, body: b.body };
}

export interface ThreadDetail {
  thread: Thread;
  texts: TextMessage[];
  calls: Call[];
}

/** E.164 or "" — never throws on junk (normalizePhone throws on no digits) */
export function safePhone(input: string | undefined): string {
  if (!input) return "";
  try {
    const n = normalizePhone(input);
    return /^\+[1-9]\d{6,14}$/.test(n) ? n : "";
  } catch {
    return "";
  }
}
