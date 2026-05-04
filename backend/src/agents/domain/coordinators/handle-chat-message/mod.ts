import { Inject, Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import type { LLMClient, LLMResponse, LLMTurn } from "@agents/domain/business/llm/base/mod.ts";
import { LLM_CLIENT } from "@agents/domain/business/llm/base/mod.ts";
import { SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS } from "@agents/domain/business/llm-prompts/mod.ts";
import { isInQuotePhase } from "@agents/domain/business/derive-phase/mod.ts";
import { deriveTitleFromFirstUserMessage, derivePreview } from "@agents/domain/business/conversation-title/mod.ts";
import {
  extractAddressOnly,
  extractAddressViaLLM,
  extractBusinessOnly,
  extractNameAndBusiness,
  extractNameOnly,
  extractStateOnly,
  isAffirmativeReply,
  isSkipReply,
  looksLikeJobRequest,
  onboardAskStateWithGuess,
  ONBOARD_ASK_ADDRESS,
  ONBOARD_ASK_BUSINESS,
  ONBOARD_ASK_NAME,
  ONBOARD_HANDOFF,
  ONBOARDING_ASK_TEXT,
  stateFromPhone,
  type ParsedAddress,
} from "@agents/domain/business/onboarding/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
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

/** Strip "who's this for?" / "whose place is this?" / similar customer-name
 *  asks from LLM prose. The customer is collected via the wizard AFTER the
 *  user clicks "Lock it in", so any preemptive ask in the create_quote
 *  reply is duplicative. We strip surgically rather than re-prompting the
 *  LLM so we don't burn another round-trip. */
function stripCustomerAsk(text: string): string {
  return text
    .replace(/\b(?:who'?s|who is)\s+this\s+for\??/gi, "")
    .replace(/\bwhose\s+(?:place|home|house|name)\s+is\s+this\??/gi, "")
    .replace(/\bwho\s+(?:is\s+)?the\s+(?:customer|client)\??/gi, "")
    .replace(/\bwhat'?s\s+the\s+(?:customer|client)'?s?\s+name\??/gi, "")
    .replace(/[ \t]+([.?!])/g, "$1")
    .replace(/\s+—\s*$/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/** Pick the message that should drive the conversation list preview.
 *  Walks newMessages backwards picking the most-meaningful surface:
 *    1. action_card — quote/contract/invoice summary lands as the preview.
 *    2. assistant text — the model's reply if no card was produced.
 *  Returns undefined if neither is present (e.g. only a continue_cta or a
 *  user message), so the caller can leave the existing preview untouched. */
function pickPreviewSource(msgs: AgentMessage[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "assistant") continue;
    if (m.kind === "action_card" || m.kind === "text") return m.content;
  }
  return undefined;
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
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private addresses: BusinessAddressStore,
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

    // ---- Onboarding (single-question, conversational) ----
    // We collect TWO fields, in order: (1) user.name, (2) businessName.
    // On any turn where one of these is still missing, Bossie asks for
    // exactly that one — not both at once. The user's reply is parsed,
    // the field is persisted, and we either ask the next field or, if
    // we just completed the second one, fire a friendly handoff:
    //   "Awesome, we're set. Okay — can we start with your first quote?"
    // Voice messages bypass this entirely; "skip / later / not now"
    // drops the ask out of the way. Real-job-shaped first messages
    // (e.g. "Quote a fence — $350") also bypass onboarding so we don't
    // block real work behind a name prompt.
    const inputIsText = (input.kind ?? "text") === "text" && typeof input.content === "string";
    if (inputIsText) {
      const me = await this.users.get(input.userId).catch(() => null);
      const ident = await this.identity.get(input.userId).catch(() => null);
      const addr = await this.addresses.get(input.userId).catch(() => null);
      const needsName    = !me?.name || me.name.trim().length === 0;
      const needsBiz     = !ident?.businessName || ident.businessName.trim().length === 0;
      const needsState   = !addr?.state || addr.state.trim().length === 0;
      const needsAddress = !addr?.postal || addr.postal.trim().length === 0;
      if (needsName || needsBiz || needsState || needsAddress) {
        const text = input.content.trim();
        const isFirstTurn = history.length === 1;
        const lastAssistant = [...history].reverse().find((m) => m.role === "assistant" && m.kind === "text");
        const lastAsk = lastAssistant?.content ?? "";
        const justAskedName = lastAsk === ONBOARD_ASK_NAME ||
          lastAsk.startsWith("Hey 👋 quick one") || lastAsk.startsWith("Hey there 👋");
        const justAskedBiz = lastAsk.startsWith("Nice to meet you,");
        const justAskedState = lastAsk.startsWith("Almost there. Which state") ||
          lastAsk.startsWith("Almost there. Looks like you're in");
        // Treat the parse-error retry as another address ask so the user's
        // next reply still routes through the address branch instead of
        // falling into the LLM (which would hallucinate a quote from
        // address-shaped text — see audit2 N7).
        const justAskedAddress = lastAsk.startsWith("Last one,") ||
          lastAsk.startsWith("Hmm, couldn't quite parse");
        const userVolunteered = isFirstTurn && extractNameAndBusiness(text);
        const firstNameOf = (n: string | undefined): string => n?.trim().split(/\s+/)[0] ?? "there";

        // 1) NAME
        if (needsName) {
          if (userVolunteered && userVolunteered.name) {
            await this.users.update(input.userId, { name: userVolunteered.name });
            if (userVolunteered.businessName) {
              await this.identity.upsert(input.userId, { businessName: userVolunteered.businessName });
            }
            const stillNeedsBiz = !userVolunteered.businessName && needsBiz;
            const firstName = firstNameOf(userVolunteered.name);
            const nextAsk = stillNeedsBiz
              ? ONBOARD_ASK_BUSINESS(firstName)
              : (needsState ? onboardAskStateWithGuess(firstName, me?.phoneNumber) : ONBOARD_HANDOFF(firstName));
            const ack = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text", content: nextAsk,
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1 ? { title: deriveTitleFromFirstUserMessage(input.content) } : {}),
              preview: derivePreview(ack.content),
            });
            return { conversation: updated, newMessages: [userMsg, ack] };
          }
          if (justAskedName && !isSkipReply(text) && !looksLikeJobRequest(text)) {
            const parsed = extractNameOnly(text);
            if (parsed) {
              await this.users.update(input.userId, { name: parsed });
              const firstName = firstNameOf(parsed);
              const nextAsk = needsBiz
                ? ONBOARD_ASK_BUSINESS(firstName)
                : (needsState ? onboardAskStateWithGuess(firstName, me?.phoneNumber) : ONBOARD_HANDOFF(firstName));
              const ack = await this.messages.append({
                conversationId: conv.id, role: "assistant", kind: "text", content: nextAsk,
              });
              const updated = await this.conversations.update(conv.id, {
                ...(history.length === 1 ? { title: deriveTitleFromFirstUserMessage(input.content) } : {}),
                preview: derivePreview(ack.content),
              });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const ask = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text",
              content: "Sorry, didn't quite catch that — what should I call you? (just your first name is fine)",
            });
            const updated = await this.conversations.update(conv.id, { preview: derivePreview(ask.content) });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
          if ((isFirstTurn || !lastAssistant) && !isSkipReply(text) && !looksLikeJobRequest(text)) {
            const ask = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text", content: ONBOARD_ASK_NAME,
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1 ? { title: deriveTitleFromFirstUserMessage(input.content) } : {}),
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
        } else if (needsBiz) {
          // 2) BUSINESS NAME
          const firstName = firstNameOf(me?.name);
          if (justAskedBiz && !isSkipReply(text)) {
            const parsed = extractBusinessOnly(text);
            if (parsed) {
              await this.identity.upsert(input.userId, { businessName: parsed });
              const nextAsk = needsState ? onboardAskStateWithGuess(firstName, me?.phoneNumber) : ONBOARD_HANDOFF(firstName);
              const ack = await this.messages.append({
                conversationId: conv.id, role: "assistant", kind: "text", content: nextAsk,
              });
              const updated = await this.conversations.update(conv.id, { preview: derivePreview(ack.content) });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const ask = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text",
              content: "What's the business called? (e.g. \"Riley Roofing Co.\" — solo is fine too)",
            });
            const updated = await this.conversations.update(conv.id, { preview: derivePreview(ask.content) });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
          if (!isSkipReply(text) && !looksLikeJobRequest(text)) {
            const ask = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text", content: ONBOARD_ASK_BUSINESS(firstName),
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1 ? { title: deriveTitleFromFirstUserMessage(input.content) } : {}),
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
        } else if (needsState) {
          // 3) STATE — uses phone-area-code guess when available so the
          //    user can confirm with a one-tap "yes" instead of typing.
          const firstName = firstNameOf(me?.name);
          const phoneGuess = stateFromPhone(me?.phoneNumber);
          const askedWithGuess = lastAsk.startsWith("Almost there. Looks like you're in");

          if (justAskedState && !isSkipReply(text)) {
            // Affirmative reply to a guess → save the guessed state.
            if (askedWithGuess && phoneGuess && isAffirmativeReply(text)) {
              await this.addresses.upsert(input.userId, { state: phoneGuess });
              const ack = await this.messages.append({
                conversationId: conv.id, role: "assistant", kind: "text",
                content: needsAddress ? ONBOARD_ASK_ADDRESS(firstName) : ONBOARD_HANDOFF(firstName),
              });
              const updated = await this.conversations.update(conv.id, { preview: derivePreview(ack.content) });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const parsed = extractStateOnly(text);
            if (parsed) {
              await this.addresses.upsert(input.userId, { state: parsed });
              const ack = await this.messages.append({
                conversationId: conv.id, role: "assistant", kind: "text",
                content: needsAddress ? ONBOARD_ASK_ADDRESS(firstName) : ONBOARD_HANDOFF(firstName),
              });
              const updated = await this.conversations.update(conv.id, { preview: derivePreview(ack.content) });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const ask = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text",
              content: "Hmm, didn't recognize that — try the 2-letter code (CA, TX, NY) or the full state name.",
            });
            const updated = await this.conversations.update(conv.id, { preview: derivePreview(ask.content) });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
          if (!isSkipReply(text) && !looksLikeJobRequest(text)) {
            const ask = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text",
              content: onboardAskStateWithGuess(firstName, me?.phoneNumber),
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1 ? { title: deriveTitleFromFirstUserMessage(input.content) } : {}),
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
        } else if (needsAddress) {
          // 4) ADDRESS — last question, free-form parse. "skip" jumps
          //    straight to the handoff so the user isn't blocked.
          const firstName = firstNameOf(me?.name);
          if (justAskedAddress) {
            if (isSkipReply(text)) {
              // Stamp postal with a sentinel-empty value? No — skipping
              // should just hand off without persisting. needsAddress will
              // remain true so a later turn could re-ask, but we don't
              // re-prompt within the same thread (consistent with the
              // name-skip path elsewhere).
              const ack = await this.messages.append({
                conversationId: conv.id, role: "assistant", kind: "text", content: ONBOARD_HANDOFF(firstName),
              });
              const updated = await this.conversations.update(conv.id, { preview: derivePreview(ack.content) });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            // Try the cheap regex parse first. Accept if it picked up
            // either a zip OR (city + state) — strict enough to avoid
            // saving "219 delano way myrtle beach" as a street alone.
            const regexParsed = extractAddressOnly(text);
            const regexEnough = regexParsed && (regexParsed.postal || (regexParsed.city && regexParsed.state));
            let final: ParsedAddress | undefined = regexEnough ? regexParsed : undefined;
            // Fall back to the LLM for shapes the regex can't unambiguously
            // split — no commas, missing zip, lowercase city/state, etc.
            // The LLM's job is structured extraction only, no prose. We
            // accept its result if it gives us at least state OR (street
            // + city) — enough to render a real return address on docs.
            if (!final) {
              const llmParsed = await extractAddressViaLLM(this.llm, text, input.userId);
              if (llmParsed && (llmParsed.state || llmParsed.postal || (llmParsed.street && llmParsed.city))) {
                final = llmParsed;
              }
            }
            if (final) {
              await this.addresses.upsert(input.userId, final);
              const ack = await this.messages.append({
                conversationId: conv.id, role: "assistant", kind: "text", content: ONBOARD_HANDOFF(firstName),
              });
              const updated = await this.conversations.update(conv.id, { preview: derivePreview(ack.content) });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const ask = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text",
              content: "Hmm, couldn't quite parse that. Try \"123 Main St, Austin, TX 78701\" — or just say \"skip\".",
            });
            const updated = await this.conversations.update(conv.id, { preview: derivePreview(ask.content) });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
          if (!looksLikeJobRequest(text)) {
            const ask = await this.messages.append({
              conversationId: conv.id, role: "assistant", kind: "text", content: ONBOARD_ASK_ADDRESS(firstName),
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1 ? { title: deriveTitleFromFirstUserMessage(input.content) } : {}),
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
        }
        // skip or job request → fall through to normal LLM flow.
      }
    }
    // Stash the legacy ask for compatibility (kept so existing tests
    // referencing this constant continue to compile).
    const _legacyAsk = ONBOARDING_ASK_TEXT;
    void _legacyAsk;

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

    // Whether this turn produces a rich follow-up bubble (action_card, etc.)
    // that supersedes any standalone assistant text. For these actions we
    // prefer NOT to persist a redundant prose bubble — the card carries the
    // real signal, and the chat UI renders transient typing dots while the
    // request is in flight (#36 — kill the persistent "Drafting a quote."
    // filler that lingers in scrollback after the card lands).
    const actionType = llmResponse.action?.type;
    const cardBearingAction = actionType === "create_quote" || actionType === "lock_quote";

    const llmText = llmResponse.text?.trim() ?? "";

    // Resolve the final text:
    //   1. Use the LLM's prose if it provided any (we strip any "who's this
    //      for?" style asks server-side below — the customer is collected
    //      after lock-in, not before).
    //   2. Else for card-bearing actions, leave empty — we won't persist a
    //      bubble at all.
    //   3. Else fall back to "On it." / generic ack so the chat doesn't go
    //      silent on a tool-only turn.
    let replyText: string;
    let suppressTextBubble = false;
    if (llmText) {
      replyText = stripCustomerAsk(llmText);
      // If stripping nuked everything (the LLM only said the ask), and we
      // emitted an action card anyway, don't persist an empty bubble.
      if (!replyText.trim() && cardBearingAction) {
        replyText = "";
        suppressTextBubble = true;
      }
    } else if (cardBearingAction) {
      replyText = "";
      suppressTextBubble = true;
    } else if (llmResponse.action) {
      replyText = "On it.";
    } else {
      replyText = "Got it — what would you like me to do with that?";
    }

    const newMessages: AgentMessage[] = [userMsg];
    if (!suppressTextBubble) {
      const assistantMsg = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: replyText,
      });
      newMessages.push(assistantMsg);
    }
    let convPatch: Partial<AgentConversation> = {};

    if (llmResponse.action) {
      const action = llmResponse.action;

      // ---- create_quote: persist real Quote → emit action_card with real id ----
      if (action.type === "create_quote") {
        // Audit1 #3 — line item amounts persist as INTEGER CENTS, matching
        // the LLM's `amountCents` payload. The previous schema divided by
        // 100 here to store dollars; we no longer do that conversion.
        // quantity stays 1 because the LLM emits one totalled line per
        // trade (sqft/hours folded into the amount).
        const dtoLineItems = action.payload.lineItems.map((l) => ({
          description: l.description,
          quantity:    1,
          unit:        "ea",
          price:       l.amountCents,
        }));
        const estimatedTotal = action.payload.lineItems.reduce((sum, l) => sum + l.amountCents, 0);

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
          // Audit1 #3 — line items already speak INTEGER CENTS, so this is
          // an identity copy. The previous schema multiplied by 100 here to
          // rebuild cents from dollars; that conversion is gone.
          const sentLineItems = (locked.lineItems ?? []).map((li) => ({
            description: li.description,
            amountCents: li.price ?? 0,
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
            content: "We've locked the quote down! Is this for a business or a person?",
            payload: {
              toPhase: "terms",
              quoteId,
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
          content: "We've locked the quote down! Is this for a business or a person?",
          payload: {
            toPhase: "terms",
            quoteId,
          },
        });
        newMessages.push(cta);
      }
    }

    // Title locks in on the very first user message in the conversation.
    if (history.length === 0 || (history.length === 1 && history[0].id === userMsg.id)) {
      convPatch.title = deriveTitleFromFirstUserMessage(input.content);
    }
    // Audit P6.13 — preview priority: latest action_card (quote/contract/invoice
    // summary) > latest assistant text > do nothing. Never the user prompt:
    // the sidebar should reflect what the assistant did, not what the user
    // said. continue_cta messages ("Continue to terms") are skipped — they're
    // navigation glue, not status.
    const previewSource = pickPreviewSource(newMessages);
    if (previewSource) convPatch.preview = derivePreview(previewSource);

    const updated = await this.conversations.update(conv.id, convPatch);
    return { conversation: updated, newMessages };
  }
}
