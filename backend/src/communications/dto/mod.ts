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
  /** Twilio Message SID (SM…/MM…); absent in dev mode */
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
  if (typeof b.to !== "string" || !b.to.trim()) {
    throw new BadRequestError("to is required");
  }
  if (typeof b.body !== "string" || !b.body.trim()) {
    throw new BadRequestError("body is required");
  }
  const to = normalizePhone(b.to);
  if (!/^\+[1-9]\d{1,14}$/.test(to)) {
    throw new BadRequestError("to must be a valid phone number");
  }
  if (b.body.length > 1600) {
    throw new BadRequestError("body is too long (1600 max)");
  }
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

// ── REQ-903..905 — a customer's own line on its own Twilio subaccount ──────────

export type LineStatus = "active" | "released";

/** stored record: the two secrets are sealed with secret-box (REQ-212) and never leave the server */
export interface Line {
  id: string;
  userId: string;
  /** REQ-920b: "main" once the number moved to the main account under the platform's own A2P registration */
  kind: "subaccount" | "main";
  /** "" on a main-account line */
  subaccountSid: string;
  /** E.164 */
  number: string;
  /** Twilio IncomingPhoneNumber SID (PN…) */
  numberSid: string;
  apiKeySid: string;
  twimlAppSid: string;
  friendlyName?: string;
  /** REQ-920b: the main-account messaging service (MG…) the number texts through, and its verified campaign's use case */
  messagingServiceSid?: string;
  campaignUsecase?: string;
  status: LineStatus;
  authTokenSealed: string;
  apiKeySecretSealed: string;
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
}

export type PublicLine = Omit<Line, "authTokenSealed" | "apiKeySecretSealed">;

/** what the app may see of a line */
export function redactLine(line: Line): PublicLine {
  const { authTokenSealed: _a, apiKeySecretSealed: _b, ...pub } = line;
  return pub;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

export interface BuyNumberInput {
  phoneNumber: string;
  friendlyName?: string;
}

export function parseBuyNumber(body: unknown): BuyNumberInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.phoneNumber !== "string" || !b.phoneNumber.trim()) {
    throw new BadRequestError("phoneNumber is required");
  }
  const phoneNumber = safePhone(b.phoneNumber);
  if (!phoneNumber) {
    throw new BadRequestError("phoneNumber must be a valid phone number");
  }
  const friendlyName = typeof b.friendlyName === "string"
    ? b.friendlyName.trim().slice(0, 64)
    : "";
  return { phoneNumber, ...(friendlyName ? { friendlyName } : {}) };
}

/** REQ-920b — a main-account messaging service with a VERIFIED A2P campaign */
export interface HouseService {
  sid: string;
  friendlyName: string;
  usecase: string;
}
// ── REQ-920 — texting registration (A2P 10DLC) for a customer's line (ISV path) ──

/** the business's details, once — flat, so a refusal names the field the person typed into */
export interface A2pForm {
  legalName: string;
  /** 9 digits */
  ein: string;
  businessType: string;
  industry: string;
  website: string;
  socialUrls?: string;
  /** private | public | non-profit | government */
  companyType: string;
  stockExchange?: string;
  stockTicker?: string;
  repFirstName: string;
  repLastName: string;
  repEmail: string;
  /** E.164 */
  repPhone: string;
  repTitle: string;
  repPosition: string;
  street: string;
  city: string;
  /** two-letter state */
  region: string;
  postalCode: string;
  useCase: string;
  description: string;
  messageFlow: string;
  samples: string[];
  optInMessage: string;
  optOutMessage: string;
  helpMessage: string;
  hasEmbeddedLinks: boolean;
  hasEmbeddedPhone: boolean;
  optInKeywords: string[];
  optOutKeywords: string[];
  helpKeywords: string[];
}

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

export type A2pStep =
  | "primary"
  | "profile"
  | "trust_product"
  | "brand"
  | "service"
  | "campaign";

/** a refusal or a failing check, as Twilio worded it */
export interface A2pError {
  step: A2pStep;
  message: string;
  code?: number;
  /** the Twilio attribute an evaluation flagged (website_url, …) */
  field?: string;
}

/** stored in KV `comms_a2p` by line id, with every Twilio SID, so a walk resumes where it stopped */
export interface A2pRegistration {
  lineId: string;
  userId: string;
  subaccountSid: string;
  form: A2pForm;
  /** "<bundle sid>:<object sid>" for every assignment already made */
  assigned: string[];
  profileSid?: string;
  profileStatus?: string;
  profileSubmitted?: boolean;
  businessEndUserSid?: string;
  repEndUserSid?: string;
  addressSid?: string;
  addressDocSid?: string;
  primaryProfileSid?: string;
  /** REQ-920c: the platform's approved profile is not ISV-type, so the walk waits before the primary assignment */
  needsIsvPrimary?: boolean;
  trustProductSid?: string;
  trustProductStatus?: string;
  trustProductSubmitted?: boolean;
  messagingEndUserSid?: string;
  brandSid?: string;
  brandStatus?: string;
  brandFailureReason?: string;
  serviceSid?: string;
  numberInService?: boolean;
  campaignSid?: string;
  campaignStatus?: string;
  state: A2pState;
  errors: A2pError[];
  createdAt: string;
  updatedAt: string;
}

/** REQ-920d — the Systems card's word for it */
export type A2pSummary = "none" | "pending" | "registered" | "failed";
