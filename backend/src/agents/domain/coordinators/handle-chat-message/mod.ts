import { Inject, Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import type { LLMClient, LLMTurn } from "@agents/domain/llm/mod.ts";
import { LLM_CLIENT } from "@agents/domain/llm/token.ts";
import { SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS } from "@agents/domain/llm/openai/prompts.ts";
import { isInQuotePhase } from "@agents/domain/business/derive-phase/mod.ts";
import { deriveTitleFromFirstUserMessage, derivePreview } from "@agents/domain/business/conversation-title/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EventBus } from "@core/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface HandleChatInput {
  userId: string;
  conversationId: string;
  content: string;
  /** 'voice' adds a transcript marker on the user message; payload (fileId etc.) is set by the controller layer. */
  kind?: "text" | "voice";
}

export interface HandleChatResult {
  conversation: AgentConversation;
  /** New messages appended this turn — typically [user, assistant], plus action-cards/continue-cta when the LLM emits actions. */
  newMessages: AgentMessage[];
}

/**
 * HandleChatMessage — the phase-1 turn handler.
 *
 *   1. Append user message.
 *   2. Build the LLM request: history + phase-aware system prompt.
 *   3. Call LLMClient.respond.
 *   4. Append assistant text reply.
 *   5. If the LLM returned a structured action, EXECUTE it against the
 *      paperwork store (real Quote rows get created/locked) AND surface
 *      the result as an action_card / continue_cta in the chat.
 *   6. Update conversation title (first message only) and preview.
 *
 * Action handling rules:
 *   - create_quote: create a real Quote in the QuoteStore, render an
 *     action_card carrying the real quote id, set conv.quoteId so the
 *     next turn's lock_quote knows what to lock.
 *   - lock_quote: ignore the LLM-supplied quoteId and use conv.quoteId
 *     (the coordinator is ground truth, not the model). Flip the quote's
 *     status to 'sent'. Emit a domain event so notifications fan out.
 *   - request_terms_transition: emit a continue_cta the user clicks to
 *     advance phases.
 *
 * In phase 'terms' the chat coordinator is still callable — the user can
 * type free-form even mid-wizard — but SYSTEM_PROMPT_TERMS keeps the LLM
 * from emitting create/lock actions.
 */
@Injectable()
export class HandleChatMessage {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private bus: EventBus,
    private emailer: SendPaperworkEmail,
    @Inject(LLM_CLIENT) private llm: LLMClient,
  ) {}

  async run(input: HandleChatInput): Promise<HandleChatResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");

    const userMsg = await this.messages.append({
      conversationId: conv.id,
      role: "user",
      kind: input.kind ?? "text",
      content: input.content,
    });

    const history = await this.messages.listByConversation(conv.id);
    const llmTurns: LLMTurn[] = history
      .filter((m) => m.kind === "text" || m.kind === "voice")
      .map((m) => ({ role: m.role === "system" ? "system" : m.role, content: m.content }));

    const systemPrompt = isInQuotePhase(conv) ? SYSTEM_PROMPT_QUOTE : SYSTEM_PROMPT_TERMS;
    const llmResponse = await this.llm.respond({
      systemPrompt,
      messages: llmTurns,
      userId: input.userId,
    });

    const assistantMsg = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "text",
      content: llmResponse.text,
    });

    const newMessages: AgentMessage[] = [userMsg, assistantMsg];
    let convPatch: Partial<AgentConversation> = {};

    if (llmResponse.action) {
      const action = llmResponse.action;

      // ---- create_quote: persist real Quote → emit action_card with real id ----
      if (action.type === "create_quote") {
        // Convert LLM line items (cents-per-line) into the Quote DTO shape
        // (price-per-unit in dollars, quantity 1). The DTO carries quantity
        // for trades like sqft/hours; the LLM stays at the "totalled-line"
        // abstraction in v1.
        const dtoLineItems = action.payload.lineItems.map((l) => ({
          description: l.description,
          quantity:    1,
          unit:        "ea",
          price:       l.amountCents / 100,
        }));
        const estimatedTotal = action.payload.lineItems.reduce((sum, l) => sum + l.amountCents, 0) / 100;

        const customerId = action.payload.customerId ?? conv.customerId;
        const quote = await this.quotes.create(input.userId, {
          summary: action.payload.summary,
          lineItems: dtoLineItems,
          estimatedTotal,
          status: "draft",
          ...(customerId ? { customerId } : {}),
        });

        const card = await this.messages.append({
          conversationId: conv.id,
          role: "assistant",
          kind: "action_card",
          content: action.payload.summary,
          payload: {
            actionType: "quote",
            status: "draft",
            quoteId: quote.id,                     // real id from the store
            customerId: quote.customerId,
            lineItems: action.payload.lineItems,    // keep cents-shape for the frontend
            totalCents: action.payload.lineItems.reduce((s, l) => s + l.amountCents, 0),
          },
        });
        newMessages.push(card);

        // Bind to the conversation so a follow-up lock_quote knows what to lock.
        convPatch.quoteId = quote.id;
        // Inherit customer too so subsequent turns don't ask again.
        if (customerId && !conv.customerId) convPatch.customerId = customerId;

        await this.bus.emit({
          userId: input.userId,
          entityType: "quote",
          entityId: quote.id,
          action: "drafted",
          data: { customerId, summary: action.payload.summary },
        });
      }

      // ---- lock_quote: flip the active quote status to 'sent' ----
      else if (action.type === "lock_quote") {
        // Use the conversation's quoteId, NOT the one the LLM made up. The
        // coordinator is the source of truth for which quote is "active".
        const quoteId = conv.quoteId ?? action.payload.quoteId;
        if (quoteId) {
          await this.quotes.update(quoteId, input.userId, { status: "sent" });
          convPatch.quoteId = quoteId;             // ensure conv.quoteId is set
          await this.bus.emit({
            userId: input.userId,
            entityType: "quote",
            entityId: quoteId,
            action: "sent",
          });
          // Best-effort customer email. Failure here MUST NOT abort the
          // turn — the lock already succeeded, and the user can retry the
          // dispatch from the UI.
          try {
            await this.emailer.run(input.userId, { kind: "quote", resourceId: quoteId });
          } catch (err) {
            console.error(`[chat:lock_quote] email dispatch failed for quote ${quoteId}:`, err);
          }
        }
      }

      // ---- request_terms_transition: surface a "Continue to terms" card ----
      else if (action.type === "request_terms_transition") {
        const quoteId = conv.quoteId ?? action.payload.quoteId;
        const cta = await this.messages.append({
          conversationId: conv.id,
          role: "assistant",
          kind: "continue_cta",
          content: "Continue to terms",
          payload: {
            toPhase: "terms",
            quoteId,
            summary: "Payment, warranty, dispute, governing state — 7 quick questions",
          },
        });
        newMessages.push(cta);
      }
    }

    // Title locks in on the very first user message in the conversation.
    if (history.length === 0 || (history.length === 1 && history[0].id === userMsg.id)) {
      convPatch.title = deriveTitleFromFirstUserMessage(input.content);
    }
    convPatch.preview = derivePreview((newMessages[newMessages.length - 1] ?? userMsg).content);

    const updated = await this.conversations.update(conv.id, convPatch);
    return { conversation: updated, newMessages };
  }
}
