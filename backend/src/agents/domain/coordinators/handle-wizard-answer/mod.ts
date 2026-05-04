import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { applyAnswer, computeProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { WizardState } from "@agents/dto/wizard.ts";

export interface WizardAnswerInput {
  userId: string;
  conversationId: string;
  stepId: string;
  optionId: string;
  customValue?: string;
  /** Customer-step payload (only meaningful when stepId === "customer"). */
  customer?: { id?: string; create?: { name: string; email?: string; phoneNumber?: string; isBusiness?: boolean } };
}

export interface WizardAnswerResult {
  conversation: AgentConversation;
  wizardState: WizardState;
  /**
   * The two messages appended this turn:
   *   - user "pick" message (text summary like "Config: Standard residential")
   *   - assistant message — either the next wizard step OR a continue_cta
   *     when all 10 steps are complete.
   */
  newMessages: AgentMessage[];
}

/**
 * HandleWizardAnswer — the phase-2 turn handler.
 *
 *   1. Validate ownership + that the conversation is in 'terms'.
 *   2. Look up current wizard state.
 *   3. Apply the answer (pure function, throws on out-of-order or unknown opt).
 *   4. Persist new wizard state.
 *   5. Append a `text` message representing the user's pick (so the chat
 *      transcript reads naturally and the prior wizard message can fade
 *      out client-side into a completed-step chip).
 *   6. If wizard not done: append the next step's wizard message.
 *      If wizard done: append a continue_cta to "Send to client".
 */
@Injectable()
export class HandleWizardAnswer {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private contracts: ContractStore,
    private customers: CustomerStore,
    private bus: EventBus,
  ) {}

  async run(input: WizardAnswerInput): Promise<WizardAnswerResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.currentPhase !== "terms") throw new Error("conversation is not in 'terms' phase");

    const current = await this.conversations.getWizardState(input.conversationId);
    if (!current) throw new Error("wizard state missing — call transition-to-terms first");

    // Customer step needs special handling: the wizard option `create_new`
    // is `isCustom: true` but the frontend sends a structured `customer.create`
    // payload (name/email/phone) instead of a free-text customValue. We
    // materialize the customer / pick the existing one HERE, bind it onto
    // the conversation, and synthesize a customValue (the customer's name)
    // so the generic applyAnswer step doesn't reject it.
    let customerCustomValue = input.customValue;
    let boundCustomerId = conv.customerId;
    let boundCustomerName: string | undefined;
    if (input.stepId === "customer") {
      const handled = await this.handleCustomerStep(conv.id, input);
      boundCustomerId = handled.customerId ?? boundCustomerId;
      boundCustomerName = handled.customerName;
      customerCustomValue = handled.customValue ?? customerCustomValue;
    }

    const next = applyAnswer(CONTRACT_TERMS_WIZARD_V1, current, {
      stepId: input.stepId,
      optionId: input.optionId,
      customValue: customerCustomValue,
    });
    await this.conversations.putWizardState(input.conversationId, next);

    const stepDef = CONTRACT_TERMS_WIZARD_V1.steps.find((s) => s.id === input.stepId)!;
    const optionDef = stepDef.options.find((o) => o.id === input.optionId)!;
    // For the customer step, prefer the resolved customer's name so the
    // chat transcript reads "Customer: Jane Doe" rather than "Customer:
    // Create a new customer".
    const pickValue = input.stepId === "customer" && boundCustomerName
      ? boundCustomerName
      : optionDef.isCustom ? (customerCustomValue ?? "Custom") : optionDef.label;

    const userPick = await this.messages.append({
      conversationId: input.conversationId,
      role: "user",
      kind: "text",
      content: `${stepDef.label}: ${pickValue}`,
      payload: { wizardStepId: input.stepId, optionId: input.optionId, customValue: input.customValue },
    });

    const newMessages: AgentMessage[] = [userPick];
    const progress = computeProgress(CONTRACT_TERMS_WIZARD_V1, next);

    let convPatch: Partial<AgentConversation> = { preview: `${stepDef.label}: ${pickValue}` };
    if (input.stepId === "customer" && boundCustomerId && boundCustomerId !== conv.customerId) {
      convPatch.customerId = boundCustomerId;
    }

    if (progress.isComplete) {
      // Materialize a real Contract row from the conversation's active quote
      // + collected wizard answers. Best-effort: if conv.quoteId is missing
      // or the quote can't be loaded, we still surface the CTA — the user
      // can pick a quote manually before sending.
      const contractId = await this.finalizeContract(conv);
      if (contractId) convPatch.contractId = contractId;

      const cta = await this.messages.append({
        conversationId: input.conversationId,
        role: "assistant",
        kind: "continue_cta",
        content: "Ready to send",
        payload: {
          toPhase: "send",
          summary: "All terms answered. Review and send to your client.",
          ...(contractId ? { contractId } : {}),
        },
      });
      newMessages.push(cta);
    } else {
      const step = progress.activeStep!;
      const wizardMsg = await this.messages.append({
        conversationId: input.conversationId,
        role: "assistant",
        kind: "wizard",
        content: step.question,
        payload: { specId: CONTRACT_TERMS_WIZARD_V1.id, stepIdx: next.activeStepIdx, stepId: step.id, options: step.options, hint: step.hint },
      });
      newMessages.push(wizardMsg);
    }

    const updatedConv = await this.conversations.update(input.conversationId, convPatch);
    return { conversation: updatedConv, wizardState: next, newMessages };
  }

  /**
   * Resolve the customer step's three flavors:
   *   - use_active     → reuse conv.customerId (no-op).
   *   - pick_existing  → verify ownership of `customer.id`, return it.
   *   - create_new     → create a Customer from `customer.create`, return new id.
   *
   * Returns the resolved id (or undefined for use_active when conv has no
   * bound customer), the customer's display name (for the chat transcript),
   * and a synthetic customValue so applyAnswer doesn't reject the
   * isCustom create_new option.
   */
  private async handleCustomerStep(
    _conversationId: string,
    input: WizardAnswerInput,
  ): Promise<{ customerId?: string; customerName?: string; customValue?: string }> {
    if (input.optionId === "create_new") {
      // Prefer the structured customer.create payload; fall back to a
      // legacy name-only customValue path so older callers that only
      // pass `customValue: "<name>"` still work.
      const create = input.customer?.create;
      const name = (create?.name ?? input.customValue ?? "").trim();
      if (!name) {
        throw new Error("create_new requires customer.create.name (or customValue)");
      }
      const created = await this.customers.create(input.userId, {
        name,
        ...(create?.email ? { email: create.email.trim() } : {}),
        ...(create?.phoneNumber ? { phoneNumber: create.phoneNumber.trim() } : {}),
        ...(typeof create?.isBusiness === "boolean" ? { isBusiness: create.isBusiness } : {}),
      });
      return { customerId: created.id, customerName: created.name, customValue: created.name };
    }
    if (input.optionId === "pick_existing") {
      const id = input.customer?.id;
      if (typeof id !== "string" || !id) {
        throw new Error("pick_existing requires customer.id");
      }
      const existing = await this.customers.getOwned(id, input.userId);
      return { customerId: existing.id, customerName: existing.name };
    }
    // use_active — no work needed; coordinator falls back to conv.customerId.
    return {};
  }

  /**
   * Create a Contract row when the wizard hits 10/10. Returns the new
   * (or existing) contract id, or `undefined` if no quote was bound and
   * we couldn't materialize one. Idempotent: if conv.contractId already
   * points at a real contract, reuse it.
   */
  private async finalizeContract(conv: AgentConversation): Promise<string | undefined> {
    // Walk the conversation messages and project the user's wizard picks
    // into a labeled terms array. Each pick lives on a `text` user message
    // with payload.wizardStepId — the chat transcript is the canonical
    // record. We snapshot it onto the contract so the public page can
    // render the agreed terms without re-loading the conversation.
    const terms = await this.captureTerms(conv.id);

    if (conv.contractId) {
      try {
        const existing = await this.contracts.getOwned(conv.contractId, conv.userId);
        // If terms aren't already persisted, patch them in. Idempotent on
        // re-runs (same picks → same terms).
        if (!Array.isArray(existing.terms) || existing.terms.length === 0) {
          if (terms.length) {
            await this.contracts.update(conv.contractId, conv.userId, { terms });
          }
        }
        return conv.contractId;                  // already finalized — keep it
      } catch { /* fall through and try to recreate */ }
    }
    if (!conv.quoteId) {
      console.error(`[wizard:finalize] conversation ${conv.id} has no quoteId — skipping contract creation`);
      return undefined;
    }
    let totalAmount: number | undefined;
    try {
      const quote = await this.quotes.getOwned(conv.quoteId, conv.userId);
      totalAmount = quote.estimatedTotal;
    } catch (err) {
      console.error(`[wizard:finalize] failed to load quote ${conv.quoteId}:`, err);
      return undefined;
    }
    const contract = await this.contracts.create(conv.userId, {
      quoteId: conv.quoteId,
      ...(conv.customerId ? { customerId: conv.customerId } : {}),
      status: "draft",
      ...(typeof totalAmount === "number" ? { totalAmount } : {}),
      ...(terms.length ? { terms } : {}),
    });
    await this.bus.emit({
      userId: conv.userId,
      entityType: "contract",
      entityId: contract.id,
      action: "drafted",
      data: { quoteId: conv.quoteId, customerId: conv.customerId },
    });
    return contract.id;
  }

  /** Project wizard-answer chat messages into a labeled terms array. */
  private async captureTerms(conversationId: string): Promise<{ stepId: string; label: string; value: string }[]> {
    const msgs = await this.messages.listByConversation(conversationId);
    const picks: { stepId: string; label: string; value: string }[] = [];
    const seen = new Set<string>();
    for (const m of msgs) {
      if (m.role !== "user" || m.kind !== "text") continue;
      const p = m.payload as { wizardStepId?: string } | undefined;
      const stepId = p?.wizardStepId;
      if (!stepId || seen.has(stepId)) continue;
      seen.add(stepId);
      // The user-pick message content reads "Label: Value" — split on the
      // first colon to peel them apart safely.
      const raw = m.content ?? "";
      const idx = raw.indexOf(":");
      const label = idx >= 0 ? raw.slice(0, idx).trim() : stepId;
      const value = idx >= 0 ? raw.slice(idx + 1).trim() : raw.trim();
      if (!value) continue;
      picks.push({ stepId, label, value });
    }
    return picks;
  }
}
