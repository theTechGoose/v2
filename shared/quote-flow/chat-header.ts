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
 */

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
}

export interface ChatHeaderInput {
  customerName?: string | null;
  quote?: ChatHeaderQuote | null;
  messages: readonly ChatHeaderMessage[];
}

export interface ChatHeader {
  /** A literal title (the customer's name, else the quote's job name). */
  clientName?: string;
  /** An i18n key for the title when there is no name to show. */
  clientKey?: string;
  /** The i18n key of the status line. */
  statusKey: string;
}

const K = "asstChat.header.";
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

/** Where the terms wizard stands: the latest of "a phase-2 divider" (asking)
 *  and "a continue_cta to send" (finished) decides. */
function wizardStage(
  messages: readonly ChatHeaderMessage[],
): "asking" | "done" | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === "continue_cta" && payloadOf(m)?.toPhase === "send") {
      return "done";
    }
    if (phaseOf(m) === 2) return "asking";
  }
  return undefined;
}

export function deriveChatHeader(input: ChatHeaderInput): ChatHeader {
  const { quote, messages } = input;
  const qStatus = lower(quote?.status);

  const cards = messages.filter(isQuoteCard);
  const lastCardStatus = lower(
    cards.length ? payloadOf(cards[cards.length - 1])?.status : undefined,
  );
  let lastPhase: number | undefined;
  let sendRecord: Payload;
  for (let i = messages.length - 1; i >= 0; i--) {
    const p = phaseOf(messages[i]);
    if (p == null) continue;
    if (lastPhase == null) lastPhase = p;
    if (p === 3 && !sendRecord) sendRecord = payloadOf(messages[i]) ?? {};
    if (lastPhase != null && sendRecord) break;
  }

  const statusKey = ((): string => {
    if (
      ACCEPTED.has(qStatus) || Boolean(quote?.acceptedAt) || lastPhase === 4 ||
      ACCEPTED.has(lastCardStatus)
    ) {
      return `${K}quoteAccepted`;
    }
    // The customer opened it — it reached them, whatever the chat says.
    if (qStatus === "viewed" || qStatus === "opened") {
      return `${K}outForSignature`;
    }
    // SendQuote's record of the dispatch: who it reached, if anyone.
    if (sendRecord) {
      return sendRecord.emailedTo || sendRecord.textedTo
        ? `${K}outForSignature`
        : `${K}notDelivered`;
    }
    // A quote action_card only ever says "sent" when Lock emitted it (Lock
    // used to flip the quote to "sent"; REQ-234 makes it "locked"). With no
    // send record, a "sent" quote behind such a card was locked, not sent.
    const lockCard = lastCardStatus === "sent" || lastCardStatus === "locked";
    if (ISSUED.has(qStatus) && lastCardStatus !== "sent") {
      return `${K}outForSignature`;
    }

    const stage = wizardStage(messages);
    if (stage === "asking") return `${K}gatheringInfo`;
    if (stage === "done" || (quote?.terms?.length ?? 0) > 0) {
      return `${K}readyToSend`;
    }
    if (lockCard || Boolean(quote?.lockedAt)) return `${K}quoteLocked`;
    if (quote || cards.length) return `${K}quoteDrafted`;
    return `${K}default`;
  })();

  const name = input.customerName?.trim() || quote?.jobName?.trim();
  if (name) return { clientName: name, statusKey };
  return {
    clientKey: quote || cards.length
      ? `${K}conversation`
      : `${K}newConversation`,
    statusKey,
  };
}
