import { Inject, Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import type { LLMClient, LLMResponse, LLMTurn } from "@agents/domain/business/llm/base/mod.ts";
import { LLM_CLIENT } from "@agents/domain/business/llm/base/mod.ts";
import { SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS } from "@agents/domain/business/llm-prompts/mod.ts";
import { isInQuotePhase } from "@agents/domain/business/derive-phase/mod.ts";
import { deriveTitleFromFirstUserMessage, derivePreview } from "@agents/domain/business/conversation-title/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

/** Confirmation phrases that mean "lock the active draft quote." When the
 *  user types one of these AND the conversation already carries a draft
 *  quote, we bypass the LLM entirely — the model was unreliable at firing
 *  `lock_quote` from chat (see audit2 N5). Keep this list aligned with the
 *  examples in `SYSTEM_PROMPT_QUOTE`. */
const CONFIRM_LOCK_RE =
  /^\s*(lock\s*it\s*in|lock\s*it|lock|send\s*it|send\s*now|send|fire\s*it\s*off|fire\s*it|ship\s*it|ship|do\s*it|go\s*ahead|go\s*for\s*it|looks?\s*good|looks?\s*right|looks?\s*great|perfect|nice|sounds?\s*good|yes|yep|yup|yeah|sure)\b/i;

/** Heuristic: did the user mention a customer name in the message that
 *  triggered create_quote? Looks for the patterns the prompt examples use:
 *  "Quote for X", "for the Xs", "X residence/place/family", "the X family",
 *  "at the X place". Used to decide whether to overwrite the assistant text
 *  with "Drafted — who's this for?" (audit2 N6). */
function userMentionedCustomer(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  // "Quote for X" / "qte for X" / "for delgado" — lowercase OK; user types
  // fast on mobile and casing isn't a signal here.
  if (/\b(?:quote|qte)\s+for\s+[a-z]/i.test(t)) return true;
  if (/\bfor\s+(the\s+)?[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)*\b/.test(t)) return true;
  if (/\b[A-Z][a-zA-Z'’-]+(?:'s|s)?\s+(residence|place|house|home|family|HOA|property)\b/i.test(t)) return true;
  if (/\bthe\s+[A-Z][a-zA-Z'’-]+s\b/.test(t)) return true;
  if (/\bat\s+the\s+[A-Z][a-zA-Z'’-]+\s+place\b/.test(t)) return true;
  // Proper-noun cluster of 2+ capitalised tokens that aren't sentence-start
  // ("Riverside Office Park", "Acme Property Group"). Lower bar than the
  // patterns above; deliberately permissive — false-positive is harmless
  // (don't ask), false-negative is what we're trying to avoid.
  if (/\b[A-Z][a-zA-Z'’-]+\s+[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?\b/.test(t)) return true;
  return false;
}

export interface HandleChatInput {
  userId: string;
  conversationId: string;
  content: string;
  /** 'voice' is a transcribed user memo; 'image' carries payload.fileId
   *  and the LLM sees the bytes via FileStore on every turn (history-
   *  driven, so follow-up questions still see the picture). */
  kind?: "text" | "voice" | "image";
  /** Persisted onto the user message's payload so the chat island can
   *  render an image bubble pointing at /api/files/:fileId — and so
   *  history-replay can re-fetch image bytes for the LLM each turn. */
  payload?: Record<string, unknown>;
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
    private files: FileStore,
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
      ...(input.payload ? { payload: input.payload } : {}),
    });

    const history = await this.messages.listByConversation(conv.id);

    // ---- N5 fast-path: confirmation → fire lock_quote without the LLM ----
    // The model is unreliable at calling lock_quote on short confirmations
    // ("send it", "looks good", "yep") even with example-rich prompting on
    // smaller models. Detect confirmation phrases server-side AND verify the
    // conversation has a draft quote bound. Synthesize a fake LLMResponse so
    // the existing lock branch below handles persistence + downstream cards.
    let llmResponse: LLMResponse | undefined;
    if (
      isInQuotePhase(conv) &&
      conv.quoteId &&
      typeof input.content === "string" &&
      CONFIRM_LOCK_RE.test(input.content)
    ) {
      try {
        const active = await this.quotes.getOwned(conv.quoteId, input.userId);
        if (active.status === "draft") {
          llmResponse = {
            text: "Locking the quote.",
            action: { type: "lock_quote", payload: { quoteId: conv.quoteId } },
          };
        }
      } catch {
        // Quote disappeared; fall through to the LLM.
      }
    }

    // ---- N3: action_card / continue_cta → synthetic text turns so the LLM
    // can answer status questions ("what's the total?") about a quote it
    // already drafted. Without this, the filter below dropped these kinds
    // and the model was blind to its own prior actions.
    // Image bytes are still re-fetched per turn so vision-capable models can
    // re-read attached photos on follow-up turns.
    const llmTurns: LLMTurn[] = await Promise.all(
      history
        .filter((m) =>
          m.kind === "text" || m.kind === "voice" || m.kind === "image" ||
          m.kind === "action_card" || m.kind === "continue_cta"
        )
        .map(async (m): Promise<LLMTurn> => {
          const role = m.role === "system" ? "system" : m.role;
          if (m.kind === "action_card") {
            const p = (m.payload ?? {}) as {
              actionType?: string; status?: string;
              lineItems?: { description: string; amountCents: number }[];
              totalCents?: number;
            };
            const lines = (p.lineItems ?? [])
              .map((l) => `  - ${l.description}: $${(l.amountCents / 100).toFixed(2)}`)
              .join("\n");
            const total = typeof p.totalCents === "number" ? `$${(p.totalCents / 100).toFixed(2)}` : "?";
            const summary = `[Quote ${p.status ?? "draft"}: ${m.content || ""}\n${lines}\nTotal: ${total}]`;
            return { role, content: summary };
          }
          if (m.kind === "continue_cta") {
            return { role, content: `[Continue-to-terms CTA shown]` };
          }
          const turn: LLMTurn = { role, content: m.content };
          if (m.kind === "image" && role === "user") {
            const fileId = (m.payload as { fileId?: unknown } | undefined)?.fileId;
            if (typeof fileId === "string" && fileId) {
              try {
                const meta = await this.files.getOwnedMeta(fileId, input.userId);
                const bytes = await this.files.readBytes(fileId);
                turn.images = [{ bytes, mimeType: meta.mimeType }];
              } catch (err) {
                console.error(`[handle-chat] failed to load image ${fileId}:`, err);
              }
            }
          }
          return turn;
        }),
    );

    if (!llmResponse) {
      const systemPrompt = isInQuotePhase(conv) ? SYSTEM_PROMPT_QUOTE : SYSTEM_PROMPT_TERMS;
      llmResponse = await this.llm.respond({
        systemPrompt,
        messages: llmTurns,
        userId: input.userId,
      });
    }

    // The LLM occasionally returns an empty `text` (e.g., on a tool-only
    // turn or when it doesn't have anything substantive to add). Persisting
    // that as-is renders as a ghost bubble in the chat. Replace with a
    // brief acknowledgement so the conversation reads cleanly; if the LLM
    // ALSO emits an action below, the action_card carries the real signal
    // and the ack is harmless context.
    let replyText = llmResponse.text?.trim()
      || (llmResponse.action ? "On it." : "Got it — what would you like me to do with that?");

    // N6 — deterministic ask-for-name. Fire only on the FIRST draft of a
    // conversation (i.e., before this turn there was no quoteId bound). On
    // revisions ("bump install to $2,100", "drop the discount") the user
    // typically isn't repeating the customer name, so we'd false-positive
    // an ask every time. Restricting to first-draft handles that. We also
    // skip when the conversation already has a customerId (set by start-
    // conversation or the wizard's customer step).
    if (
      llmResponse.action?.type === "create_quote" &&
      !conv.quoteId &&
      !conv.customerId &&
      !userMentionedCustomer(input.content)
    ) {
      replyText = "Drafted — who's this for?";
    }
    const assistantMsg = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "text",
      content: replyText,
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

        // customerId is no longer accepted from the LLM — it was being
        // populated with raw names like "Mendez" and corrupting joins.
        // The conversation already carries a bound customerId when one
        // exists (set by start-conversation or the wizard's customer step);
        // we inherit only that.
        const customerId = conv.customerId;

        // N7 — update-in-place when the conversation already has a draft
        // quote bound. Previously each create_quote re-issue created a new
        // Quote row in the store, leaving orphans on every correction
        // ("bump labor to $2,100" → 2 rows in the DB). Update the existing
        // draft if one exists; otherwise create. Locked/sent quotes are
        // immutable, so fall through to creating a new one if the bound
        // quote is no longer in 'draft'.
        let quote;
        if (conv.quoteId) {
          try {
            const existing = await this.quotes.getOwned(conv.quoteId, input.userId);
            if (existing.status === "draft") {
              quote = await this.quotes.update(conv.quoteId, input.userId, {
                summary: action.payload.summary,
                lineItems: dtoLineItems,
                estimatedTotal,
              });
            }
          } catch {
            // Lookup failed — fall through to create.
          }
        }
        if (!quote) {
          quote = await this.quotes.create(input.userId, {
            summary: action.payload.summary,
            lineItems: dtoLineItems,
            estimatedTotal,
            status: "draft",
            ...(customerId ? { customerId } : {}),
          });
        }

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
          const locked = await this.quotes.update(quoteId, input.userId, { status: "sent" });
          convPatch.quoteId = quoteId;             // ensure conv.quoteId is set
          await this.bus.emit({
            userId: input.userId,
            entityType: "quote",
            entityId: quoteId,
            action: "sent",
          });
          // Mirror the button-driven /lock-quote flow: emit an updated
          // action_card with status:"sent" + an automatic continue_cta so
          // a chat-flow lock ('send it') produces the same UI as clicking
          // the Lock-it-in button. Multi-tool fan-out isn't supported in
          // the LLM client (only the first tool call is honored), so the
          // transition card is server-driven instead of model-driven.
          const sentLineItems = (locked.lineItems ?? []).map((li) => ({
            description: li.description,
            amountCents: Math.round((li.price ?? 0) * 100),
          }));
          const totalCents = sentLineItems.reduce((s, l) => s + l.amountCents, 0);
          const sentCard = await this.messages.append({
            conversationId: conv.id,
            role: "assistant",
            kind: "action_card",
            content: locked.summary ?? "Quote sent",
            payload: {
              actionType: "quote",
              status: "sent",
              quoteId,
              lineItems: sentLineItems,
              totalCents,
            },
          });
          newMessages.push(sentCard);
          const cta = await this.messages.append({
            conversationId: conv.id,
            role: "assistant",
            kind: "continue_cta",
            content: "Continue to terms",
            payload: {
              toPhase: "terms",
              quoteId,
              summary: "Payment, warranty, dispute, governing state — 10 quick steps",
            },
          });
          newMessages.push(cta);
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
            summary: "Payment, warranty, dispute, governing state — 10 quick steps",
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
