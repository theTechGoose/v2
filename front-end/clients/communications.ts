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

/** REQ-920 — a line's texting registration (A2P 10DLC), as GET /communications/a2p answers it */
export type A2pState =
  | "none"
  | "needs_isv_primary"
  | "profile_pending"
  | "profile_failed"
  | "brand_pending"
  | "brand_failed"
  | "campaign_pending"
  | "campaign_failed"
  | "registered";

export interface A2pError {
  step: string;
  message: string;
  code?: number;
  field?: string;
}

export interface A2pRegistration {
  lineId: string;
  userId: string;
  subaccountSid: string;
  form: Record<string, unknown>;
  profileSid?: string;
  profileStatus?: string;
  profileSubmitted?: boolean;
  needsIsvPrimary?: boolean;
  trustProductSid?: string;
  trustProductStatus?: string;
  brandSid?: string;
  brandStatus?: string;
  brandFailureReason?: string;
  serviceSid?: string;
  campaignSid?: string;
  campaignStatus?: string;
  state: A2pState;
  errors: A2pError[];
  createdAt: string;
  updatedAt: string;
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
  // REQ-920 — texting registration
  a2p: (opts?: ApiOptions) =>
    api.get<{ registration: A2pRegistration | null }>(
      "/communications/a2p",
      opts,
    ),
  a2pSubmit: (form: Record<string, unknown>) =>
    api.post<A2pRegistration>("/communications/a2p", form),
  a2pRefresh: () =>
    api.post<A2pRegistration | null>("/communications/a2p/refresh", {}),
};
