import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { computeProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import { getWizardSpec } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
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
 */
@Injectable()
export class ListConversations {
  constructor(
    private conversations: AgentConversationStore,
    private customers: CustomerStore,
    private quotes: QuoteStore,
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
    const [customers, quotes] = await Promise.all([
      this.customers.listByUser(input.userId).catch(() => []),
      this.quotes.listByUser(input.userId).catch(() => []),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const quoteById = new Map(quotes.map((q) => [q.id, q]));
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
