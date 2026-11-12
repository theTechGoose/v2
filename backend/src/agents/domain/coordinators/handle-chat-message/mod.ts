import { Inject, Injectable } from "#danet/core";
import { t } from "@core/i18n/mod.ts";
import {
  priceProblemItem,
  quotePriceProblem,
} from "#quote-flow/quote-price-guard.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import type {
  LLMClient,
  LLMResponse,
  LLMTurn,
} from "@agents/domain/business/llm/base/mod.ts";
import { LLM_CLIENT } from "@agents/domain/business/llm/base/mod.ts";
import {
  SYSTEM_PROMPT_QUOTE,
  systemPromptTermsFor,
} from "@agents/domain/business/llm-prompts/mod.ts";
import { isInQuotePhase } from "@agents/domain/business/derive-phase/mod.ts";
// REQ-368 (demo-loop cycle 1, M30 + M32): pricing / billing asks + tool gate.
import {
  chatToolsFor,
  isInvoiceRequest,
  isOpenDraft,
  jobTitle,
  mayAdvanceQuote,
  parsePricingQuestion,
} from "@agents/domain/business/chat-routing/mod.ts";
import { pricingReply } from "@agents/domain/business/chat-answers/mod.ts";
import { AnswerBilling } from "@agents/domain/coordinators/answer-billing/mod.ts";
import { SuggestPrices } from "@agents/domain/coordinators/suggest-prices/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import {
  derivePreview,
  deriveTitleFromFirstUserMessage,
} from "@agents/domain/business/conversation-title/mod.ts";
import {
  classifyLastAsk,
  extractAddressOnly,
  extractAddressViaLLM,
  extractBusinessOnly,
  extractEmail,
  extractNameAndBusiness,
  extractNameOnly,
  extractPayout,
  extractStateOnly,
  isAffirmativeReply,
  isSkipReply,
  isStarterChipText,
  looksLikeJobRequest,
  ONBOARD_ASK_ADDRESS,
  ONBOARD_ASK_BUSINESS,
  ONBOARD_ASK_PAYOUT,
  ONBOARD_HANDOFF,
  onboardAskStateWithGuess,
  ONBOARDING_ASK_TEXT,
  type ParsedAddress,
  stateFromPhone,
} from "@agents/domain/business/onboarding/mod.ts";
import { describeQuoteRevision } from "@agents/domain/business/quote-revision-reply/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { toPlainChatText } from "@agents/domain/business/plain-chat-text/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { TranslateQuote } from "@agents/domain/coordinators/translate-quote/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { lockStatusFor, QUOTE_LOCKED } from "#quote-flow/quote-lock.ts";
import { parseChangeOrderRequest } from "@agents/domain/business/change-order-intent/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import {
  ReviseQuote,
  type ReviseQuoteResult,
} from "@agents/domain/coordinators/revise-quote/mod.ts";
import { changeOrderAsReprice } from "@agents/domain/business/quote-line-revision/mod.ts";
import { extractServiceAddress } from "#quote-flow/quick-quote-prefill.ts";
import { extractQuoteFacts } from "#quote-flow/quote-facts.ts"; // REQ-331
import { findExistingCustomer } from "#quote-flow/customer-dedupe.ts"; // REQ-331
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { Customer } from "@crm/dto/customer.ts";
import { isValidJobName, jobNameCase } from "#quote-flow/job-name.ts";
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

/** REQ-262 (demo M25): a signed / closed quote's job details never change
 *  from chat — they are what the customer agreed to (or turned down). */
const JOB_DETAILS_LOCKED_STATUSES = new Set([
  "accepted",
  "declined",
  "lost",
  "void",
]);

/** REQ-262 (demo M25): the saved quote, as the model should see it. The
 *  wizard makes the quote with POST /quotes — no action_card in the thread —
 *  so without this the terms-phase model never saw the real document and
 *  rewrote "job details" from the contractor's first raw message. */
function quoteContext(q: {
  status?: string;
  jobName?: string;
  summary?: string;
  description?: string;
  descriptionByLang?: Record<string, string>;
  lineItems?: { description: string; price?: number }[];
  estimatedTotal?: number;
}): string {
  const money = (c: number) =>
    `$${
      (c / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }`;
  const out = [
    `Active quote (status: ${q.status ?? "draft"})`,
    `Job: ${q.jobName || q.summary || "(untitled)"}`,
  ];
  if (q.summary && q.summary !== q.jobName) out.push(`Summary: ${q.summary}`);
  const byLang = q.descriptionByLang ?? {};
  const langs = Object.keys(byLang).filter((l) => byLang[l]?.trim());
  if (langs.length) {
    for (const l of langs) out.push(`Job details [${l}]:\n${byLang[l].trim()}`);
  } else if (q.description?.trim()) {
    out.push(`Job details:\n${q.description.trim()}`);
  } else {
    out.push("Job details: (none yet)");
  }
  out.push(
    `Job details languages: ${langs.length ? langs.join(", ") : "(base only)"}`,
  );
  for (const li of q.lineItems ?? []) {
    out.push(`Line item: ${li.description} — ${money(li.price ?? 0)}`);
  }
  if (typeof q.estimatedTotal === "number") {
    out.push(`Total: ${money(q.estimatedTotal)}`);
  }
  return out.join("\n");
}

/** Pick the message that should drive the conversation list preview.
 *  Walks newMessages backwards picking the most-meaningful surface:
 *    1. action_card — quote/invoice summary lands as the preview.
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
 *   - update_job_details (REQ-262): merge the per-language job details onto
 *     conv.quoteId's quote (never a signed one) and flag the reply with
 *     payload.quoteUpdated so the chat island re-reads it.
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
    private changeOrder: ApplyChatChangeOrder,
    /** REQ-315 (M26): changes a line that is already on a quote. */
    private reviseQuote: ReviseQuote,
    /** REQ-264 (M15): fills every document language before dispatch. */
    private translator?: TranslateQuote,
    /** REQ-331 (demo m7): resolves a typed "for <Name>" to the contractor's
     *  own customer, and names the bound customer on the terms CTA. */
    private customers?: CustomerStore,
  ) {}

  /** REQ-331: the same-owner customer the thread's typed facts name — by
   *  phone, email, then accent-folded name; null when nobody matches. */
  private async customerFromTypedFacts(
    userId: string,
    history: AgentMessage[],
  ): Promise<{ id: string; name: string } | null> {
    if (!this.customers) return null;
    const typed = history
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => m.content as string)
      .join("\n");
    const facts = extractQuoteFacts(typed, new Date());
    if (!facts.customerName && !facts.customerPhone && !facts.customerEmail) {
      return null;
    }
    const mine: Customer[] = await this.customers.listByUser(userId)
      .catch(() => []);
    return findExistingCustomer(mine, {
      name: facts.customerName,
      email: facts.customerEmail,
      phoneNumber: facts.customerPhone,
    });
  }

  /** REQ-331: the bound customer's name for the terms CTA, if any. */
  private async boundCustomerName(
    conv: AgentConversation,
    userId: string,
  ): Promise<string | undefined> {
    if (!conv.customerId || !this.customers) return undefined;
    const c = await this.customers.getOwned(conv.customerId, userId)
      .catch(() => null);
    return c?.name;
  }

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
    const inputIsText = (input.kind ?? "text") === "text" &&
      typeof input.content === "string";
    if (inputIsText) {
      const me = await this.users.get(input.userId).catch(() => null);
      const lang = me?.language === "es" ? "es" : "en";
      const ident = await this.identity.get(input.userId).catch(() => null);
      const addr = await this.addresses.get(input.userId).catch(() => null);
      const needsName = !me?.name || me.name.trim().length === 0;
      const needsBiz = !ident?.businessName ||
        ident.businessName.trim().length === 0;
      const needsState = !addr?.state || addr.state.trim().length === 0;
      const needsAddress = !addr?.postal || addr.postal.trim().length === 0;
      const needsEmail = !me?.email || me.email.trim().length === 0;
      const acceptedAny = Object.values(ident?.acceptedPaymentMethods ?? {})
        .some(
          (m) => m && (m as { enabled?: boolean }).enabled === true,
        );
      const needsPayout = !acceptedAny;
      // Pick the assistant's next ask once name/biz/state/address are
      // done. Email + payment are the two nice-to-haves that come last;
      // either missing routes to the combined payout ask, otherwise we
      // hand off into job-quoting mode.
      const postAddressAsk = (
        firstName: string,
        needEmail: boolean,
        needPay: boolean,
      ): string =>
        needEmail || needPay
          ? ONBOARD_ASK_PAYOUT(firstName, lang)
          : ONBOARD_HANDOFF(firstName, lang);
      if (
        needsName || needsBiz || needsState || needsAddress || needsEmail ||
        needsPayout
      ) {
        const text = input.content.trim();
        const isFirstTurn = history.length === 1;
        const lastAssistant = [...history].reverse().find((m) =>
          m.role === "assistant" && m.kind === "text"
        );
        const lastAsk = lastAssistant?.content ?? "";
        // Which onboarding question did we just ask? Detected from the prior
        // assistant text in a language-robust way (EN or ES) — see
        // classifyLastAsk. The address ask's parse-error reprompt is treated
        // as "just asked address" too, so the user's retry still routes
        // through the address branch instead of falling into the LLM (which
        // would hallucinate a quote from address-shaped text — see audit2 N7).
        const lastAskInfo = classifyLastAsk(lastAsk);
        const justAskedName = lastAskInfo.name;
        const justAskedBiz = lastAskInfo.business;
        const justAskedState = lastAskInfo.state;
        const justAskedAddress = lastAskInfo.address;
        // REQ-008 (NW-47): a first turn that IS a starter chip ("I know the
        // job, help me price it.") is a flow choice, never a "Name, Business"
        // reply — however comma-shaped. (looksLikeJobRequest is too broad
        // here: "Diego, Riley Roofing Co." carries a trade word and is a
        // legitimate volunteer; the extractor's own stop-list rejects
        // sentences that open with a pronoun/verb.)
        const userVolunteered = isFirstTurn && !isStarterChipText(text) &&
          extractNameAndBusiness(text);
        const firstNameOf = (n: string | undefined): string =>
          n?.trim().split(/\s+/)[0] ?? "there";

        // 1) NAME
        if (needsName) {
          if (userVolunteered && userVolunteered.name) {
            await this.users.update(input.userId, {
              name: userVolunteered.name,
            });
            if (userVolunteered.businessName) {
              await this.identity.upsert(input.userId, {
                businessName: userVolunteered.businessName,
              });
            }
            const stillNeedsBiz = !userVolunteered.businessName && needsBiz;
            const firstName = firstNameOf(userVolunteered.name);
            const nextAsk = stillNeedsBiz
              ? ONBOARD_ASK_BUSINESS(firstName, lang)
              : (needsState
                ? onboardAskStateWithGuess(firstName, me?.phoneNumber, lang)
                : postAddressAsk(firstName, needsEmail, needsPayout));
            const ack = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: nextAsk,
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1
                ? { title: deriveTitleFromFirstUserMessage(input.content) }
                : {}),
              preview: derivePreview(ack.content),
            });
            return { conversation: updated, newMessages: [userMsg, ack] };
          }
          if (
            justAskedName && !isSkipReply(text) && !looksLikeJobRequest(text)
          ) {
            const parsed = extractNameOnly(text);
            if (parsed) {
              await this.users.update(input.userId, { name: parsed });
              const firstName = firstNameOf(parsed);
              const nextAsk = needsBiz
                ? ONBOARD_ASK_BUSINESS(firstName, lang)
                : (needsState
                  ? onboardAskStateWithGuess(firstName, me?.phoneNumber, lang)
                  : postAddressAsk(firstName, needsEmail, needsPayout));
              const ack = await this.messages.append({
                conversationId: conv.id,
                role: "assistant",
                kind: "text",
                content: nextAsk,
              });
              const updated = await this.conversations.update(conv.id, {
                ...(history.length === 1
                  ? { title: deriveTitleFromFirstUserMessage(input.content) }
                  : {}),
                preview: derivePreview(ack.content),
              });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: t(lang, "onboardingChat.name.reprompt"),
            });
            const updated = await this.conversations.update(conv.id, {
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
          if (
            (isFirstTurn || !lastAssistant) && !isSkipReply(text) &&
            !looksLikeJobRequest(text)
          ) {
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: t(lang, "onboarding.askName"),
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1
                ? { title: deriveTitleFromFirstUserMessage(input.content) }
                : {}),
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
              await this.identity.upsert(input.userId, {
                businessName: parsed,
              });
              const nextAsk = needsState
                ? onboardAskStateWithGuess(firstName, me?.phoneNumber, lang)
                : postAddressAsk(firstName, needsEmail, needsPayout);
              const ack = await this.messages.append({
                conversationId: conv.id,
                role: "assistant",
                kind: "text",
                content: nextAsk,
              });
              const updated = await this.conversations.update(conv.id, {
                preview: derivePreview(ack.content),
              });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: t(lang, "onboardingChat.business.reprompt"),
            });
            const updated = await this.conversations.update(conv.id, {
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
          if (!isSkipReply(text) && !looksLikeJobRequest(text)) {
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: ONBOARD_ASK_BUSINESS(firstName, lang),
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1
                ? { title: deriveTitleFromFirstUserMessage(input.content) }
                : {}),
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
        } else if (needsState) {
          // 3) STATE — uses phone-area-code guess when available so the
          //    user can confirm with a one-tap "yes" instead of typing.
          const firstName = firstNameOf(me?.name);
          const phoneGuess = stateFromPhone(me?.phoneNumber);
          const askedWithGuess = lastAskInfo.stateGuess;

          if (justAskedState && !isSkipReply(text)) {
            // Affirmative reply to a guess → save the guessed state.
            if (askedWithGuess && phoneGuess && isAffirmativeReply(text)) {
              await this.addresses.upsert(input.userId, { state: phoneGuess });
              const ack = await this.messages.append({
                conversationId: conv.id,
                role: "assistant",
                kind: "text",
                content: needsAddress
                  ? ONBOARD_ASK_ADDRESS(firstName, lang)
                  : postAddressAsk(firstName, needsEmail, needsPayout),
              });
              const updated = await this.conversations.update(conv.id, {
                preview: derivePreview(ack.content),
              });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const parsed = extractStateOnly(text);
            if (parsed) {
              await this.addresses.upsert(input.userId, { state: parsed });
              const ack = await this.messages.append({
                conversationId: conv.id,
                role: "assistant",
                kind: "text",
                content: needsAddress
                  ? ONBOARD_ASK_ADDRESS(firstName, lang)
                  : postAddressAsk(firstName, needsEmail, needsPayout),
              });
              const updated = await this.conversations.update(conv.id, {
                preview: derivePreview(ack.content),
              });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: t(lang, "onboardingChat.state.reprompt"),
            });
            const updated = await this.conversations.update(conv.id, {
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
          if (!isSkipReply(text) && !looksLikeJobRequest(text)) {
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: onboardAskStateWithGuess(
                firstName,
                me?.phoneNumber,
                lang,
              ),
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1
                ? { title: deriveTitleFromFirstUserMessage(input.content) }
                : {}),
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
        } else if (needsAddress && !lastAskInfo.payout) {
          // 4) ADDRESS — last question, free-form parse. "skip" jumps
          //    straight to the handoff so the user isn't blocked.
          //    When the PAYOUT ask was the one just answered (the user
          //    skipped the address earlier, so needsAddress is still true),
          //    this branch must yield to (5) — otherwise the payout answer
          //    loops the user straight back into the address ask (P-33).
          const firstName = firstNameOf(me?.name);
          if (justAskedAddress) {
            if (isSkipReply(text)) {
              // Stamp postal with a sentinel-empty value? No — skipping
              // should just hand off without persisting. needsAddress will
              // remain true so a later turn could re-ask, but we don't
              // re-prompt within the same thread (consistent with the
              // name-skip path elsewhere).
              const ack = await this.messages.append({
                conversationId: conv.id,
                role: "assistant",
                kind: "text",
                content: postAddressAsk(firstName, needsEmail, needsPayout),
              });
              const updated = await this.conversations.update(conv.id, {
                preview: derivePreview(ack.content),
              });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            // Try the cheap regex parse first. Accept if it picked up
            // either a zip OR (city + state) — strict enough to avoid
            // saving "219 delano way myrtle beach" as a street alone.
            const regexParsed = extractAddressOnly(text);
            const regexEnough = regexParsed &&
              (regexParsed.postal || (regexParsed.city && regexParsed.state));
            let final: ParsedAddress | undefined = regexEnough
              ? regexParsed
              : undefined;
            // Fall back to the LLM for shapes the regex can't unambiguously
            // split — no commas, missing zip, lowercase city/state, etc.
            // The LLM's job is structured extraction only, no prose. We
            // accept its result if it gives us at least state OR (street
            // + city) — enough to render a real return address on docs.
            if (!final) {
              const llmParsed = await extractAddressViaLLM(
                this.llm,
                text,
                input.userId,
              );
              if (
                llmParsed &&
                (llmParsed.state || llmParsed.postal ||
                  (llmParsed.street && llmParsed.city))
              ) {
                final = llmParsed;
              }
            }
            if (final) {
              await this.addresses.upsert(input.userId, final);
              const ack = await this.messages.append({
                conversationId: conv.id,
                role: "assistant",
                kind: "text",
                content: postAddressAsk(firstName, needsEmail, needsPayout),
              });
              const updated = await this.conversations.update(conv.id, {
                preview: derivePreview(ack.content),
              });
              return { conversation: updated, newMessages: [userMsg, ack] };
            }
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: t(lang, "onboardingChat.address.reprompt"),
            });
            const updated = await this.conversations.update(conv.id, {
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
          if (!looksLikeJobRequest(text)) {
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: ONBOARD_ASK_ADDRESS(firstName, lang),
            });
            const updated = await this.conversations.update(conv.id, {
              ...(history.length === 1
                ? { title: deriveTitleFromFirstUserMessage(input.content) }
                : {}),
              preview: derivePreview(ask.content),
            });
            return { conversation: updated, newMessages: [userMsg, ask] };
          }
        } else if (needsEmail || needsPayout) {
          // 5) EMAIL + PAYMENT — combined ask, both optional. We parse
          //    out an email and a payment handle (whichever the user
          //    provided), persist them, and hand off. "skip" jumps
          //    straight to handoff so nothing here is blocking.
          const firstName = firstNameOf(me?.name);
          const justAskedPayout = lastAskInfo.payout;
          if (justAskedPayout) {
            if (!isSkipReply(text)) {
              const email = extractEmail(text);
              if (email) await this.users.update(input.userId, { email });
              const payout = extractPayout(text);
              if (payout) {
                const patch: Record<string, unknown> = {
                  ...(ident?.acceptedPaymentMethods ?? {}),
                };
                if (payout.method === "venmo") {
                  patch.venmo = { enabled: true, handle: payout.handle };
                } else if (payout.method === "cashapp") {
                  patch.cashapp = { enabled: true, cashtag: payout.handle };
                } else if (payout.method === "zelle") {
                  patch.zelle = { enabled: true, handle: payout.handle };
                } else if (payout.method === "check") {
                  patch.check = { enabled: true };
                } else if (payout.method === "cash") {
                  patch.cash = { enabled: true };
                } else if (payout.method === "ach") {
                  patch.ach = { enabled: true };
                } else {patch.other = {
                    enabled: true,
                    instructions: text.trim().slice(0, 200),
                  };}
                await this.identity.upsert(input.userId, {
                  acceptedPaymentMethods: patch as never,
                });
              }
            }
            const ack = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: ONBOARD_HANDOFF(firstName, lang),
            });
            const updated = await this.conversations.update(conv.id, {
              preview: derivePreview(ack.content),
            });
            return { conversation: updated, newMessages: [userMsg, ack] };
          }
          if (!looksLikeJobRequest(text)) {
            const ask = await this.messages.append({
              conversationId: conv.id,
              role: "assistant",
              kind: "text",
              content: ONBOARD_ASK_PAYOUT(firstName, lang),
            });
            const updated = await this.conversations.update(conv.id, {
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

    // Roadmap p.13: the assistant talks to the CONTRACTOR, so all of its
    // server-authored replies/cards follow their UI language (user.language).
    const contractor = await this.users.get(input.userId).catch(() =>
      undefined
    );
    const replyLang = contractor?.language === "es" ? "es" : "en";

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
            text: t(replyLang, "chatCoordinator.lockingQuote"),
            action: { type: "lock_quote", payload: { quoteId: conv.quoteId } },
          };
        }
      } catch {
        // Quote disappeared; fall through to the LLM.
      }
    }

    // ---- REQ-238 (demo M27): "change order for Maria: add … $40" ----
    // A change order changes an EXISTING job. When the sentence carries what
    // and how much, act on it without the LLM (as N5 does for "send it");
    // otherwise the LLM reads it — and if it still reaches for create_quote
    // (all it had in the demo), that is turned into the change order below.
    const changeOrderAsk = typeof input.content === "string"
      ? parseChangeOrderRequest(input.content)
      : undefined;
    if (
      !llmResponse && changeOrderAsk?.description &&
      typeof changeOrderAsk.deltaAmountCents === "number"
    ) {
      llmResponse = {
        text: "",
        action: {
          type: "change_order",
          payload: {
            ...(changeOrderAsk.customerName
              ? { customerName: changeOrderAsk.customerName }
              : {}),
            ...(changeOrderAsk.quoteNumber
              ? { quoteNumber: changeOrderAsk.quoteNumber }
              : {}),
            description: changeOrderAsk.description,
            deltaAmountCents: changeOrderAsk.deltaAmountCents,
          },
        },
      };
    }
    // REQ-315 (M26): "change order for Dana on Q-001: change plumbing
    // fixtures to $1,300" is a new price for a line already on the quote —
    // run it as the reprice, without the LLM, never as an added line.
    if (!llmResponse && changeOrderAsk?.reprice) {
      llmResponse = {
        text: "",
        action: {
          type: "revise_quote",
          payload: {
            ...(changeOrderAsk.customerName
              ? { customerName: changeOrderAsk.customerName }
              : {}),
            ...(changeOrderAsk.quoteNumber
              ? { quoteNumber: changeOrderAsk.quoteNumber }
              : {}),
            lines: [changeOrderAsk.reprice],
            remove: [],
          },
        },
      };
    }

    // ---- REQ-368 (demo-loop cycle 1, M30 + M32): a pricing question and a
    // billing ask are answered from the app's own data, before any chat
    // model — the model refused the first ("I can't provide pricing
    // advice…") and re-locked a signed quote for the second.
    const boundQuote = conv.quoteId
      ? await this.quotes.getOwned(conv.quoteId, input.userId)
        .catch(() => undefined)
      : undefined;
    const answerBilling = () =>
      new AnswerBilling(this.conversations, this.messages).run({
        userId: input.userId,
        conversation: conv,
        lang: replyLang,
      });
    const finishEarly = async (
      r: { conversation: AgentConversation; newMessages: AgentMessage[] },
    ): Promise<HandleChatResult> => {
      const first = history.length === 1 && history[0].id === userMsg.id;
      const conversation = first
        ? await this.conversations.update(conv.id, {
          title: deriveTitleFromFirstUserMessage(input.content),
        })
        : r.conversation;
      return { conversation, newMessages: [userMsg, ...r.newMessages] };
    };
    // M32: "John signed! Please send him the deposit invoice" → where the
    // bill stands (signing already sent the deposit invoice).
    if (
      !llmResponse && boundQuote && typeof input.content === "string" &&
      isInvoiceRequest(input.content)
    ) {
      const billed = await answerBilling();
      if (billed) return await finishEarly(billed);
    }
    // M30: "how much do i charge for panel swap 200a" → the three tiers of
    // the "help me price it" engine (SuggestPrices) and, for a new job in
    // the quote phase, a draft at the Market price.
    const pricingAsk = !llmResponse && !changeOrderAsk &&
        typeof input.content === "string"
      ? parsePricingQuestion(input.content)
      : undefined;
    const pricedSubject = pricingAsk?.job ||
      boundQuote?.jobName?.trim() || boundQuote?.summary?.trim() || "";
    if (pricingAsk && pricedSubject) {
      const draftIt = isInQuotePhase(conv) && !conv.quoteId && !!pricingAsk.job;
      const canUpdate = isInQuotePhase(conv) && !!boundQuote &&
        isOpenDraft(boundQuote) && !boundQuote.lockedAt;
      // Asking about the bound quote ("what should I charge for this?"):
      // price its words — never its amounts, which SuggestPrices would read
      // as a cost floor.
      const raw = pricingAsk.job || !boundQuote ? input.content : [
        input.content,
        `The job: ${pricedSubject}`,
        boundQuote.description ?? "",
        ...(boundQuote.lineItems ?? []).map((l) => l.description),
      ].filter((s) => s.trim()).join("\n");
      const addr = await this.addresses.get(input.userId).catch(() => null);
      const priced = await new SuggestPrices(this.llm).run({
        userId: input.userId,
        raw,
        lang: replyLang,
        ...(addr
          ? {
            address: {
              city: addr.city,
              state: addr.state,
              postal: addr.postal,
            },
          }
          : {}),
      });
      const market = priced.options.find((o) => o.tier === "market") ??
        priced.options[1] ?? priced.options[0];
      const text = pricingReply(replyLang, {
        job: pricedSubject,
        where: [addr?.city?.trim(), addr?.state?.trim()].filter(Boolean)
          .join(", "),
        options: priced.options,
        basis: priced.basis,
        ...(draftIt ? { draftedAt: market.label } : {}),
        offerUpdate: canUpdate,
      });
      const title = jobTitle(pricingAsk.job);
      llmResponse = draftIt
        ? {
          text,
          action: {
            type: "create_quote",
            payload: {
              summary: title,
              lineItems: [{
                description: title,
                amountCents: market.priceCents,
              }],
            },
          },
        }
        : { text };
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
              actionType?: string;
              status?: string;
              lineItems?: { description: string; amountCents: number }[];
              totalCents?: number;
            };
            const lines = (p.lineItems ?? [])
              .map((l) =>
                `  - ${l.description}: $${(l.amountCents / 100).toFixed(2)}`
              )
              .join("\n");
            const total = typeof p.totalCents === "number"
              ? `$${(p.totalCents / 100).toFixed(2)}`
              : "?";
            // REQ-368 (M32): an invoice card is the invoice — "[Quote sent:
            // … $1,600]" read the deposit as the quote's price and state.
            const card = p.actionType === "invoice" ? "Invoice" : "Quote";
            const summary = `[${card} ${p.status ?? "draft"}: ${
              m.content || ""
            }\n${lines}\nTotal: ${total}]`;
            return { role, content: summary };
          }
          if (m.kind === "continue_cta") {
            return { role, content: `[Continue-to-terms CTA shown]` };
          }
          const turn: LLMTurn = { role, content: m.content };
          if (m.kind === "image" && role === "user") {
            const fileId = (m.payload as { fileId?: unknown } | undefined)
              ?.fileId;
            if (typeof fileId === "string" && fileId) {
              try {
                const meta = await this.files.getOwnedMeta(
                  fileId,
                  input.userId,
                );
                const bytes = await this.files.readBytes(fileId);
                turn.images = [{ bytes, mimeType: meta.mimeType }];
              } catch (err) {
                console.error(
                  `[handle-chat] failed to load image ${fileId}:`,
                  err,
                );
              }
            }
          }
          return turn;
        }),
    );

    if (!llmResponse) {
      // REQ-375 (demo-loop cycle 2, M11): the terms prompt follows the bound
      // quote's state — after the send it said "tap Re-open on the quote
      // card above", a button a sent quote doesn't have.
      const base = isInQuotePhase(conv)
        ? SYSTEM_PROMPT_QUOTE
        : systemPromptTermsFor(boundQuote, {
          hasActionCard: !!conv.quoteId && history.some((m) => {
            const p = (m.payload ?? {}) as {
              actionType?: string;
              quoteId?: string;
            };
            return m.kind === "action_card" && p.actionType !== "invoice" &&
              p.quoteId === conv.quoteId;
          }),
        });
      // Roadmap p.13: the assistant talks to the CONTRACTOR, so it follows
      // their UI language (user.language) — it would be odd for the app to
      // be in Spanish while the assistant replies in English.
      const systemPrompt = replyLang === "es"
        ? `${base}\n\n${t("en", "prompts.contractorLanguageEsOverride")}`
        : base;
      // REQ-262 (demo M25): ground the model in the saved quote.
      let businessContext: string | undefined;
      if (conv.quoteId) {
        businessContext = await this.quotes.getOwned(
          conv.quoteId,
          input.userId,
        ).then(quoteContext).catch(() => undefined);
      }
      llmResponse = await this.llm.respond({
        systemPrompt,
        messages: llmTurns,
        userId: input.userId,
        ...(businessContext ? { businessContext } : {}),
        // REQ-368 (M32): only the tools this state allows — no lock / terms
        // once the quote is past drafting, no create / lock in the terms phase.
        tools: chatToolsFor(conv.currentPhase, boundQuote),
      });
    }

    // ---- REQ-368 (M32): lock_quote / request_terms_transition act only on
    // an open draft in the quote phase. Pair 1's terms-phase model re-locked
    // the SIGNED quote — an APPROVED card plus "Is this for a business or a
    // person?", which ended in "All terms answered.". Past drafting the answer
    // is where the bill stands; mid-terms, where the wizard is.
    const advance = llmResponse.action?.type;
    if (
      (advance === "lock_quote" || advance === "request_terms_transition") &&
      !mayAdvanceQuote(conv.currentPhase, boundQuote)
    ) {
      const answered = boundQuote && !isOpenDraft(boundQuote)
        ? await answerBilling()
        : await new TransitionToTerms(this.conversations, this.messages).run({
          userId: input.userId,
          conversationId: conv.id,
          lang: replyLang,
        });
      if (answered) return await finishEarly(answered);
      llmResponse = { text: t(replyLang, "chatCoordinator.noActionFallback") };
    }

    // REQ-238: a create_quote on a change-order request is the demo's bug
    // (a new separate quote) — run it as the change order it was asked for.
    if (changeOrderAsk && llmResponse.action?.type === "create_quote") {
      const items = llmResponse.action.payload.lineItems;
      llmResponse = {
        text: "",
        action: {
          type: "change_order",
          payload: {
            ...(changeOrderAsk.customerName
              ? { customerName: changeOrderAsk.customerName }
              : {}),
            ...(changeOrderAsk.quoteNumber
              ? { quoteNumber: changeOrderAsk.quoteNumber }
              : {}),
            description: changeOrderAsk.description ??
              (items.length === 1
                ? items[0].description
                : llmResponse.action.payload.summary),
            deltaAmountCents: changeOrderAsk.deltaAmountCents ??
              items.reduce((s, l) => s + l.amountCents, 0),
          },
        },
      };
    }
    // REQ-315: the reply to a revise — the coordinator's text; the payload
    // names the quote (the chat links it) and flags the bound one as updated
    // so the chat re-reads it.
    const replyWithRevision = async (result: ReviseQuoteResult) => {
      const o = result.outcome;
      const changedBound =
        (o.kind === "pending_revision" || o.kind === "draft_updated") &&
        o.quoteId === conv.quoteId;
      const reply = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: result.text,
        payload: {
          quoteRevision: o,
          ...(changedBound ? { quoteUpdated: o.quoteId } : {}),
        },
      });
      const patch: Partial<AgentConversation> = {
        preview: derivePreview(reply.content),
      };
      if (
        history.length === 0 ||
        (history.length === 1 && history[0].id === userMsg.id)
      ) {
        patch.title = deriveTitleFromFirstUserMessage(input.content);
      }
      const updated = await this.conversations.update(conv.id, patch);
      return { conversation: updated, newMessages: [userMsg, reply] };
    };
    const userText = typeof input.content === "string" ? input.content : "";

    // The change-order reply is the coordinator's, not the model's prose.
    if (llmResponse.action?.type === "change_order") {
      // REQ-315 (demo-loop cycle 1, M26): the demo's model answered "change
      // plumbing fixtures to $1,300" with change_order "Adjust plumbing
      // fixtures to $1,300" (+$150) — a FIFTH line. A change order that is a
      // reprice changes the line instead; on a signed quote (whose lines
      // never change, REQ-202) it stays the change order the model asked for.
      const reprice = changeOrderAsReprice(
        llmResponse.action.payload,
        userText,
      );
      if (reprice) {
        const revised = await this.reviseQuote.run({
          userId: input.userId,
          lang: replyLang,
          boundQuoteId: conv.quoteId,
          customerName: llmResponse.action.payload.customerName,
          quoteNumber: llmResponse.action.payload.quoteNumber,
          lines: [reprice],
          remove: [],
          userText,
        });
        if (revised.outcome.kind !== "locked") {
          return await replyWithRevision(revised);
        }
      }
      const result = await this.changeOrder.run({
        userId: input.userId,
        lang: replyLang,
        boundQuoteId: conv.quoteId,
        customerName: llmResponse.action.payload.customerName,
        quoteNumber: llmResponse.action.payload.quoteNumber,
        description: llmResponse.action.payload.description,
        deltaAmountCents: llmResponse.action.payload.deltaAmountCents,
      });
      const reply = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: result.text,
        payload: { changeOrder: result.outcome },
      });
      const patch: Partial<AgentConversation> = {
        preview: derivePreview(reply.content),
      };
      if (
        history.length === 0 ||
        (history.length === 1 && history[0].id === userMsg.id)
      ) {
        patch.title = deriveTitleFromFirstUserMessage(input.content);
      }
      const updated = await this.conversations.update(conv.id, patch);
      return { conversation: updated, newMessages: [userMsg, reply] };
    }

    // ---- REQ-315 (demo-loop cycle 1, M26): "change plumbing fixtures to
    // $1,300 on Q-001" changes THAT line of the existing quote — never a new
    // line (change_order) and never a new quote (create_quote). The reply is
    // the coordinator's; its payload names the quote (and flags the bound one
    // as updated so the chat re-reads it).
    if (llmResponse.action?.type === "revise_quote") {
      const p = llmResponse.action.payload;
      return await replyWithRevision(
        await this.reviseQuote.run({
          userId: input.userId,
          lang: replyLang,
          boundQuoteId: conv.quoteId,
          customerName: p.customerName,
          quoteNumber: p.quoteNumber,
          lines: p.lines,
          remove: p.remove,
          userText,
        }),
      );
    }

    // Whether this turn produces a rich follow-up bubble (action_card, etc.)
    // that supersedes any standalone assistant text. For these actions we
    // prefer NOT to persist a redundant prose bubble — the card carries the
    // real signal, and the chat UI renders transient typing dots while the
    // request is in flight (#36 — kill the persistent "Drafting a quote."
    // filler that lingers in scrollback after the card lands).
    const actionType = llmResponse.action?.type;
    const cardBearingAction = actionType === "create_quote" ||
      actionType === "lock_quote";

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
      // REQ-262 (demo M25): the bubble shows text verbatim — no markdown.
      replyText = toPlainChatText(stripCustomerAsk(llmText));
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
      replyText = t(replyLang, "chatCoordinator.onIt");
    } else {
      replyText = t(replyLang, "chatCoordinator.noActionFallback");
    }

    // REQ-267 (demo ai-assistant-p1-noreply) — the #36 suppression is for a
    // FIRST draft only. A create_quote that revises the bound draft is the
    // answer to a correction; landing it as a bare card read as "no reply",
    // and anything create_quote can't carry (a deposit) vanished silently.
    // When the model gave no usable prose, write the reply server-side from
    // the old → new line items.
    let existingDraft: Awaited<ReturnType<QuoteStore["getOwned"]>> | undefined;
    if (llmResponse.action?.type === "create_quote" && conv.quoteId) {
      try {
        const existing = await this.quotes.getOwned(conv.quoteId, input.userId);
        if (existing.status === "draft") existingDraft = existing;
      } catch {
        // Lookup failed — treated as a first draft below.
      }
    }
    // REQ-302 (demo-loop cycle 1, M29 + B1): a draft with no price — a
    // negative line, or a total at or below zero ("price abc" → one line at
    // 0; "-500") — is never persisted, bound or carded. The reply asks for
    // the price instead, replacing whatever the model said about the draft.
    const priceProblem = llmResponse.action?.type === "create_quote"
      ? quotePriceProblem(llmResponse.action.payload.lineItems)
      : undefined;
    if (priceProblem && llmResponse.action?.type === "create_quote") {
      replyText = t(replyLang, "chatCoordinator.priceMissing", {
        item: priceProblemItem(
          llmResponse.action.payload.lineItems,
          llmResponse.action.payload.summary,
        ),
      });
      suppressTextBubble = false;
    }
    if (
      suppressTextBubble && existingDraft && !priceProblem &&
      llmResponse.action?.type === "create_quote"
    ) {
      replyText = describeQuoteRevision(
        replyLang,
        existingDraft.lineItems.map((l) => ({
          description: l.description,
          priceCents: l.price * (l.quantity ?? 1),
        })),
        llmResponse.action.payload.lineItems.map((l) => ({
          description: l.description,
          priceCents: l.amountCents,
        })),
        input.content,
      );
      suppressTextBubble = false;
    }

    // ---- update_job_details (REQ-262, demo M25): rewrite / translate the
    // bound quote's job details. Applied BEFORE the reply is stored, because
    // the reply carries the outcome: `payload.quoteUpdated` tells the chat
    // island to re-read the quote; a refusal replaces any claim of success.
    // The quote is conv.quoteId — the model never names it — and prices and
    // line items are untouched.
    let replyPayload: Record<string, unknown> | undefined;
    if (llmResponse.action?.type === "update_job_details") {
      const byLang = llmResponse.action.payload.descriptionByLang;
      const current = conv.quoteId
        ? await this.quotes.getOwned(conv.quoteId, input.userId).catch(() =>
          undefined
        )
        : undefined;
      if (!current) {
        replyText = t(replyLang, "chatCoordinator.noActionFallback");
      } else if (
        JOB_DETAILS_LOCKED_STATUSES.has((current.status ?? "").toLowerCase())
      ) {
        replyText = t(replyLang, "chatCoordinator.jobDetailsLocked");
      } else {
        const merged: Record<string, string> = {
          ...(current.descriptionByLang ?? {}),
        };
        for (const [l, v] of Object.entries(byLang)) if (v) merged[l] = v;
        const base = byLang[replyLang];
        await this.quotes.update(current.id, input.userId, {
          descriptionByLang: merged,
          ...(base ? { description: base } : {}),
        });
        if (!llmText) {
          replyText = t(replyLang, "chatCoordinator.jobDetailsUpdated");
        }
        replyPayload = { quoteUpdated: current.id };
      }
      suppressTextBubble = false;
    }

    const newMessages: AgentMessage[] = [userMsg];
    if (!suppressTextBubble) {
      const assistantMsg = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: replyText,
        ...(replyPayload ? { payload: replyPayload } : {}),
      });
      newMessages.push(assistantMsg);
    }
    const convPatch: Partial<AgentConversation> = {};

    if (llmResponse.action) {
      const action = llmResponse.action;

      // ---- create_quote: persist real Quote → emit action_card with real id ----
      // (REQ-302: a priceless draft was refused above — no persist, no card.)
      if (action.type === "create_quote" && !priceProblem) {
        // Audit1 #3 — line item amounts persist as INTEGER CENTS, matching
        // the LLM's `amountCents` payload. The previous schema divided by
        // 100 here to store dollars; we no longer do that conversion.
        // quantity stays 1 because the LLM emits one totalled line per
        // trade (sqft/hours folded into the amount).
        const dtoLineItems = action.payload.lineItems.map((l) => ({
          description: l.description,
          quantity: 1,
          unit: "ea",
          price: l.amountCents,
        }));
        const estimatedTotal = action.payload.lineItems.reduce(
          (sum, l) => sum + l.amountCents,
          0,
        );

        // customerId is no longer accepted from the LLM — it was being
        // populated with raw names like "Mendez" and corrupting joins.
        // The conversation already carries a bound customerId when one
        // exists (set by start-conversation or the wizard's customer step);
        // we inherit that — or, REQ-331 (demo m7): a typed "for <Name>" /
        // phone / email that names one of the contractor's OWN customers
        // binds them here, so the wizard offers "Use María López" instead
        // of "Is this for a business or a person?".
        let customerId = conv.customerId;
        if (!customerId) {
          const known = await this.customerFromTypedFacts(
            input.userId,
            history,
          );
          if (known) {
            customerId = known.id;
            convPatch.customerId = known.id;
          }
        }

        // REQ-263 (demo ai-assistant-m2): the job address. The model's
        // `serviceAddress` when it set one; otherwise the address the user
        // typed in this conversation (latest user turn first) — "412 Oak St
        // Austin" must never be thrown away because the model left it off.
        const serviceAddress = action.payload.serviceAddress?.trim() ||
          [...history].reverse()
            .filter((m) => m.role === "user" && typeof m.content === "string")
            .map((m) => extractServiceAddress(m.content))
            .find((a): a is string => !!a);

        // N7 — update-in-place when the conversation already has a draft
        // quote bound. Previously each create_quote re-issue created a new
        // Quote row in the store, leaving orphans on every correction
        // ("bump labor to $2,100" → 2 rows in the DB). Update the existing
        // draft if one exists; otherwise create. Locked/sent quotes are
        // immutable, so fall through to creating a new one if the bound
        // quote is no longer in 'draft'.
        let quote;
        if (existingDraft) {
          try {
            quote = await this.quotes.update(existingDraft.id, input.userId, {
              summary: action.payload.summary,
              lineItems: dtoLineItems,
              estimatedTotal,
              // a correction without an address keeps the one on file
              ...(serviceAddress ? { serviceAddress } : {}),
              // REQ-331: a customer resolved this turn lands on the draft
              ...(customerId && !existingDraft.customerId
                ? { customerId }
                : {}),
            });
          } catch {
            // Update failed — fall through to create.
          }
        }
        if (!quote) {
          // REQ-337 (demo m6): the model's own job name when it gave a
          // valid one; otherwise the store derives it — in the CONTRACTOR's
          // language (a Spanish summary must not come out "Mantenimiento De
          // Jardín"), the summary's "— <customer>" tail stripped.
          const modelJobName = action.payload.jobName?.trim() ?? "";
          const jobName = isValidJobName(modelJobName)
            ? jobNameCase(modelJobName, replyLang)
            : undefined;
          quote = await this.quotes.create(input.userId, {
            summary: action.payload.summary,
            ...(jobName ? { jobName } : {}),
            lineItems: dtoLineItems,
            estimatedTotal,
            status: "draft",
            ...(customerId ? { customerId } : {}),
            ...(serviceAddress ? { serviceAddress } : {}),
          }, { jobNameLang: replyLang });
        }

        const card = await this.messages.append({
          conversationId: conv.id,
          role: "assistant",
          kind: "action_card",
          content: action.payload.summary,
          payload: {
            actionType: "quote",
            status: "draft",
            quoteId: quote.id, // real id from the store
            customerId: quote.customerId,
            lineItems: action.payload.lineItems, // keep cents-shape for the frontend
            totalCents: action.payload.lineItems.reduce(
              (s, l) => s + l.amountCents,
              0,
            ),
            // REQ-302 (demo B1): a reprice of the bound draft tells the chat
            // island to re-read the quote (as update_job_details does), so
            // the review card's TOTAL is never the pre-correction one.
            ...(existingDraft && quote.id === existingDraft.id
              ? { quoteUpdated: existingDraft.id }
              : {}),
          },
        });
        newMessages.push(card);

        // Bind to the conversation so a follow-up lock_quote knows what to lock.
        convPatch.quoteId = quote.id;

        // REQ-258 (demo M22): a payment split the contractor stated ("half
        // deposit") pre-selects the terms wizard's payment step. A later
        // correction that doesn't restate it keeps the earlier one.
        if (action.payload.paymentTerms) {
          convPatch.termsPrefill = {
            ...(conv.termsPrefill ?? {}),
            payment_terms: action.payload.paymentTerms,
          };
        }

        await this.bus.emit({
          userId: input.userId,
          entityType: "quote",
          entityId: quote.id,
          action: "drafted",
          data: { customerId, summary: action.payload.summary },
        });
      } // ---- lock_quote: lock the active quote (REQ-234: NOT send it) ----
      else if (action.type === "lock_quote") {
        // Use the conversation's quoteId, NOT the one the LLM made up. The
        // coordinator is the source of truth for which quote is "active".
        const quoteId = conv.quoteId ?? action.payload.quoteId;
        if (quoteId) {
          // REQ-234 (demo M3): locking is not sending. The quote stays a
          // draft with a lockedAt stamp — no status flip, no sentAt, no
          // `quote sent` event, no customer email. Send (SendQuote) does
          // all of that after the terms and the customer are on the quote.
          let locked = await this.quotes.getOwned(quoteId, input.userId);
          if (lockStatusFor(locked) === QUOTE_LOCKED && !locked.lockedAt) {
            locked = await this.quotes.update(quoteId, input.userId, {
              lockedAt: new Date().toISOString(),
            });
          }
          const status = lockStatusFor(locked);
          convPatch.quoteId = quoteId; // ensure conv.quoteId is set
          convPatch.quoteStatus = status;
          // Mirror the button-driven /lock-quote flow: emit an updated
          // action_card with status:"locked" + an automatic continue_cta so
          // a chat-flow lock ('lock it in') produces the same UI as clicking
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
          const totalCents = sentLineItems.reduce(
            (s, l) => s + l.amountCents,
            0,
          );
          const sentCard = await this.messages.append({
            conversationId: conv.id,
            role: "assistant",
            kind: "action_card",
            content: locked.summary ??
              t(
                replyLang,
                status === QUOTE_LOCKED
                  ? "chatCoordinator.quoteLocked"
                  : "chatCoordinator.quoteSent",
              ),
            payload: {
              actionType: "quote",
              status,
              quoteId,
              lineItems: sentLineItems,
              totalCents,
            },
          });
          newMessages.push(sentCard);
          // REQ-331 (demo m7/m44): a bound customer is named on the CTA —
          // never "Is this for a business or a person?" again.
          const knownName = await this.boundCustomerName(conv, input.userId);
          const cta = await this.messages.append({
            conversationId: conv.id,
            role: "assistant",
            kind: "continue_cta",
            content: knownName
              ? t(replyLang, "chatCoordinator.lockedToTermsCtaKnown", {
                name: knownName,
              })
              : t(replyLang, "chatCoordinator.lockedToTermsCta"),
            payload: {
              toPhase: "terms",
              quoteId,
              ...(knownName ? { customerName: knownName } : {}),
            },
          });
          newMessages.push(cta);
          // REQ-264 (M15): translate when the quote locks, so the review
          // card and the later send carry every language. REQ-234: locking
          // never emails or sends — only the translation runs here.
          await this.translator?.run({
            userId: input.userId,
            quoteId,
            baseLang: replyLang, // REQ-333 (M24): typed in the app language
          })
            .catch((err) =>
              console.error(`[chat:lock_quote] translate failed:`, err)
            );
        }
      } // ---- request_terms_transition: surface a "Continue to terms" card ----
      else if (action.type === "request_terms_transition") {
        const quoteId = conv.quoteId ?? action.payload.quoteId;
        const knownName = await this.boundCustomerName(conv, input.userId); // REQ-331
        const cta = await this.messages.append({
          conversationId: conv.id,
          role: "assistant",
          kind: "continue_cta",
          content: knownName
            ? t(replyLang, "chatCoordinator.lockedToTermsCtaKnown", {
              name: knownName,
            })
            : t(replyLang, "chatCoordinator.lockedToTermsCta"),
          payload: {
            toPhase: "terms",
            quoteId,
            ...(knownName ? { customerName: knownName } : {}),
          },
        });
        newMessages.push(cta);
      }
    }

    // Title locks in on the very first user message in the conversation.
    if (
      history.length === 0 ||
      (history.length === 1 && history[0].id === userMsg.id)
    ) {
      convPatch.title = deriveTitleFromFirstUserMessage(input.content);
    }
    // Audit P6.13 — preview priority: latest action_card (quote/invoice
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
