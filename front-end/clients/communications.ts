/**
 * REQ-915/916 — the Phone page's HTTP client over the communications module
 * (REQ-899..905). Backend: backend/src/communications/entrypoints/* — every
 * route behind the owner's session; an account with no line gets 409
 * `no_line` from the line-scoped reads, a second buy 409 `line_exists`.
 */
import { api, type ApiOptions } from "../lib/api.ts";

export type Direction = "inbound" | "outbound";

export interface Thread {
  id: string;
  line: string;
  peer: string;
  lastMessageAt: string;
  lastPreview: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TextStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "received"
  | "dev";

export interface TextMessage {
  id: string;
  threadId: string;
  line: string;
  peer: string;
  direction: Direction;
  body: string;
  mediaUrls: string[];
  providerSid?: string;
  status: TextStatus;
  errorCode?: number;
  createdAt: string;
  updatedAt: string;
}

export type CallStatus =
  | "queued"
  | "initiated"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed"
  | "canceled";
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
  relayStatus?: string;
  handoffData?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadDetail {
  thread: Thread;
  texts: TextMessage[];
  calls: Call[];
}

export interface PublicLine {
  id: string;
  userId: string;
  kind: "subaccount";
  subaccountSid: string;
  number: string;
  numberSid: string;
  apiKeySid: string;
  twimlAppSid: string;
  friendlyName?: string;
  status: "active" | "released";
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

export interface SendTextOutcome {
  ok: boolean;
  message: TextMessage;
  reason?: string;
}

export interface VoiceToken {
  token: string;
  identity: string;
  ttlSec: number;
  expiresAt: string;
}

export const commsClient = {
  availableNumbers: (
    q: { areaCode?: string; contains?: string },
    opts?: ApiOptions,
  ) =>
    api.get<{ numbers: AvailableNumber[] }>(
      "/communications/numbers/available",
      { ...opts, query: { areaCode: q.areaCode, contains: q.contains } },
    ),
  buyNumber: (phoneNumber: string, friendlyName?: string) =>
    api.post<PublicLine>("/communications/numbers", {
      phoneNumber,
      ...(friendlyName ? { friendlyName } : {}),
    }),
  line: (opts?: ApiOptions) =>
    api.get<{ line: PublicLine | null }>("/communications/line", opts),
  release: () =>
    api.post<{ line: PublicLine | null }>("/communications/line/release", {}),
  threads: (opts?: ApiOptions) =>
    api.get<Thread[]>("/communications/threads", opts),
  thread: (peer: string, opts?: ApiOptions) =>
    api.get<ThreadDetail>(
      `/communications/threads/${encodeURIComponent(peer)}`,
      opts,
    ),
  sendText: (to: string, body: string) =>
    api.post<SendTextOutcome>("/communications/texts", { to, body }),
  calls: (opts?: ApiOptions) => api.get<Call[]>("/communications/calls", opts),
  call: (id: string, opts?: ApiOptions) =>
    api.get<Call>(`/communications/calls/${encodeURIComponent(id)}`, opts),
  voiceToken: () => api.post<VoiceToken>("/communications/voice/token", {}),
  // REQ-920b — the house path (super admins): verified campaigns' services, and adopt
  houseServices: () =>
    api.get<{ services: HouseService[] }>("/communications/house/services"),
  houseAdopt: (serviceSid: string) =>
    api.post<{ line: PublicLine }>("/communications/house/adopt", {
      serviceSid,
    }),
};

/** REQ-920b — a main-account messaging service with a VERIFIED A2P campaign */
export interface HouseService {
  sid: string;
  friendlyName: string;
  usecase: string;
}
