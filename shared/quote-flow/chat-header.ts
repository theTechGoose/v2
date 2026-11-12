/**
 * REQ-245 (demo issue quote-invoice-money-m6) — what the assistant chat
 * header says: whose thread it is, and where the quote really is.
 *
 * The header used to be read off chat artifacts in a fixed order (the last
 * phase_divider's phase, then the last action_card's status). That lied in
 * three ways the demo saw:
 *   (a) the terms wizard ends with a `continue_cta` (toPhase "send"), never
 *       a new divider, so the phase-2 divider kept the header on
 *       "Gathering a little more info" with the finished draft open;
 *   (b) Lock flipped the quote and its card to "sent", so the header said
 *       "Quote sent" / "Out for signature" before anything was sent;
 *   (c) the price flow never emits an action_card, so a thread with a quote
 *       was still titled "New conversation".
 *
 * This derives it from the quote's lifecycle (the row the client fetches)
 * and the server's persisted send record (SendQuote's phase-3 divider,
 * which carries who it reached), in this order:
 *   accepted → sent (delivered: "Out for signature" / reached nobody:
 *   "Not delivered") → in the terms wizard ("Gathering a little more info")
 *   → wizard done ("Ready to send") → locked ("Quote locked") → drafted.
 *
 * REQ-369 (demo-loop cycle 1, demo issue m2): that precedence is now THE
 * status of an assistant thread — `threadStatus` — and every surface names
 * it with `threadStatusKey`, the same words: this header, the conversation
 * list's chip (`threadChip`, computed by the server from the quote row in
 * GET /agents/conversations) and the quote cards in the chat. The list used
 * to read the denormalized conv.quoteStatus / currentPhase (never touched by
 * the customer's public accept) and the cards their append-time status, so
 * the demo saw "Quote accepted" over "Quote sent", "Locked · ready to send"
 * against "Drafting", and a "Terms" chip. The quote ROW leads (acceptance,
 * decline, its REQ-236 delivery record, lockedAt); the chat's transcript only
 * fills in what a row it has not re-fetched yet cannot say; the terms wizard
 * comes from the transcript (chat) or the wizard state (server); and the
 * end-of-wizard job-details pick still owed reads "Picking job details", not
 * "Ready to send".
 */
import {
  deliveryFromDivider,
  deliverySucceeded,
  isUndelivered,
  type QuoteDelivery,
} from "./delivery.ts";

/** A chat message, as much of it as the header reads. */
export interface ChatHeaderMessage {
  kind?: string;
  payload?: unknown;
}

/** The quote row, as much of it as the header reads. */
export interface ChatHeaderQuote {
  status?: string | null;
  acceptedAt?: string | null;
  sentAt?: string | null;
  /** REQ-234: stamped when the price is locked (locking is not sending). */
  lockedAt?: string | null;
  jobName?: string | null;
  /** Wizard-captured terms — present once the terms wizard finished. */
  terms?: readonly unknown[] | null;
  /** REQ-369: the customer declined (status "lost"). */
  lostAt?: string | null;
  /** REQ-236: the latest send's outcome, and the first time one delivered. */
  lastDelivery?: QuoteDelivery | null;
  deliveredAt?: string | null;
}

export interface ChatHeaderInput {
  customerName?: string | null;
  quote?: ChatHeaderQuote | null;
  messages: readonly ChatHeaderMessage[];
  /** REQ-369: the end-of-wizard job-details pick is still owed. */
  detailsPending?: boolean;
}

export interface ChatHeader {
  /** A literal title (the customer's name, else the quote's job name). */
  clientName?: string;
  /** An i18n key for the title when there is no name to show. */
  clientKey?: string;
  /** The i18n key of the status line. */
  statusKey: string;
  /** REQ-369: the thread's one status — the list chip and the cards too. */
  status: ThreadStatus;
}

const K = "asstChat.header.";

/** REQ-327: how the status line should look — "bad" paints the header's dot
 *  and sub-line red instead of the default green. */
export type HeaderTone = "ok" | "bad";

/** The tone of a header status key: only "Not delivered" is bad. */
export function headerTone(statusKey: string): HeaderTone {
  return statusKey === `${K}notDelivered` ? "bad" : "ok";
}
const ACCEPTED = new Set(["accepted", "signed", "won"]);
const ISSUED = new Set(["sent", "viewed", "opened"]);

type Payload = Record<string, unknown> | undefined;
const payloadOf = (m: ChatHeaderMessage): Payload =>
  (m.payload && typeof m.payload === "object")
    ? m.payload as Record<string, unknown>
    : undefined;

const phaseOf = (m: ChatHeaderMessage): number | undefined =>
  m.kind === "phase_divider"
    ? payloadOf(m)?.phase as number | undefined
    : undefined;

function isQuoteCard(m: ChatHeaderMessage): boolean {
  if (m.kind !== "action_card") return false;
  const t = payloadOf(m)?.actionType;
  return t === "quote" || t == null;
}

const lower = (s: unknown): string =>
  typeof s === "string" ? s.toLowerCase() : "";

const DECLINED = new Set(["lost", "declined", "void"]);

/** REQ-369: where the terms wizard stands — "asking" while a question is
 *  open, "done" once it finished. */
export type WizardStage = "asking" | "done";

/** Where the terms wizard stands, read off the transcript: the latest of
 *  "a phase-2 divider" (asking) and "a continue_cta to send" (finished)
 *  decides. */
function wizardStage(
  messages: readonly ChatHeaderMessage[],
): WizardStage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === "continue_cta" && payloadOf(m)?.toPhase === "send") {
      return "done";
    }
    if (phaseOf(m) === 2) return "asking";
  }
  return undefined;
}

/** REQ-369: every status an assistant thread's quote can be in. */
export const THREAD_STATUSES = [
  "none",
  "drafted",
  "locked",
  "gathering",
  "pickingDetails",
  "readyToSend",
  "undelivered",
  "sent",
  "declined",
  "accepted",
] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export interface ThreadStatusInput {
  /** The quote row — it leads. */
  quote?: ChatHeaderQuote | null;
  /** The chat's transcript; the server's list has none. */
  messages?: readonly ChatHeaderMessage[];
  /** Where the terms wizard stands. Omitted: read off the transcript (the
   *  server passes its wizard state instead). */
  wizard?: WizardStage;
  /** The end-of-wizard job-details pick is still owed (the "I know my
   *  price" flow's polish marker / the assistant draft's `polishRaw`). */
  detailsPending?: boolean;
}

/** What only the chat's transcript can tell — newest first. */
interface Transcript {
  /** The newest phase_divider's phase (4 = AcceptQuote's). */
  lastPhase?: number;
  /** REQ-245: the newest phase-3 divider's outcome — SendQuote's record. */
  sendRecord?: "sent" | "undelivered";
  /** REQ-236: the newest phase_divider, when it is a send naming its quote:
   *  did it reach anyone? */
  lastDividerSend?: "delivered" | "failed";
  /** The newest quote action_card's status. */
  lastCardStatus: string;
  hasCard: boolean;
}

function readTranscript(messages: readonly ChatHeaderMessage[]): Transcript {
  const t: Transcript = { lastCardStatus: "", hasCard: false };
  let sawDivider = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!t.hasCard && isQuoteCard(m)) {
      t.hasCard = true;
      t.lastCardStatus = lower(payloadOf(m)?.status);
    }
    if (m.kind !== "phase_divider") continue;
    const p = payloadOf(m);
    if (!sawDivider) {
      sawDivider = true;
      const d = deliveryFromDivider(p);
      if (d) t.lastDividerSend = deliverySucceeded(d) ? "delivered" : "failed";
    }
    const phase = phaseOf(m);
    if (phase == null) continue;
    if (t.lastPhase == null) t.lastPhase = phase;
    if (phase === 3 && !t.sendRecord) {
      t.sendRecord = p?.emailedTo || p?.textedTo ? "sent" : "undelivered";
    }
  }
  return t;
}

/**
 * REQ-369 — THE status of an assistant thread's quote, for every surface.
 *
 * Precedence: the customer signed → declined → a send that reached nobody
 * (REQ-236: the row's record, or the chat's newest divider when the row has
 * not caught up) → out for signature (opened, delivered once, the chat's send
 * record, an issued row) → the terms wizard asking → finished: the
 * job-details pick still owed, else ready to send → locked → drafted → none.
 */
export function threadStatus(input: ThreadStatusInput): ThreadStatus {
  const q = input.quote ?? undefined;
  const messages = input.messages ?? [];
  const status = lower(q?.status);
  const t = readTranscript(messages);

  if (
    ACCEPTED.has(status) || Boolean(q?.acceptedAt) || t.lastPhase === 4 ||
    ACCEPTED.has(t.lastCardStatus)
  ) {
    return "accepted";
  }
  if (DECLINED.has(status) || Boolean(q?.lostAt)) return "declined";

  // REQ-236: the newest attempt reached nobody and none ever did — unless
  // the chat's newest divider is a good send the row has not caught up with.
  if (
    (t.lastDividerSend === "failed" && !q?.deliveredAt) ||
    (q && isUndelivered({
      lastDelivery: q.lastDelivery,
      deliveredAt: q.deliveredAt,
    }) && t.lastDividerSend !== "delivered")
  ) {
    return "undelivered";
  }

  // The customer opened it — it reached them, whatever the chat says.
  if (status === "viewed" || status === "opened") return "sent";
  if (
    q?.deliveredAt || deliverySucceeded(q?.lastDelivery) ||
    t.lastDividerSend === "delivered"
  ) {
    return "sent";
  }
  // A row with no delivery record of its own: SendQuote's divider decides.
  if (t.sendRecord && !q?.lastDelivery) return t.sendRecord;
  // A quote action_card only ever says "sent" when a pre-REQ-234 Lock
  // emitted it: with no send record, a "sent" quote behind it was locked.
  if (ISSUED.has(status) && t.lastCardStatus !== "sent") return "sent";

  const wizard = input.wizard ?? wizardStage(messages);
  if (wizard === "asking") return "gathering";
  if (wizard === "done" || (q?.terms?.length ?? 0) > 0) {
    return input.detailsPending ? "pickingDetails" : "readyToSend";
  }
  if (
    t.lastCardStatus === "sent" || t.lastCardStatus === "locked" ||
    Boolean(q?.lockedAt)
  ) {
    return "locked";
  }
  if (q || t.hasCard) return "drafted";
  return "none";
}

const STATUS_KEY: Record<ThreadStatus, string> = {
  none: `${K}default`,
  drafted: `${K}quoteDrafted`,
  locked: `${K}quoteLocked`,
  gathering: `${K}gatheringInfo`,
  pickingDetails: `${K}pickingDetails`,
  readyToSend: `${K}readyToSend`,
  undelivered: `${K}notDelivered`,
  sent: `${K}outForSignature`,
  declined: `${K}quoteDeclined`,
  accepted: `${K}quoteAccepted`,
};

/** REQ-369: the one i18n key a status is named by — the header, the list
 *  chip and the quote cards all say these words. */
export function threadStatusKey(status: ThreadStatus): string {
  return STATUS_KEY[status] ?? STATUS_KEY.none;
}

/** The conversation list's chip colours (assistant-page.css). */
export type ThreadChipKind = "draft" | "needs" | "sent" | "paid";

/**
 * REQ-369: the conversation list's chip — the thread's status in the
 * header's words; "Drafting" before there is a quote; and, past the quote,
 * the bill (the header is about the quote; the list also follows the
 * invoice the signature created).
 */
export function threadChip(
  status: ThreadStatus | null | undefined,
  invoiceStatus?: string | null,
): { kind: ThreadChipKind; key: string } {
  if (invoiceStatus === "paid") return { kind: "paid", key: "status.paid" };
  if (invoiceStatus === "sent") {
    return { kind: "sent", key: "asstThreads.chip.invoiced" };
  }
  if (!status || !(status in STATUS_KEY) || status === "none") {
    return { kind: "draft", key: "asstThreads.chip.drafting" };
  }
  const kind: ThreadChipKind = status === "accepted"
    ? "paid"
    : status === "sent"
    ? "sent"
    : status === "drafted"
    ? "draft"
    : "needs";
  return { kind, key: STATUS_KEY[status] };
}

export function deriveChatHeader(input: ChatHeaderInput): ChatHeader {
  const { quote, messages } = input;
  const status = threadStatus(input);
  const statusKey = threadStatusKey(status);
  const name = input.customerName?.trim() || quote?.jobName?.trim();
  if (name) return { clientName: name, statusKey, status };
  return {
    clientKey: quote || messages.some(isQuoteCard)
      ? `${K}conversation`
      : `${K}newConversation`,
    statusKey,
    status,
  };
}
