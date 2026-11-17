/**
 * REQ-570 (demo-loop cycle 4, issue m41): Send from the /quotes open panel.
 *
 * The panel knows a quote (and usually its customer), never a chat thread,
 * while the one customer dispatch — SendQuote, POST
 * /agents/conversations/:id/send-quote — runs on the conversation bound to
 * the quote (it checks conv.quoteId, stamps the outcome on the quote and
 * appends the "emailed to / texted to" divider to that thread). So the panel
 * finds the quote's own thread, or starts one bound to the quote and its
 * customer (StartConversation titles it by the job name), and sends there —
 * the exact call the assistant's send dialog makes.
 *
 * Pure: the network calls come in as deps (the island passes
 * assistantClient; the backend e2e passes fetch against the booted app).
 */
import { quoteBadgeStatus } from "../../shared/documents/versions.ts";
import {
  deliveryFromDivider,
  deliverySucceeded,
} from "../../shared/quote-flow/delivery.ts";
import {
  type SendDividerPayload,
  sendOutcomePayload,
} from "./send-delivery.ts";
import type { SendChannel } from "./send-dialog.ts";

/** Statuses whose quote the panel can (re)send. A draft is finished in the
 *  assistant (the terms wizard — REQ-686's "Finish & send" opens it); a signed or declined deal is closed (UX-02:
 *  no live re-send of the same agreement). */
const SENDABLE = new Set(["sent", "viewed", "revised"]);

type PanelQuote = {
  status?: string;
  acceptedAt?: string;
  sentAt?: string;
  version?: number;
  pendingRevision?: Record<string, unknown> | null;
  isSample?: boolean;
};

/**
 * REQ-686 (demo-loop cycle 5, m44 + m45): the panel's one send-shaped
 * action.
 *  - "finish": a draft — a primary "Finish & send" opens the quote's own
 *    thread, where the terms wizard / Ready-to-send card finish and send it.
 *  - "send": a sent/viewed/revised quote — the Send ▾ menu.
 *  - "none": a signed or lost quote, the onboarding sample, or a quote whose
 *    pending revision waits — "Publish revision and notify customer" is then
 *    the one primary (a send would publish that same revision, REQ-248).
 */
export function panelSendAction(q: PanelQuote): "send" | "finish" | "none" {
  if (q.isSample) return "none";
  const badge = quoteBadgeStatus(q);
  if (badge === "draft") return "finish";
  if (!SENDABLE.has(badge)) return "none";
  const pending = q.pendingRevision &&
    Object.keys(q.pendingRevision).length > 0;
  return pending ? "none" : "send";
}

export function panelCanSend(q: PanelQuote): boolean {
  return panelSendAction(q) === "send";
}

/** The assistant thread page for a conversation. */
export function assistantThreadPath(conversationId: string): string {
  return `/assistant/${encodeURIComponent(conversationId)}`;
}

/** REQ-686 (m44): where "Finish & send" goes — the quote's own thread
 *  (found, or started bound to the quote and its customer). */
export async function finishDraftPath(
  quoteId: string,
  customerId: string | undefined,
  deps: ThreadDeps,
): Promise<string> {
  return assistantThreadPath(
    await conversationForQuote(quoteId, customerId, deps),
  );
}

export interface ThreadDeps {
  /** Conversations newest first (GET /agents/conversations). */
  list: () => Promise<readonly { id: string; quoteId?: string | null }[]>;
  /** POST /agents/conversations — StartConversation. */
  start: (body: Record<string, unknown>) => Promise<{ id: string }>;
}

/** The newest thread bound to the quote, or a new one bound to it. */
export async function conversationForQuote(
  quoteId: string,
  customerId: string | undefined,
  deps: ThreadDeps,
): Promise<string> {
  type Row = { id: string; quoteId?: string | null };
  const rows: readonly Row[] = await deps.list().catch(() => []);
  const found = (Array.isArray(rows) ? rows : []).find((c) =>
    c?.quoteId === quoteId
  );
  if (found) return found.id;
  const conv = await deps.start({
    quoteId,
    ...(customerId ? { customerId } : {}),
  });
  return conv.id;
}

export interface PanelSendDeps extends ThreadDeps {
  /** assistantClient.sendQuoteFlow's signature. */
  send: (
    conversationId: string,
    quoteId: string,
    channel: SendChannel,
    language?: "en" | "es",
    requestId?: string,
  ) => Promise<{ newMessages?: { kind?: string; payload?: unknown }[] }>;
}

export interface PanelSendResult {
  conversationId: string;
  /** The SendQuote divider: emailedTo / textedTo / *FailureReason. */
  outcome: SendDividerPayload | undefined;
  /** REQ-236: a 200 is not a delivery — true only when a channel delivered. */
  delivered: boolean;
}

export async function sendFromQuotePanel(
  input: {
    quoteId: string;
    customerId?: string;
    channel: SendChannel;
    language?: "en" | "es";
    requestId: string;
  },
  deps: PanelSendDeps,
): Promise<PanelSendResult> {
  const conversationId = await conversationForQuote(
    input.quoteId,
    input.customerId,
    deps,
  );
  const res = await deps.send(
    conversationId,
    input.quoteId,
    input.channel,
    input.language,
    input.requestId,
  );
  const outcome = sendOutcomePayload(res?.newMessages);
  return {
    conversationId,
    outcome,
    delivered: deliverySucceeded(deliveryFromDivider(outcome ?? undefined)),
  };
}
