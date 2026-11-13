import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { computeProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import { getWizardSpec } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import {
  draftOwesDetails,
  type ThreadStatus,
  threadStatus,
  type WizardStage,
} from "#quote-flow/chat-header.ts";

/** A conversation as the thread list shows it. */
export interface ConversationListItem extends AgentConversation {
  /** UX-14: the bound customer's name — titles the row. */
  customerName?: string;
  /** UX-14: the quote's job name — titles the row. */
  jobName?: string;
  /** REQ-369: the thread's one status — what the chat header says. */
  threadStatus: ThreadStatus;
  /** REQ-700 (cycle 5, m20): the bound invoice's LIVE status, read off the
   *  invoice row — not the conversation's stored copy. */
  invoiceStatus?: string;
}

/**
 * ListConversations — `GET /agents/conversations` (the thread list).
 *
 * REQ-369 (demo-loop cycle 1, demo issue m2): each row carries the thread's
 * status from the SAME rule the chat header applies (`threadStatus`,
 * shared/quote-flow/chat-header.ts), fed by what the server holds: the quote
 * ROW (acceptance, decline, delivery record, lockedAt — written by whoever
 * acted, the customer's public page included), the terms wizard's state, and
 * the assistant draft (REQ-230) for the end-of-wizard job-details pick still
 * owed. The list chip used to read the denormalized conv.quoteStatus /
 * currentPhase, which only some coordinators write and the public accept
 * never does — so it said "Quote sent" under a header saying "Quote
 * accepted", "Locked · ready to send" through the whole wizard, and "Terms".
 *
 * REQ-700 (demo-loop cycle 5, demo issue m20): the same for the bill. Each
 * row's `invoiceStatus` is the bound invoice ROW's status (conv.invoiceId),
 * not the denormalized conv.invoiceStatus that only assistant coordinators
 * write — a bill sent or paid on /invoices left the chip "Signed · Invoiced"
 * after the payment. The chat header reads the same value (LoadConversation).
 */
@Injectable()
export class ListConversations {
  constructor(
    private conversations: AgentConversationStore,
    private customers: CustomerStore,
    private quotes: QuoteStore,
    // REQ-700: optional so hand-built coordinators in older tests still run;
    // the app always injects it.
    private invoices?: InvoiceStore,
  ) {}

  async run(
    input: { userId: string; limit?: number },
  ): Promise<ConversationListItem[]> {
    const rows = await this.conversations.listByUser(input.userId, {
      limit: input.limit,
    });
    // UX-14: denormalize customerName + jobName so the thread list can title
    // each conversation by what it is about ("Patio · María Nguyen") instead
    // of a wall of "Nueva conversación" rows.
    const [customers, quotes, invoices] = await Promise.all([
      this.customers.listByUser(input.userId).catch(() => []),
      this.quotes.listByUser(input.userId).catch(() => []),
      this.invoices?.listByUser(input.userId).catch(() => null) ??
        Promise.resolve(null),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const quoteById = new Map(quotes.map((q) => [q.id, q]));
    const invoiceById = invoices
      ? new Map(invoices.map((i) => [i.id, i]))
      : null;
    return await Promise.all(rows.map(async (r) => {
      const customerName = r.customerId
        ? customerById.get(r.customerId)?.name
        : undefined;
      const quote = r.quoteId ? quoteById.get(r.quoteId) : undefined;
      const jobName = quote?.jobName;
      return {
        ...r,
        ...(customerName ? { customerName } : {}),
        ...(jobName ? { jobName } : {}),
        threadStatus: threadStatus({
          quote,
          ...await threadFlowOf(this.conversations, r),
        }),
        // REQ-700: the bill as it is now; a deleted bill has none.
        invoiceStatus: r.invoiceId && invoiceById
          ? invoiceById.get(r.invoiceId)?.status
          : r.invoiceStatus,
      };
    }));
  }
}

/** Where the terms wizard stands, and whether the end-of-wizard job-details
 *  pick is still owed — only a thread in the terms phase has either. Shared
 *  by the thread list and, REQ-698 (demo-loop cycle 5, m14), the dashboard's
 *  "ready to send" count, so both read the same thread status. */
export async function threadFlowOf(
  conversations: AgentConversationStore,
  conv: AgentConversation,
): Promise<{ wizard?: WizardStage; detailsPending?: boolean }> {
  if (conv.currentPhase !== "terms") return {};
  const [state, draft] = await Promise.all([
    conversations.getWizardState(conv.id),
    conversations.getDraft(conv.id),
  ]);
  let wizard: WizardStage | undefined;
  if (state) {
    try {
      wizard = computeProgress(getWizardSpec(state.specId), state).isComplete
        ? "done"
        : "asking";
    } catch { /* an unknown spec — leave the wizard unknown */ }
  }
  return {
    ...(wizard ? { wizard } : {}),
    detailsPending: draftOwesDetails(draft),
  };
}

/**
 * REQ-698 / REQ-760 (demo-loop cycle 5 + 5v2, m14): of these drafts, the ids
 * whose thread status is "readyToSend" — the terms wizard finished and no
 * job-details pick owed (the SAME rule as the chat header and the thread
 * list). One rule for the dashboard's `quotes.readyToSend` count and the
 * /quotes cards' `readyToSend` flag, so the two pages never disagree.
 */
export async function readyToSendQuoteIds(
  conversations: AgentConversationStore,
  userId: string,
  drafts: ReadonlyArray<Quote>,
): Promise<Set<string>> {
  if (drafts.length === 0) return new Set();
  const convs = await conversations.listByUser(userId, { limit: 500 })
    .catch(() => [] as AgentConversation[]);
  // listByUser is newest-first: the first thread naming a quote is its own
  const convByQuote = new Map<string, AgentConversation>();
  for (const c of convs) {
    if (c.quoteId && !convByQuote.has(c.quoteId)) convByQuote.set(c.quoteId, c);
  }
  const ready = await Promise.all(drafts.map(async (quote) => {
    const conv = convByQuote.get(quote.id);
    const flow = conv ? await threadFlowOf(conversations, conv) : {};
    return threadStatus({ quote, ...flow }) === "readyToSend";
  }));
  return new Set(drafts.filter((_, i) => ready[i]).map((q) => q.id));
}
