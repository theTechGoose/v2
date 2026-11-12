/**
 * REQ-236 (demo M8): the chat's reading of a quote send's outcome.
 *
 * SendQuote answers every Send with a `phase_divider` naming the quote and
 * where it went (`emailedTo` / `textedTo`) or why it didn't
 * (`emailFailureReason` / `smsFailureReason`), and stores the same outcome
 * on the quote (`lastDelivery`, `deliveredAt`). These helpers keep the
 * header, the local quote state and the recovery form honest about it: a
 * send that reached nobody is never "sent".
 */
import {
  deliveryFromDivider,
  deliverySucceeded,
  isUndelivered,
  type QuoteDelivery,
} from "../../shared/quote-flow/delivery.ts";
import { smsRecoveryAsk } from "../../shared/quote-flow/sms-failure.ts";
import { QUOTE_LOCKED } from "../../shared/quote-flow/quote-lock.ts";

export type SendDividerPayload = {
  phase?: number;
  quoteId?: string;
  channel?: "email" | "sms" | "both";
  emailedTo?: string;
  textedTo?: string;
  emailFailureReason?: string;
  smsFailureReason?: string;
  /** REQ-226 — why the text failed, as a code (never parse the reason) */
  smsFailureCode?: string;
  [k: string]: unknown;
};

/** A send divider whose dispatch reached nobody. Wizard dividers → false. */
export function sendDividerFailed(
  p: SendDividerPayload | null | undefined,
): boolean {
  const d = deliveryFromDivider(p ?? undefined);
  return !!d && !deliverySucceeded(d);
}

/** A send divider is one SendQuote wrote (it names its quote and carries an
 *  outcome); wizard phase dividers are not. */
function isSendDivider(p: SendDividerPayload | null | undefined): boolean {
  return !!deliveryFromDivider(p ?? undefined);
}

/** Whether this divider's failure is one the inline contact form can fix. */
export function dividerNeedsRecovery(
  p: SendDividerPayload,
  customer: { email?: string; phoneNumber?: string } | null | undefined,
): boolean {
  const emailMissing = !p.emailedTo && !!p.emailFailureReason &&
    !customer?.email;
  // REQ-226: the structured code decides, never the reason text.
  const phoneMissing = !!smsRecoveryAsk(p, customer?.phoneNumber);
  return emailMissing || phoneMissing;
}

/**
 * The divider that carries the contact-recovery form: the NEWEST send
 * divider, and only when it needs recovery. A newer successful send retires
 * every older failure — its form (and its stale "invalid number" reason)
 * must not re-attach after a good resend. An accepted quote carries none.
 */
export function lastRecoveryDividerId(
  messages: readonly { id: string; kind?: string; payload?: unknown }[],
  customer: { email?: string; phoneNumber?: string } | null | undefined,
  opts: { accepted?: boolean } = {},
): string | undefined {
  // REQ-403 (m11): once the customer signed, the deal is done — a stale
  // "that number can't receive texts" form is not a next step any more.
  if (opts.accepted) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind !== "phase_divider") continue;
    const p = (m.payload ?? {}) as SendDividerPayload;
    if (!isSendDivider(p)) continue;
    return dividerNeedsRecovery(p, customer) ? m.id : undefined;
  }
  return undefined;
}

/**
 * Patch the local quote with a send's outcome. Status flips to "sent" ONLY
 * when a channel delivered; a failure just records `lastDelivery`.
 */
export function applySendOutcome<
  Q extends {
    status?: string;
    lastDelivery?: QuoteDelivery;
    deliveredAt?: string;
  },
>(q: Q, divider: SendDividerPayload | null | undefined): Q {
  const d = deliveryFromDivider(divider ?? undefined);
  if (!d) return q;
  if (!deliverySucceeded(d)) return { ...q, lastDelivery: d };
  const keepStatus = q.status && q.status !== "draft";
  return {
    ...q,
    lastDelivery: d,
    deliveredAt: q.deliveredAt ?? d.at,
    status: keepStatus ? q.status : "sent",
  };
}

export type HeaderStatusKey =
  | "asstChat.header.default"
  | "asstChat.header.quoteAccepted"
  | "asstChat.header.notDelivered"
  | "asstChat.header.outForSignature"
  | "asstChat.header.quoteSent"
  | "asstChat.header.gatheringInfo"
  | "asstChat.header.lockedAddingTerms"
  | "asstChat.header.quoteLocked"
  | "asstChat.header.quoteDrafted";

/**
 * The chat header's status line. Acceptance outranks everything; then a
 * send that reached nobody ("Not delivered") outranks every "sent" reading —
 * a pre-REQ-234 quote's status "sent", the phase-3 divider, the action card.
 */
export function headerStatusKey(i: {
  quoteAccepted: boolean;
  quote:
    | {
      status?: string;
      lastDelivery?: QuoteDelivery;
      deliveredAt?: string;
    }
    | undefined;
  lastDividerPayload: SendDividerPayload | undefined;
  lastCardStatus: string | undefined;
  hasQuoteCard: boolean;
}): HeaderStatusKey {
  const dividerPhase = i.lastDividerPayload?.phase;
  if (i.quoteAccepted || dividerPhase === 4) {
    return "asstChat.header.quoteAccepted";
  }
  const lastSendFailed = sendDividerFailed(i.lastDividerPayload);
  if (
    (lastSendFailed && !i.quote?.deliveredAt) ||
    (i.quote && isUndelivered(i.quote) &&
      !(isSendDivider(i.lastDividerPayload) && !lastSendFailed))
  ) {
    return "asstChat.header.notDelivered";
  }
  if (i.quote?.status === "sent" || i.quote?.status === "viewed") {
    return "asstChat.header.outForSignature";
  }
  if (dividerPhase === 3) return "asstChat.header.quoteSent";
  if (dividerPhase === 2) {
    // REQ-454 (cycle 3, m34): the wizard after a lock reads forward.
    return i.lastCardStatus === QUOTE_LOCKED || i.lastCardStatus === "sent"
      ? "asstChat.header.lockedAddingTerms"
      : "asstChat.header.gatheringInfo";
  }
  if (i.lastCardStatus === "accepted") return "asstChat.header.quoteAccepted";
  if (i.lastCardStatus === "sent") return "asstChat.header.quoteSent";
  // REQ-234: locked is not sent — the quote is ready to send.
  if (i.lastCardStatus === QUOTE_LOCKED) return "asstChat.header.quoteLocked";
  if (i.hasQuoteCard) return "asstChat.header.quoteDrafted";
  return "asstChat.header.default";
}

/** The send divider among the messages a Send call returned. */
export function sendOutcomePayload(
  messages: readonly { kind?: string; payload?: unknown }[] | undefined,
): SendDividerPayload | undefined {
  const m = (messages ?? []).find((x) =>
    x.kind === "phase_divider" &&
    isSendDivider(x.payload as SendDividerPayload | undefined)
  );
  return m?.payload as SendDividerPayload | undefined;
}
