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
// REQ-388 (demo-loop cycle 2, M19 + M23 + m38): owed questions, several
// pricing subjects, follow-ups, "explain", and the draft offer.
import {
  asksHowPriced,
  chatToolsFor,
  isInvoiceRequest,
  isOpenDraft,
  jobTitle,
  mayAdvanceQuote,
  owedNameFromHistory,
  parseDraftRequest,
  parseOwedQuestion,
  parsePricingFollowUp,
  parsePricingQuestion,
  type PricingSubject,
  pricingSubjects,
  withoutPlace,
} from "@agents/domain/business/chat-routing/mod.ts";
import {
  type PricedSubject,
  pricingContext,
  pricingReply,
} from "@agents/domain/business/chat-answers/mod.ts";
import { liveDraftOffer } from "#quote-flow/chat-draft-offer.ts";
import { AnswerBilling } from "@agents/domain/coordinators/answer-billing/mod.ts";
import { AnswerOwed } from "@agents/domain/coordinators/answer-owed/mod.ts";
import { SuggestPrices } from "@agents/domain/coordinators/suggest-prices/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import {
  derivePreview,
  deriveTitleFromFirstUserMessage,
  titleFromJobName,
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
import {
  changeOrderNumbersIn, // REQ-462
  type ChangeOrderTarget,
  isNewQuoteRequest,
  parseChangeOrderEdit, // REQ-462
  parseChangeOrderRequest,
  parseTargetTotalChange,
  pickChangeOrderTarget,
  typedAmountsCents,
} from "@agents/domain/business/change-order-intent/mod.ts";
// REQ-438 (demo-loop cycle 3, M7): delete-an-invoice asks, and the language
// of the message itself.
import {
  parseInvoiceRemoval,
  sameDocNumber,
} from "@agents/domain/business/invoice-removal-intent/mod.ts";
import { messageLang } from "@agents/domain/business/message-language/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { isInvoiceLocked } from "#documents/versions.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { UpdateChatChangeOrder } from "@agents/domain/coordinators/update-chat-change-order/mod.ts"; // REQ-462
// REQ-583 (demo-loop cycle 4, M2): send the invoice / record a payment.
import { ChatBilling } from "@agents/domain/coordinators/chat-billing/mod.ts";
import {
  invoicesContext,
  liveSendOffer,
  namedCustomer,
  parsePaymentReport,
  parseSendInvoiceAsk,
} from "@agents/domain/business/chat-billing-intent/mod.ts";
import { isAccepted } from "#quote-flow/quote-status.ts";
import {
  ReviseQuote,
  type ReviseQuoteInput,
  type ReviseQuoteResult,
} from "@agents/domain/coordinators/revise-quote/mod.ts";
import { changeOrderAsReprice } from "@agents/domain/business/quote-line-revision/mod.ts";
// REQ-445 (demo-loop cycle 3, B2 + M20): the stated total and the price
// checks a chat-drafted quote gets before it is saved.
import {
  draftTotalCents,
  settleCreateQuote,
  statedTotalCents,
  statedTotalNote,
} from "@agents/domain/business/stated-price/mod.ts";
import {
  acceptModelServiceAddress,
  extractServiceAddress,
} from "#quote-flow/quick-quote-prefill.ts";
import { extractQuoteFacts } from "#quote-flow/quote-facts.ts"; // REQ-331
import {
  findCustomerNamedInSummary, // REQ-576
  findCustomerNamedInText, // REQ-386
  findExistingCustomer, // REQ-331
} from "#quote-flow/customer-dedupe.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { Customer } from "@crm/dto/customer.ts";
import { isValidJobName, jobNameCase } from "#quote-flow/job-name.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
// REQ-392 (demo-loop cycle 2, M7): a message typed on a guided step.
import {
  type ChatStepHint,
  statedPriceCents,
} from "#quote-flow/step-composer.ts";
import {
  appliedStepTurnIds, // REQ-585
  isFallbackPricing,
  jobOptionsStepReply,
  priceStepContext,
  type PriceStepIntent,
  priceStepIntent,
  priceStepReply,
  stepContextLine,
  stepJobOptionsRaw,
  stepLangs,
  stepMoney,
  stepScopeText,
  stepTools,
} from "@agents/domain/business/chat-step/mod.ts";
// REQ-444 (demo-loop cycle 3, M21): every tool call the model made, and a
// reply built from what actually changed.
import {
  type EditAction,
  type JobDetailsChange,
  jobDetailsChangeLine,
  jobDetailsChangeOf,
  notDoneLine,
  planToolCalls,
  pricesSameLine,
  proseAnswer, // REQ-585
  sameJobDetails,
  toolCallsOf,
  totalMoveLine,
  workingTotalCents,
} from "@agents/domain/business/tool-calls/mod.ts";
import { GenerateJobOptions } from "@agents/domain/coordinators/generate-job-options/mod.ts";
import {
  missedTypedItems,
  typedWorkItems,
} from "#quote-flow/typed-coverage.ts";
import { customerFactsFrom } from "#quote-flow/option-bullets.ts";
import { getWizardSpec } from "@agents/domain/business/terms-wizard-spec/mod.ts";
// REQ-585 (demo-loop cycle 4, M4 + M30): the terms typed in the chat.
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";
import {
  mentionedTerms,
  termsChangeLine,
  termsNotAppliedLine,
  termsPicks,
} from "@agents/domain/business/terms-edit/mod.ts";

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

/** REQ-388 (M23 + m38): the prices a pricing answer gave, as its payload
 *  carries them — the context a follow-up is priced with. */
function pricingOf(m: AgentMessage | undefined): PricedSubject[] | undefined {
  if (!m || m.role !== "assistant" || m.kind !== "text") return undefined;
  const p = (m.payload as { pricing?: { subjects?: unknown } } | undefined)
    ?.pricing;
  const subjects = Array.isArray(p?.subjects) ? p.subjects : [];
  const out = subjects.filter((x): x is PricedSubject =>
    !!x && typeof x === "object" &&
    typeof (x as PricedSubject).job === "string" &&
    Array.isArray((x as PricedSubject).options)
  );
  return out.length ? out : undefined;
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
  /** REQ-392 (demo-loop cycle 2, M7): the guided step a text was typed on
   *  (the compact "Tell the assistant…" box). Pick a price re-prices, Job
   *  details rewrites the versions, a wizard question / the Ready-to-send
   *  review reach the model with the step in its context. Never onboarding. */
  step?: ChatStepHint;
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
    /** REQ-462 (demo-loop cycle 3, M26): edits / withdraws a change order
     *  named by its number ("CO-001"). */
    private changeOrderEdit?: UpdateChatChangeOrder,
    /** REQ-583 (demo-loop cycle 4, M2): sends the invoice and records the
     *  payment the contractor reports. */
    private billing?: ChatBilling,
    /** REQ-585 (demo-loop cycle 4, M4 + M30): sets the agreement terms the
     *  contractor gives in the chat (update_terms) through the wizard. */
    private wizard?: HandleWizardAnswer,
  ) {}

  /** REQ-585 (demo-loop cycle 4, M4): the terms-phase start date / time to
   *  complete the message asks to change that no call set — said in the
   *  reply, never passed over (pair 7's "the start should be next week …"
   *  got a price answer only). Steps the conversation's wizard doesn't have
   *  are not asked for. */
  private async termsMissed(
    conv: AgentConversation,
    text: unknown,
    set: readonly string[],
  ): Promise<string[]> {
    if (isInQuotePhase(conv) || typeof text !== "string") return [];
    const state = await this.conversations.getWizardState(conv.id)
      .catch(() => undefined);
    if (!state) return [];
    const steps = getWizardSpec(state.specId).steps.map((s) => s.id);
    return mentionedTerms(text).filter((id) =>
      steps.includes(id) && !set.includes(id)
    );
  }

  /** REQ-438 (M7): which of the contractor's quotes a change order would
   *  land on — the same pick ApplyChatChangeOrder makes. */
  private async changeOrderTarget(
    userId: string,
    ask: { customerName?: string; quoteNumber?: string; boundQuoteId?: string },
  ): Promise<ChangeOrderTarget> {
    const [quotes, customers] = await Promise.all([
      this.quotes.listByUser(userId).catch(() => []),
      (this.customers ?? new CustomerStore()).listByUser(userId)
        .catch(() => []),
    ]);
    return pickChangeOrderTarget({
      quotes: quotes.map((q) => ({
        id: q.id,
        customerId: q.customerId,
        status: q.status,
        createdAt: q.createdAt,
        number: q.number,
      })),
      customers: customers.map((c) => ({ id: c.id, name: c.name })),
      ...ask,
    });
  }

  /** REQ-583 (demo-loop cycle 4, M2, pair 6): the job of the customer a
   *  billing ask names ("Job done for Carmen Ruiz … make the invoice") — as a
   *  conversation binding — when there is one to bill: their one open job,
   *  else the one of theirs that is signed. Undefined when nobody on file is
   *  named, or which job is unclear. */
  private async namedCustomersJob(
    userId: string,
    text: string,
  ): Promise<{ quoteId: string; customerId: string } | undefined> {
    const customers = this.customers
      ? await this.customers.listByUser(userId).catch(() => [])
      : [];
    const who = namedCustomer(customers, text);
    if (!who) return undefined;
    const target = await this.changeOrderTarget(userId, {
      customerName: who.name,
    });
    if (target.kind === "quote") {
      return { quoteId: target.quoteId, customerId: who.id };
    }
    if (target.kind !== "ambiguous") return undefined;
    const signed = (await Promise.all(
      target.quoteIds.map((id) =>
        this.quotes.getOwned(id, userId).catch(() => undefined)
      ),
    )).filter((q) => !!q && isAccepted(q));
    return signed.length === 1
      ? { quoteId: signed[0]!.id, customerId: who.id }
      : undefined;
  }

  /** REQ-438 (M7): the answer to "delete invoice INV-001" — where to delete
   *  it (Invoices › the invoice › Delete invoice), or that a paid one stays. */
  private async invoiceRemovalReply(
    userId: string,
    lang: "en" | "es",
    number: string | undefined,
  ): Promise<string> {
    if (!number) return t(lang, "chatCoordinator.invoiceRemoval.generic");
    const invoices = await new InvoiceStore().listByUser(userId)
      .catch(() => []);
    const inv = invoices.find((i) =>
      typeof i.number === "string" && sameDocNumber(i.number, number)
    );
    if (!inv) {
      return t(lang, "chatCoordinator.invoiceRemoval.notFound", { number });
    }
    const label = inv.number ?? number;
    if (isInvoiceLocked(inv)) {
      return t(lang, "chatCoordinator.invoiceRemoval.paid", { number: label });
    }
    const cents = inv.amount ?? 0;
    return t(lang, "chatCoordinator.invoiceRemoval.how", {
      number: label,
      amount: `$${
        (cents / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      }`,
    });
  }

  /** REQ-331: the same-owner customer the thread's typed facts name — by
   *  phone, email, then accent-folded name; REQ-386 (demo m17): else the one
   *  customer whose whole name is typed as Capitalized words ("Bob wants 6
   *  recessed lights" → the existing Bob); REQ-576 (demo-loop cycle 4, m26):
   *  else the one customer the model's summary names after its dash
   *  ("Electrical outlet installation — Bob Smith"), matched only against
   *  the account's own customers; null when nobody matches. */
  private async customerFromTypedFacts(
    userId: string,
    history: AgentMessage[],
    summary?: string,
  ): Promise<{ id: string; name: string } | null> {
    if (!this.customers) return null;
    const typed = history
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => m.content as string)
      .join("\n");
    if (!typed.trim() && !summary) return null;
    const facts = extractQuoteFacts(typed, new Date());
    const mine: Customer[] = await this.customers.listByUser(userId)
      .catch(() => []);
    return findExistingCustomer(mine, {
      name: facts.customerName,
      email: facts.customerEmail,
      phoneNumber: facts.customerPhone,
    }) ?? findCustomerNamedInText(mine, typed) ??
      findCustomerNamedInSummary(mine, summary);
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

  /** REQ-392: the open wizard question the message was typed on, as the
   *  model reads it ("Customer: …"); undefined off a wizard step. */
  private async stepQuestion(
    conversationId: string,
    step: ChatStepHint | undefined,
  ): Promise<string | undefined> {
    if (step?.id !== "wizard" || !step.wizardStepId) return undefined;
    try {
      const state = await this.conversations.getWizardState(conversationId);
      const spec = state ? getWizardSpec(state.specId) : undefined;
      const s = spec?.steps.find((x) => x.id === step.wizardStepId);
      return s ? `${t("en", s.label)}: ${t("en", s.question)}` : undefined;
    } catch {
      return undefined;
    }
  }

  /** REQ-392: the job the contractor typed — the step's own copy, else the
   *  thread's first typed message (the details note), never a step turn. */
  private typedJob(
    step: ChatStepHint,
    history: AgentMessage[],
    userMsg: AgentMessage,
  ): string {
    if (step.job?.trim()) return step.job.trim();
    const note = history.find((m) =>
      m.id !== userMsg.id && m.role === "user" && m.kind === "text" &&
      !(m.payload as { step?: unknown } | undefined)?.step &&
      typeof m.content === "string" && m.content.trim()
    );
    return note?.content.trim() ?? "";
  }

  /** REQ-392: store a step reply and touch the conversation (preview; the
   *  title only on a thread's very first message — from the job, never the
   *  correction). */
  private async finishStep(
    conv: AgentConversation,
    history: AgentMessage[],
    userMsg: AgentMessage,
    job: string,
    reply: { content: string; payload: Record<string, unknown> },
  ): Promise<HandleChatResult> {
    const msg = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "text",
      content: reply.content,
      payload: reply.payload,
    });
    const first = history.length === 1 && history[0].id === userMsg.id;
    const updated = await this.conversations.update(conv.id, {
      preview: derivePreview(msg.content),
      ...(first
        ? { title: deriveTitleFromFirstUserMessage(job || userMsg.content) }
        : {}),
    });
    return { conversation: updated, newMessages: [userMsg, msg] };
  }

  /**
   * REQ-392 (demo-loop cycle 2, M7) — typed on Pick a price ("no that's wrong,
   * it's the whole gut job — more like $28k"). With the tiers on screen the
   * pricing engine re-prices the job with the correction riding beside the
   * confirmed scope — never in the job text, whose amounts are the cost floor
   * (a price the contractor names is their price, not a cost). The reply
   * carries the new tiers and the one price the correction named, for the
   * price box. No quote is made: the price step's Continue does that.
   */
  private async repriceOnStep(
    input: HandleChatInput,
    conv: AgentConversation,
    userMsg: AgentMessage,
    history: AgentMessage[],
    step: ChatStepHint,
    lang: "en" | "es",
  ): Promise<HandleChatResult> {
    const correction = input.content;
    const job = this.typedJob(step, history, userMsg);
    const tiers = step.tiers === true;
    let priced:
      | Awaited<ReturnType<SuggestPrices["run"]>>
      | undefined;
    if (tiers) {
      const addr = await this.addresses.get(input.userId).catch(() => null);
      priced = await new SuggestPrices(this.llm).run({
        userId: input.userId,
        raw: job || correction,
        scope: stepScopeText(step.scope, correction),
        lang,
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
    }
    const stated = statedPriceCents(correction);
    // The engine's generic tiers (model unreachable / junk) say nothing about
    // the correction: the tiers on screen stay and the reply says so.
    const repriced = priced && !isFallbackPricing(priced.options)
      ? priced
      : undefined;
    return await this.finishStep(conv, history, userMsg, job, {
      content: priceStepReply(lang, {
        tiers,
        options: priced?.options,
        statedCents: stated,
      }),
      payload: {
        step: "price",
        ...(repriced ? { priceSuggestions: repriced } : {}),
        ...(stated ? { statedPriceCents: stated } : {}),
      },
    });
  }

  /**
   * REQ-392 (demo-loop cycle 2, M7) — typed on the Job details picker ("add
   * the heated floor and the permit"). The three versions are rewritten from
   * the job, the version on screen and the correction, in the app and comms
   * languages plus any the job or the correction asks for; the reply carries
   * them for the picker (whose Continue writes the picked one to the quote).
   * When the writer can't be reached the versions on screen stay as they are:
   * the heuristic fallback would split this prompt's own framing into
   * bullets, so the reply says so honestly and carries no versions.
   */
  private async rewriteJobOnStep(
    input: HandleChatInput,
    conv: AgentConversation,
    userMsg: AgentMessage,
    history: AgentMessage[],
    step: ChatStepHint,
    lang: "en" | "es",
  ): Promise<HandleChatResult> {
    const correction = input.content;
    const job = this.typedJob(step, history, userMsg);
    const ident = await this.identity.get(input.userId).catch(() => null);
    const comms = ident?.commsLanguages && ident.commsLanguages.length
      ? ident.commsLanguages
      : [ident?.commsLanguage ?? "en"];
    const res = await new GenerateJobOptions(this.llm).run({
      userId: input.userId,
      raw: stepJobOptionsRaw(job, step.scope, correction),
      // REQ-439 (M9): the job and the correction are what every version is
      // checked against — the request's framing is not the contractor's.
      typed: `${job}\n${correction}`,
      langs: stepLangs(lang, comms, `${job}\n${correction}`),
    });
    return await this.finishStep(conv, history, userMsg, job, {
      content: jobOptionsStepReply(lang, res.degraded),
      payload: {
        step: "job_details",
        ...(res.degraded
          ? {}
          : { jobOptions: { options: res.options, degraded: false } }),
      },
    });
  }

  /**
   * REQ-444 (demo-loop cycle 3, M21) — a question or a change to the job
   * typed on Pick a price ("does this include the quartz slab material or
   * just labor?? … ¿y el precio incluye el permiso de plomería? add permit if
   * not"). The chat model answers with the job, the details on screen, the
   * tiers on screen and what they include in its context. Its one tool is
   * update_job_details, which here rewrites the job details on screen (no
   * quote exists yet): then the reply says what changed, the tiers are
   * re-priced for the new details, and the reply carries them for the step.
   * Otherwise the tiers on screen stay — only a price correction re-prices
   * (repriceOnStep). A price the message named for the job fills the box.
   */
  private async answerOnPriceStep(
    input: HandleChatInput,
    conv: AgentConversation,
    userMsg: AgentMessage,
    history: AgentMessage[],
    step: ChatStepHint,
    lang: "en" | "es",
    intent: PriceStepIntent,
  ): Promise<HandleChatResult> {
    const said = input.content;
    const job = this.typedJob(step, history, userMsg);
    const shown = step.scope?.trim() || job;
    const stated = intent.statedCents;
    const filled = stated ? { statedPriceCents: stated } : {};
    // The thread's typed turns (the job, earlier step turns and their
    // answers), this message last.
    const turns: LLMTurn[] = history
      .filter((m) =>
        (m.role === "user" || m.role === "assistant") &&
        (m.kind === "text" || m.kind === "voice") &&
        typeof m.content === "string" && m.content.trim().length > 0
      )
      .map((m) => ({ role: m.role, content: m.content }));
    const langRule = lang === "es"
      ? `\n\n${t("en", "prompts.contractorLanguageEsOverride")}`
      : "";
    const res = await this.llm.respond({
      systemPrompt: `${t("en", "prompts.chatStep.price")}${langRule}`,
      messages: turns,
      userId: input.userId,
      businessContext: priceStepContext({
        job,
        scope: shown,
        lang,
        options: step.options,
        basis: step.basis,
        statedCents: stated,
      }),
      tools: ["update_job_details"],
    }).catch((err) => {
      console.error("[handle-chat] price-step answer failed:", err);
      return undefined;
    });
    if (!res) {
      return await this.finishStep(conv, history, userMsg, job, {
        content: t(lang, "chatCoordinator.step.askFailed"),
        payload: { step: "price", ...filled },
      });
    }

    const answer = toPlainChatText(res.text ?? "").trim();
    const rewrite = toolCallsOf(res).find((a) =>
      a.type === "update_job_details"
    );
    const byLang: Record<string, string> = {};
    if (rewrite?.type === "update_job_details") {
      for (const [l, v] of Object.entries(rewrite.payload.descriptionByLang)) {
        if (v?.trim()) byLang[l] = v.trim();
      }
    }
    const next = byLang[lang] ?? Object.values(byLang)[0];
    const changed = !!next && !sameJobDetails(next, shown);
    const parts = answer ? [answer] : [];
    let repriced: Awaited<ReturnType<SuggestPrices["run"]>> | undefined;
    if (changed) {
      parts.push(jobDetailsChangeLine(lang, { before: shown, after: next }));
      if (step.tiers === true) {
        const addr = await this.addresses.get(input.userId).catch(() => null);
        const priced = await new SuggestPrices(this.llm).run({
          userId: input.userId,
          raw: job || said,
          scope: stepScopeText(next, said),
          lang,
          ...(addr
            ? {
              address: {
                city: addr.city,
                state: addr.state,
                postal: addr.postal,
              },
            }
            : {}),
        }).catch(() => undefined);
        repriced = priced && !isFallbackPricing(priced.options)
          ? priced
          : undefined;
        parts.push(
          repriced
            ? t(lang, "chatCoordinator.step.repricedScope", {
              tiers: repriced.options
                .map((o) => `${o.label} ${stepMoney(o.priceCents)}`)
                .join(" · "),
            })
            : t(lang, "chatCoordinator.step.repriceFailed"),
        );
      }
    } else if (intent.scopeChange) {
      // It asked for a change the model did not make: never let an answer
      // pass for one.
      parts.push(t(lang, "chatCoordinator.step.scopeUnchanged"));
    }
    if (stated && !answer.includes(stepMoney(stated))) {
      parts.push(
        t(
          lang,
          step.tiers === true
            ? "chatCoordinator.step.priceSetTiers"
            : "chatCoordinator.step.priceSet",
          { amount: stepMoney(stated) },
        ),
      );
    }
    if (parts.length === 0) {
      parts.push(t(lang, "chatCoordinator.step.askFailed"));
    }
    return await this.finishStep(conv, history, userMsg, job, {
      content: parts.join(" "),
      payload: {
        step: "price",
        ...(changed ? { scope: next, scopeByLang: byLang } : {}),
        ...(repriced ? { priceSuggestions: repriced } : {}),
        ...filled,
      },
    });
  }

  /**
   * REQ-262 (demo M25) / REQ-444: merge the model's per-language job details
   * onto the bound quote — conv.quoteId, never a model-named one, and never a
   * signed one. Prices and line items are untouched. Says what changed so the
   * reply can be built from it.
   */
  private async writeJobDetails(
    conv: AgentConversation,
    userId: string,
    byLang: Partial<Record<"en" | "es", string>>,
    lang: "en" | "es",
  ): Promise<
    | { kind: "none" }
    | { kind: "locked" }
    | {
      kind: "updated";
      quoteId: string;
      change: JobDetailsChange;
      totalCents: number;
    }
  > {
    const current = conv.quoteId
      ? await this.quotes.getOwned(conv.quoteId, userId).catch(() => undefined)
      : undefined;
    if (!current) return { kind: "none" };
    if (JOB_DETAILS_LOCKED_STATUSES.has((current.status ?? "").toLowerCase())) {
      return { kind: "locked" };
    }
    const merged: Record<string, string> = {
      ...(current.descriptionByLang ?? {}),
    };
    for (const [l, v] of Object.entries(byLang)) if (v) merged[l] = v;
    const base = byLang[lang];
    await this.quotes.update(current.id, userId, {
      descriptionByLang: merged,
      ...(base ? { description: base } : {}),
    });
    return {
      kind: "updated",
      quoteId: current.id,
      change: jobDetailsChangeOf(lang, current, byLang),
      totalCents: workingTotalCents(current),
    };
  }

  /**
   * REQ-444 (demo-loop cycle 3, M21) — several changes to the quote in one
   * turn ("fix the Spanish … and add a plumbing permit line $450"): EVERY one
   * runs — the job details first, then each line change in the model's order
   * (planToolCalls) — and ONE reply says what actually changed: the job
   * details' languages and lines, each line change's own words (the change
   * order and revise coordinators'), and the total's move. When only the job
   * details changed on a message that named an amount, it says no price did.
   *
   * REQ-585 (demo-loop cycle 4, M4 + M30): update_terms runs here too — each
   * term through the wizard (HandleWizardAnswer.change), its pick and next
   * question going out before the reply — and a term the message asked for
   * that nothing set is said. The model's own answer to what was asked
   * ("is 50% normal in texas?") follows the outcome lines, minus its claims
   * of what changed (`prose`, proseAnswer).
   */
  private async applyEditCalls(
    input: HandleChatInput,
    conv: AgentConversation,
    userMsg: AgentMessage,
    history: AgentMessage[],
    edits: EditAction[],
    lang: "en" | "es",
    dropped: readonly string[],
    prose = "",
  ): Promise<HandleChatResult> {
    const userId = input.userId;
    const userText = typeof input.content === "string" ? input.content : "";
    const readBound = () =>
      conv.quoteId
        ? this.quotes.getOwned(conv.quoteId, userId).catch(() => undefined)
        : Promise.resolve(undefined);
    const before = await readBound();
    const parts: string[] = [];
    const payload: Record<string, unknown> = {};
    // A revise's own reply states the total it left; the closing total line
    // is only added when the total moved again after it.
    let totalSaid: number | undefined;
    // REQ-585: the wizard messages a term made (its pick, the next question)
    // go out before the reply, as they sit in the transcript; terms that
    // could not be set are named.
    const wizardMessages: AgentMessage[] = [];
    const termsSet: string[] = [];
    const termsNotSet: string[] = [];
    // REQ-585 (M4): a revise naming a job-details bullet is said to be one —
    // and says nothing more once this turn rewrote the job details.
    let detailsUpdated = false;
    const jobDetails = before
      ? [before.description, ...Object.values(before.descriptionByLang ?? {})]
        .filter((d): d is string => typeof d === "string" && !!d.trim())
        .join("\n")
      : undefined;
    // A line change on the bound quote flags the reply, so an open review
    // re-reads the quote (REQ-392).
    const landed = (o: { kind: string; quoteId?: string }) => {
      if (
        (o.kind === "draft_updated" || o.kind === "pending_revision") &&
        o.quoteId === conv.quoteId
      ) payload.quoteUpdated = o.quoteId;
    };
    const revise = (
      p: Pick<
        ReviseQuoteInput,
        "customerName" | "quoteNumber" | "lines" | "remove"
      >,
    ) =>
      this.reviseQuote.run({
        userId,
        lang,
        boundQuoteId: conv.quoteId,
        customerName: p.customerName,
        quoteNumber: p.quoteNumber,
        lines: p.lines,
        remove: p.remove,
        userText,
        jobDetails,
        jobDetailsUpdated: detailsUpdated,
      });
    for (const edit of edits) {
      if (edit.type === "update_terms") {
        const { picks, unread } = termsPicks(edit.payload);
        termsNotSet.push(...unread);
        const state = await this.conversations.getWizardState(conv.id)
          .catch(() => undefined);
        const spec = state ? getWizardSpec(state.specId) : undefined;
        for (const pick of picks) {
          termsSet.push(pick.stepId);
          const step = spec?.steps.find((s) => s.id === pick.stepId);
          const done = this.wizard && step
            ? await this.wizard.change({
              userId,
              conversationId: conv.id,
              ...pick,
            })
            : undefined;
          if (!done || !step || done.kind === "missing") {
            termsNotSet.push(pick.stepId);
            continue;
          }
          if (done.kind === "answered") {
            wizardMessages.push(...done.result.newMessages);
          }
          if (done.kind === "changed") wizardMessages.push(done.pick);
          if (
            done.kind === "answered" || done.kind === "changed" ||
            (done.kind === "later" && done.prefilled)
          ) {
            payload.termsChanged = true;
            if (done.kind !== "later" && conv.quoteId) {
              payload.quoteUpdated = conv.quoteId;
            }
          }
          parts.push(termsChangeLine(lang, {
            kind: done.kind,
            step,
            to: done.to,
            ...("from" in done ? { from: done.from } : {}),
            ...(done.kind === "later" ? { prefilled: done.prefilled } : {}),
          }));
        }
        continue;
      }
      if (edit.type === "update_job_details") {
        const done = await this.writeJobDetails(
          conv,
          userId,
          edit.payload.descriptionByLang,
          lang,
        );
        if (done.kind === "updated") {
          parts.push(jobDetailsChangeLine(lang, done.change));
          payload.quoteUpdated = done.quoteId;
          detailsUpdated = true;
        } else {
          parts.push(
            t(
              lang,
              done.kind === "locked"
                ? "chatCoordinator.jobDetailsLocked"
                : "chatCoordinator.jobDetails.noQuote",
            ),
          );
        }
        continue;
      }
      if (edit.type === "change_order") {
        const p = edit.payload;
        // REQ-315: a change order that is a reprice changes that line —
        // unless the quote is signed (its lines never change, REQ-202).
        const reprice = p.targetTotalCents === undefined
          ? changeOrderAsReprice(p, userText)
          : undefined;
        if (reprice) {
          const revised = await revise({ ...p, lines: [reprice], remove: [] });
          if (revised.outcome.kind !== "locked") {
            parts.push(revised.text);
            payload.quoteRevision = revised.outcome;
            landed(revised.outcome);
            const now = await readBound();
            totalSaid = now ? workingTotalCents(now) : totalSaid;
            continue;
          }
        }
        const result = await this.changeOrder.run({
          userId,
          lang,
          boundQuoteId: conv.quoteId,
          customerName: p.customerName,
          quoteNumber: p.quoteNumber,
          description: p.description,
          deltaAmountCents: p.deltaAmountCents,
          targetTotalCents: p.targetTotalCents, // REQ-377: settled in code
          userText,
        });
        parts.push(result.text);
        payload.changeOrder = result.outcome;
        landed(result.outcome);
        continue;
      }
      const revised = await revise(edit.payload);
      // REQ-585: a bullet the job details already reworded says nothing.
      if (!revised.text) continue;
      parts.push(revised.text);
      payload.quoteRevision = revised.outcome;
      landed(revised.outcome);
      const now = await readBound();
      totalSaid = now ? workingTotalCents(now) : totalSaid;
    }
    const after = await readBound();
    if (before && after) {
      const from = workingTotalCents(before);
      const to = workingTotalCents(after);
      const lineEdits = edits.some((e) =>
        e.type !== "update_job_details" && e.type !== "update_terms"
      );
      if (from !== to && totalSaid !== to) {
        parts.push(totalMoveLine(lang, from, to));
      } else if (
        from === to && !lineEdits && typedAmountsCents(userText).length > 0
      ) {
        parts.push(pricesSameLine(lang, to));
      }
    }
    // REQ-585: a term the message asked for that nothing set is said.
    const missed = [
      ...new Set([
        ...termsNotSet,
        ...await this.termsMissed(conv, userText, termsSet),
      ]),
    ];
    const notSet = termsNotAppliedLine(lang, missed);
    if (notSet) parts.push(notSet);
    const notDone = notDoneLine(lang, dropped);
    if (notDone) parts.push(notDone);
    // REQ-585 (M4): the model's answer to what was asked follows — minus its
    // own claims of what changed, which the lines above say from the facts.
    const answer = toPlainChatText(proseAnswer(stripCustomerAsk(prose)));
    if (answer) parts.push(answer);
    const reply = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "text",
      content: parts.filter(Boolean).join(" "),
      payload,
    });
    const first = history.length === 1 && history[0].id === userMsg.id;
    const updated = await this.conversations.update(conv.id, {
      preview: derivePreview(reply.content),
      ...(first
        ? { title: deriveTitleFromFirstUserMessage(input.content) }
        : {}),
    });
    return {
      conversation: updated,
      newMessages: [userMsg, ...wizardMessages, reply],
    };
  }

  async run(input: HandleChatInput): Promise<HandleChatResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");

    // REQ-392 (demo-loop cycle 2, M7): typed in the compact composer on a
    // guided step. Recorded on the message (`step`, and the open question as
    // `stepQuestion` — never `wizardStepId`, which would mark it answered).
    const step = (input.kind ?? "text") === "text" ? input.step : undefined;
    const stepTag = step
      ? {
        step: step.id,
        ...(step.wizardStepId ? { stepQuestion: step.wizardStepId } : {}),
      }
      : undefined;
    const userPayload = input.payload || stepTag
      ? { ...(input.payload ?? {}), ...(stepTag ?? {}) }
      : undefined;
    const userMsg = await this.messages.append({
      conversationId: conv.id,
      role: "user",
      kind: input.kind ?? "text",
      content: input.content,
      ...(userPayload ? { payload: userPayload } : {}),
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
    // REQ-392: a step turn is mid-flow — never answered with a profile ask.
    if (inputIsText && !step) {
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
    // REQ-438 (demo-loop cycle 3, M7): …in the language the contractor TYPED
    // this message in, when it reads clearly as one — pair 6's app was in
    // English, they wrote Spanish, and every reply came back in English.
    const replyLang =
      (typeof input.content === "string"
        ? messageLang(input.content)
        : undefined) ??
        (contractor?.language === "es" ? "es" : "en");

    // ---- REQ-392 (demo-loop cycle 2, M7): typed on Pick a price / Job
    // details. There is no quote yet on those steps (or the picker is about
    // to overwrite its details), so the step itself is what changes: the
    // tiers re-priced, the versions rewritten — carried on the reply.
    // REQ-444 (demo-loop cycle 3, M21): on Pick a price a question or a
    // change to the job is answered by the chat model with the tiers in
    // context ("does this include the quartz material? … add permit if not"
    // got only "Re-priced with your note — …"); only a price correction
    // re-prices.
    if (step?.id === "price") {
      const intent = priceStepIntent(input.content);
      if (intent.route === "ask") {
        return await this.answerOnPriceStep(
          input,
          conv,
          userMsg,
          history,
          step,
          replyLang,
          intent,
        );
      }
      return await this.repriceOnStep(
        input,
        conv,
        userMsg,
        history,
        step,
        replyLang,
      );
    }
    if (step?.id === "job_details") {
      return await this.rewriteJobOnStep(
        input,
        conv,
        userMsg,
        history,
        step,
        replyLang,
      );
    }

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

    // ---- REQ-462 (demo-loop cycle 3, M26): "Change of plan on CO-001: make
    // it $1,000 and the description should just say "…"" edits THAT change
    // order. The model had no tool for it and revise_quote'd the signed
    // quote ("…its lines can't change"); the number and the new amount /
    // wording / withdrawal are read in code here, as N5 does for "send it".
    const coEditAsk =
      !llmResponse && this.changeOrderEdit && typeof input.content === "string"
        ? parseChangeOrderEdit(input.content)
        : undefined;
    if (coEditAsk) {
      llmResponse = {
        text: "",
        action: { type: "update_change_order", payload: coEditAsk },
      };
    }

    // ---- REQ-377 (demo-loop cycle 2, B1): "Dana wants a tile backsplash
    // too — change Q-001 to $19,750" is a NEW TOTAL for an existing job. The
    // model did that subtraction into cents itself and wrote 12500 for
    // 125000; the coordinator subtracts in code instead. Only for a named
    // quote or the conversation's issued one — an open draft is still being
    // written through create_quote.
    const targetAsk = !llmResponse && typeof input.content === "string"
      ? parseTargetTotalChange(input.content)
      : undefined;
    if (targetAsk) {
      let onExistingJob = !!targetAsk.quoteNumber;
      if (!onExistingJob && conv.quoteId) {
        const bound = await this.quotes.getOwned(conv.quoteId, input.userId)
          .catch(() => undefined);
        onExistingJob = !!bound && !isOpenDraft(bound);
      }
      if (onExistingJob) {
        llmResponse = {
          text: "",
          action: {
            type: "change_order",
            payload: {
              ...(targetAsk.quoteNumber
                ? { quoteNumber: targetAsk.quoteNumber }
                : {}),
              description: targetAsk.description ?? "",
              deltaAmountCents: 0,
              targetTotalCents: targetAsk.targetTotalCents,
            },
          },
        };
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
    // ---- REQ-438 (demo-loop cycle 3, M7): "Borra la factura repetida
    // INV-001" — the chat has no invoice tool, so the model made it a change
    // order ("¿Cuánto debe sumar Eliminar factura INV-001 a Q-001…?"). It is
    // answered here, from the contractor's own invoices: how to delete it on
    // Invoices (a paid one stays on the record). Nothing is written.
    const removalAsk = !llmResponse && typeof input.content === "string"
      ? parseInvoiceRemoval(input.content)
      : undefined;
    if (removalAsk) {
      const text = await this.invoiceRemovalReply(
        input.userId,
        replyLang,
        removalAsk.invoiceNumber,
      );
      const reply = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: text,
      });
      const updated = await this.conversations.update(conv.id, {
        preview: derivePreview(reply.content),
      });
      return await finishEarly({
        conversation: updated,
        newMessages: [reply],
      });
    }
    // ---- REQ-388 (demo-loop cycle 2, M19): "¿Cuánto me debe Ana López?" —
    // what a customer owes and when, from their own quotes and invoices, with
    // or without a quote bound. Pair 2's model had neither (and a prompt that
    // said the invoice went out at signing): "El invoice ya se envió cuando
    // firmó." A follow-up that names nobody is about the thread's last name.
    const owedAsk = !llmResponse && !changeOrderAsk &&
        typeof input.content === "string"
      ? parseOwedQuestion(input.content)
      : undefined;
    if (owedAsk) {
      const earlier = history
        .filter((m) => m.role === "user" && m.id !== userMsg.id)
        .map((m) => m.content);
      const owed = await new AnswerOwed(
        this.conversations,
        this.messages,
        this.quotes,
        undefined,
        this.customers,
      ).run({
        userId: input.userId,
        conversation: conv,
        lang: replyLang,
        customerName: owedAsk.customerName ?? owedNameFromHistory(earlier),
      });
      return await finishEarly(owed);
    }
    // ---- REQ-583 (demo-loop cycle 4, M2): a payment the customer made, and
    // an invoice to send NOW, are done here in code. The chat model had no
    // tool for either: pair 1's "Linda paid the deposit $1,425 by Zelle
    // today" was never recorded, pair 3's "send it to her now please" got "I
    // can't send the invoice directly…". "it" is the invoice the last reply
    // offered with Send now (or the card's own "Send INV-001 now"); without
    // that offer the model decides, with its send_invoice tool.
    const billingText = !llmResponse && typeof input.content === "string"
      ? input.content
      : "";
    const paymentReport = this.billing && billingText
      ? parsePaymentReport(billingText)
      : undefined;
    const recorded = this.billing && paymentReport
      ? await this.billing.recordPayment({
        userId: input.userId,
        conversation: conv,
        lang: replyLang,
        report: paymentReport,
        text: billingText,
        fromWords: true,
      })
      : undefined;
    if (recorded) return await finishEarly(recorded);
    const sendAsk = this.billing && billingText
      ? parseSendInvoiceAsk(billingText)
      : undefined;
    const sendOffer = sendAsk && !sendAsk.invoiceNumber
      ? liveSendOffer(history.filter((m) => m.id !== userMsg.id))
      : undefined;
    if (this.billing && sendAsk && (sendAsk.invoiceNumber || sendOffer)) {
      return await finishEarly(
        await this.billing.send({
          userId: input.userId,
          conversation: conv,
          lang: replyLang,
          ...(sendAsk.invoiceNumber
            ? { invoiceNumber: sendAsk.invoiceNumber }
            : { invoiceId: sendOffer!.invoiceId }),
          ...(sendAsk.channel ? { channel: sendAsk.channel } : {}),
        }),
      );
    }
    // M32: "John signed! Please send him the deposit invoice" → where the
    // bill stands (signing already sent the deposit invoice).
    if (
      !llmResponse && boundQuote && typeof input.content === "string" &&
      isInvoiceRequest(input.content)
    ) {
      const billed = await answerBilling();
      if (billed) return await finishEarly(billed);
    }
    // REQ-583 (M2, pair 6): "Job done for Carmen Ruiz, faucet and the 2
    // doors. Make the invoice for $450 please." in a NEW chat — no job bound.
    // The customer it names has a job: bind it and answer where its bill
    // stands. The demo read "invoice for" as a line to reprice ('I couldn't
    // find a line called "invoice for" on Q-001…').
    if (
      !llmResponse && !conv.quoteId && typeof input.content === "string" &&
      isInvoiceRequest(input.content)
    ) {
      const jobId = await this.namedCustomersJob(input.userId, input.content);
      if (jobId) {
        const bound = await this.conversations.update(conv.id, jobId);
        const billed = await new AnswerBilling(
          this.conversations,
          this.messages,
        )
          .run({ userId: input.userId, conversation: bound, lang: replyLang });
        if (billed) return await finishEarly(billed);
      }
    }
    // ---- REQ-388 (M23): "Draft a quote at $1,500" — the pricing answer's
    // offer, taken (the chat's button sends those words). The draft is the
    // offered job at the price asked for, else the offered one. A pricing
    // question itself never drafts.
    const earlierMessages = history.filter((m) => m.id !== userMsg.id);
    const offered = liveDraftOffer(earlierMessages, conv.quoteId);
    const draftAsk = !llmResponse && offered && isInQuotePhase(conv) &&
        typeof input.content === "string"
      ? parseDraftRequest(input.content)
      : undefined;
    if (offered && draftAsk) {
      const title = offered.offer.title;
      llmResponse = {
        text: "",
        action: {
          type: "create_quote",
          payload: {
            summary: title,
            lineItems: [{
              description: title,
              amountCents: draftAsk.amountCents ?? offered.offer.amountCents,
            }],
          },
        },
      };
    }

    // ---- N3: action_card / continue_cta → synthetic text turns so the LLM
    // can answer status questions ("what's the total?") about a quote it
    // already drafted. Without this, the filter below dropped these kinds
    // and the model was blind to its own prior actions.
    // Image bytes are still re-fetched per turn so vision-capable models can
    // re-read attached photos on follow-up turns.
    // REQ-585 (demo-loop cycle 4, M4): an earlier step turn whose request was
    // applied (and its reply) is not replayed — on the start-date card pair
    // 7's model re-issued her Pick-a-price request from the history.
    const appliedTurns = appliedStepTurnIds(history, userMsg.id);
    const llmTurns: LLMTurn[] = await Promise.all(
      history
        .filter((m) => !appliedTurns.has(m.id))
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
    const langRule = replyLang === "es"
      ? `\n\n${t("en", "prompts.contractorLanguageEsOverride")}`
      : "";

    // ---- REQ-368 (M30) + REQ-388 (demo-loop cycle 2, M23 + m38): a pricing
    // question is answered with the "help me price it" engine's three tiers
    // (SuggestPrices) — every job the message asks about, each on its own
    // words; a follow-up right after a price ("y para un baño de 5x8?") with
    // the earlier prices as context. Nothing is drafted (pair 7's question
    // became a quote whose line was the question): a new job in the quote
    // phase gets a "Draft a quote at $X" offer. When the message asks how the
    // price was reached, the chat model writes the answer around those
    // prices, with no tools.
    let pricingPayload: Record<string, unknown> | undefined;
    const asked = typeof input.content === "string" ? input.content : "";
    const pricingAsk = !llmResponse && !changeOrderAsk && asked
      ? parsePricingQuestion(asked)
      : undefined;
    const lastBefore = earlierMessages[earlierMessages.length - 1];
    const followUp = !llmResponse && !changeOrderAsk && !pricingAsk &&
        pricingOf(lastBefore)
      ? parsePricingFollowUp(asked)
      : undefined;
    const subjects: PricingSubject[] = pricingAsk?.job
      ? pricingSubjects(asked)
      : followUp
      ? [{ job: followUp.job, action: false }]
      : [];
    const boundSubject = boundQuote?.jobName?.trim() ||
      boundQuote?.summary?.trim() || "";
    if (
      (pricingAsk || followUp) &&
      (subjects.length > 0 || (pricingAsk && boundSubject))
    ) {
      const addr = await this.addresses.get(input.userId).catch(() => null);
      const where = [addr?.city?.trim(), addr?.state?.trim()].filter(Boolean)
        .join(", ");
      const earlierPrices = [...earlierMessages].reverse().map(pricingOf)
        .find((p) => !!p);
      const price = (raw: string) =>
        new SuggestPrices(this.llm).run({
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
          ...(earlierPrices ? { context: pricingContext(earlierPrices) } : {}),
        });
      const priced: PricedSubject[] = [];
      if (subjects.length === 0 && boundQuote) {
        // Asking about the bound quote ("what should I charge for this?"):
        // price its words — never its amounts, which SuggestPrices would
        // read as a cost floor.
        const r = await price(
          [
            asked,
            `The job: ${boundSubject}`,
            boundQuote.description ?? "",
            ...(boundQuote.lineItems ?? []).map((l) => l.description),
          ].filter((x) => x.trim()).join("\n"),
        );
        priced.push({ job: boundSubject, ...r });
      }
      for (const s of subjects) {
        // One job: the whole message, with every quantity and cost it names
        // (REQ-260). Several: each job's own words — pair 7's drain move is
        // never priced together with its heated floor.
        const r = await price(subjects.length === 1 ? asked : s.job);
        priced.push({
          job: withoutPlace(s.job, { city: addr?.city, state: addr?.state }),
          action: s.action,
          ...r,
        });
      }
      const [first, ...more] = priced;
      const market = first.options.find((o) => o.tier === "market") ??
        first.options[1] ?? first.options[0];
      // One job, named in full: a follow-up's "un baño de 5x8" alone is no
      // quote line, and several jobs are a question, not one quote.
      const draftOffer = isInQuotePhase(conv) && !conv.quoteId && !followUp &&
          subjects.length === 1
        ? {
          title: jobTitle(first.job),
          amountCents: market.priceCents,
          tier: market.label,
        }
        : undefined;
      const answer = pricingReply(replyLang, {
        ...first,
        where,
        more,
        ...(draftOffer
          ? {
            offerDraft: {
              tier: draftOffer.tier,
              amountCents: draftOffer.amountCents,
            },
          }
          : {}),
        offerUpdate: isInQuotePhase(conv) && !!boundQuote &&
          isOpenDraft(boundQuote) && !boundQuote.lockedAt,
      });
      pricingPayload = {
        pricing: {
          subjects: priced.map((p) => ({
            job: p.job,
            options: p.options.map((o) => ({
              label: o.label,
              priceCents: o.priceCents,
            })),
          })),
        },
        ...(draftOffer ? { draftOffer } : {}),
      };
      let explained = "";
      if (asksHowPriced(asked)) {
        const covers = priced.some((p) => p.basis === "labor_and_materials")
          ? "\nThe prices include labor and materials."
          : "";
        const res = await this.llm.respond({
          systemPrompt: `${base}\n\n${
            t("en", "prompts.pricingExplain")
          }${langRule}`,
          messages: llmTurns,
          userId: input.userId,
          businessContext: `Prices from the pricing engine for this message${
            where ? ` (${where})` : ""
          }:\n${pricingContext(priced)}${covers}`,
          tools: [],
        }).catch((err) => {
          console.error("[handle-chat] price explanation failed:", err);
          return undefined;
        });
        explained = res?.text?.trim() ?? "";
      }
      llmResponse = { text: explained || answer };
    }

    if (!llmResponse) {
      const systemPrompt = `${base}${langRule}`;
      // REQ-262 (demo M25): ground the model in the saved quote.
      let businessContext: string | undefined;
      if (conv.quoteId) {
        businessContext = await this.quotes.getOwned(
          conv.quoteId,
          input.userId,
        ).then(quoteContext).catch(() => undefined);
      }
      // REQ-392 (M7): the wizard question / the Ready-to-send review the
      // message was typed on.
      const stepLine = stepContextLine(step, {
        question: await this.stepQuestion(conv.id, step),
      });
      if (stepLine) {
        businessContext = [businessContext, stepLine].filter(Boolean).join(
          "\n\n",
        );
      }
      // REQ-462 (M26): a message that names a change order carries its state
      // and says to change it with update_change_order, never revise_quote.
      const coLine = this.changeOrderEdit && typeof input.content === "string"
        ? await this.changeOrderEdit.context(
          input.userId,
          changeOrderNumbersIn(input.content),
        ).catch(() => undefined)
        : undefined;
      if (coLine) {
        businessContext = [businessContext, coLine].filter(Boolean).join(
          "\n\n",
        );
      }
      // REQ-583 (demo-loop cycle 4, M2): a signed job's invoices — what the
      // model reads (what is billed, scheduled, paid) and what its
      // send_invoice / record_payment tools may do.
      const jobInvoices = this.billing && boundQuote && isAccepted(boundQuote)
        ? await this.billing.invoicesOf(input.userId, boundQuote.id)
        : undefined;
      const invoiceLines = jobInvoices ? invoicesContext(jobInvoices) : "";
      if (invoiceLines) {
        businessContext = [businessContext, invoiceLines].filter(Boolean)
          .join("\n\n");
      }
      // REQ-368 (M32): only the tools this state allows — no lock / terms
      // once the quote is past drafting, no create / lock in the terms phase.
      // REQ-392: the review may also revise a line already on the quote.
      const tools = stepTools(
        chatToolsFor(conv.currentPhase, boundQuote, jobInvoices),
        step,
      );
      // REQ-445 (demo-loop cycle 3, B2 + M20): a price the contractor gives
      // for the WHOLE job ("make it around $18,000", "yo pienso como 18 mil")
      // is the draft's total. The model is told; its lines are checked below.
      const draftOnFile = boundQuote?.status === "draft"
        ? boundQuote
        : undefined;
      const statedCents = tools.includes("create_quote") && !changeOrderAsk
        ? statedTotalCents(asked, {
          currentTotalCents: draftOnFile
            ? draftTotalCents(draftOnFile)
            : undefined,
        })
        : undefined;
      if (statedCents) {
        businessContext = [businessContext, statedTotalNote(statedCents)]
          .filter(Boolean).join("\n\n");
      }
      const request = {
        systemPrompt,
        messages: llmTurns,
        userId: input.userId,
        ...(businessContext ? { businessContext } : {}),
        tools,
      };
      llmResponse = await this.llm.respond(request);

      // REQ-439 (demo-loop cycle 3, M9): a FIRST draft has a line for every
      // item the contractor typed. Pair 7's master bath named a shower bench
      // and possible mold; the draft had neither and nothing checked. A
      // draft that leaves typed items out is asked again once, naming them;
      // the answer is used when it is still a priced draft that leaves out
      // fewer of them.
      const draft = llmResponse.action;
      if (draft?.type === "create_quote" && !conv.quoteId && !changeOrderAsk) {
        const typedText = history
          .filter((m) => m.role === "user" && typeof m.content === "string")
          .map((m) => m.content as string)
          .join("\n");
        const work = typedWorkItems(
          typedText,
          replyLang,
          customerFactsFrom(typedText),
        );
        const linesOf = (p: typeof draft.payload) => [
          p.summary,
          ...p.lineItems.map((l) => l.description),
        ];
        const missed = work.length >= 3
          ? missedTypedItems(linesOf(draft.payload), work)
          : [];
        if (missed.length > 0) {
          console.warn(
            "[handle-chat] first draft leaves typed items out — asking again:",
            JSON.stringify(missed),
          );
          const again = await this.llm.respond({
            systemPrompt,
            messages: [
              ...llmTurns,
              {
                role: "assistant",
                content: draft.payload.lineItems.map((l) =>
                  `- ${l.description}: $${(l.amountCents / 100).toFixed(2)}`
                ).join("\n"),
              },
              {
                role: "user",
                content: t("en", "prompts.createQuote.missingLines", {
                  items: missed.map((i) => `- ${i}`).join("\n"),
                }),
              },
            ],
            userId: input.userId,
            ...(businessContext ? { businessContext } : {}),
            tools,
          }).catch((err) => {
            console.error("[handle-chat] first-draft re-ask failed:", err);
            return undefined;
          });
          const redo = again?.action;
          if (
            redo?.type === "create_quote" &&
            !quotePriceProblem(redo.payload.lineItems) &&
            redo.payload.lineItems.length >= draft.payload.lineItems.length &&
            missedTypedItems(linesOf(redo.payload), work).length < missed.length
          ) {
            llmResponse = { ...again!, text: again!.text || llmResponse.text };
          }
        }
      }

      // REQ-445: the model's create_quote is checked before it is saved — a
      // missed stated total (re-asked once, then scaled in code), a revision
      // that more than triples with prices nobody typed (asked, nothing
      // saved), a first draft under the job's floor (re-asked once, then
      // lifted). Replaced lines drop the model's prose, which described its
      // own numbers: the REQ-267 reply is written from the saved ones.
      if (llmResponse.action?.type === "create_quote" && !changeOrderAsk) {
        const settled = await settleCreateQuote({
          payload: llmResponse.action.payload,
          userText: asked,
          statedCents,
          draft: draftOnFile,
          lang: replyLang,
          reask: async (turns) => {
            const again = await this.llm.respond({
              ...request,
              messages: [...llmTurns, ...turns],
              tools: ["create_quote"],
            });
            return again.action?.type === "create_quote"
              ? again.action.payload.lineItems
              : undefined;
          },
        });
        if (settled.kind === "ask") llmResponse = { text: settled.text };
        if (settled.kind === "save") {
          llmResponse = {
            text: "",
            action: { type: "create_quote", payload: settled.payload },
          };
        }
      }
    }

    // ---- REQ-444 (demo-loop cycle 3, M21): every tool call the model made.
    // Several changes to the quote all run — the job details first — and
    // one reply says what changed ("fix the Spanish and add a plumbing permit
    // line $450" used to lose the permit and answer "Done"). A mix that can't
    // all run keeps the first call (below, as before); the reply names what
    // it didn't do, and any call whose arguments didn't parse.
    const plan = planToolCalls(toolCallsOf(llmResponse));
    // REQ-585 (demo-loop cycle 4, M4 + M30): a term change alone is a change
    // like the others — the reply says what the wizard did and keeps the
    // model's answer.
    const edits = plan.edits ??
      (plan.single?.type === "update_terms" ? [plan.single] : undefined);
    if (edits) {
      return await this.applyEditCalls(
        input,
        conv,
        userMsg,
        history,
        edits,
        replyLang,
        llmResponse.dropped ?? [],
        llmResponse.text ?? "",
      );
    }
    // REQ-585 (M4): the call that runs is the plan's — a create_quote carries
    // the job details the model wrote beside it (pair 6).
    if (plan.single) llmResponse = { ...llmResponse, action: plan.single };
    const notDone = [
      notDoneLine(replyLang, [
        ...plan.notDone,
        ...(llmResponse.dropped ?? []),
      ]),
      // REQ-585 (M4): a start date / time to complete the message asked for
      // that no call set ("the start should be next week … what should I
      // charge for the heated floor?" got the price only).
      termsNotAppliedLine(
        replyLang,
        await this.termsMissed(conv, input.content, []),
      ),
    ].filter(Boolean).join(" ");
    const withNotDone = (text: string) =>
      notDone ? [text.trim(), notDone].filter(Boolean).join(" ") : text;

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
    // REQ-438 (demo-loop cycle 3, M7): …unless the customer it names has no
    // quote at all — then there is no job to change, and the model's draft
    // stands (pair 6 looped on "Which job is this change order for?").
    const namedHasNoQuote = changeOrderAsk?.customerName &&
        !changeOrderAsk.quoteNumber &&
        llmResponse.action?.type === "create_quote"
      ? (await this.changeOrderTarget(input.userId, {
        customerName: changeOrderAsk.customerName,
        boundQuoteId: conv.quoteId,
      })).kind === "none"
      : false;
    if (
      changeOrderAsk && !namedHasNoQuote &&
      llmResponse.action?.type === "create_quote"
    ) {
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
    // REQ-462 (M26): the demo's model answered "Change of plan on CO-001: …"
    // with revise_quote on the signed quote. A message that names one change
    // order (and no quote) is never a line revision: it goes to that order,
    // which asks what to change when the model said nothing it can use.
    if (
      llmResponse.action?.type === "revise_quote" && this.changeOrderEdit &&
      typeof input.content === "string" && !/\bQ-\d+\b/i.test(input.content)
    ) {
      const named = changeOrderNumbersIn(input.content);
      if (named.length === 1) {
        llmResponse = {
          text: "",
          action: {
            type: "update_change_order",
            payload: { changeOrderNumber: named[0] },
          },
        };
      }
    }
    // REQ-438 (demo-loop cycle 3, M7): the other way round — "Cotización para
    // María José Peña: cambiar la llave … $180" asks for a NEW quote, and
    // pair 6's model called change_order; with no quote of hers to change,
    // the reply was "I couldn't find a quote… Which job is this change order
    // for?". In a conversation with no quote yet, that change_order is the
    // draft it was asked for.
    if (
      !changeOrderAsk && !conv.quoteId &&
      llmResponse.action?.type === "change_order" &&
      llmResponse.action.payload.targetTotalCents === undefined &&
      typeof input.content === "string" && isNewQuoteRequest(input.content)
    ) {
      const co = llmResponse.action.payload;
      const typed = typedAmountsCents(input.content);
      const amountCents = typed.length === 1 ? typed[0] : co.deltaAmountCents;
      const description = co.description?.trim() ?? "";
      const target = await this.changeOrderTarget(input.userId, {
        customerName: co.customerName,
        quoteNumber: co.quoteNumber,
      });
      if (
        description && amountCents > 0 &&
        (target.kind === "none" || target.kind === "ask_customer")
      ) {
        llmResponse = {
          text: "",
          action: {
            type: "create_quote",
            payload: {
              summary: co.customerName
                ? `${description} — ${co.customerName}`
                : description,
              lineItems: [{ description, amountCents }],
            },
          },
        };
      }
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
        content: withNotDone(result.text), // REQ-444
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

    // ---- REQ-583 (demo-loop cycle 4, M2): the model's send_invoice /
    // record_payment run through ChatBilling, and the reply is what was
    // actually done — never the model's own "Sending it now!".
    const billingAction = llmResponse.action;
    if (
      this.billing && (billingAction?.type === "send_invoice" ||
        billingAction?.type === "record_payment")
    ) {
      const done = billingAction.type === "send_invoice"
        ? await this.billing.send({
          userId: input.userId,
          conversation: conv,
          lang: replyLang,
          ...(billingAction.payload.invoiceNumber
            ? { invoiceNumber: billingAction.payload.invoiceNumber }
            : {}),
        })
        : (await this.billing.recordPayment({
          userId: input.userId,
          conversation: conv,
          lang: replyLang,
          report: billingAction.payload,
          text: userText,
        }))!;
      if (notDone) {
        done.newMessages.push(
          await this.messages.append({
            conversationId: conv.id,
            role: "assistant",
            kind: "text",
            content: notDone,
          }),
        );
      }
      return await finishEarly(done);
    }

    // ---- REQ-462 (demo-loop cycle 3, M26): edit / withdraw a change order
    // by its number. The reply is the coordinator's; its payload names the
    // order and its quote (the chat links the quote, whose panel lists it).
    if (
      llmResponse.action?.type === "update_change_order" && this.changeOrderEdit
    ) {
      const p = llmResponse.action.payload;
      const result = await this.changeOrderEdit.run({
        userId: input.userId,
        lang: replyLang,
        changeOrderNumber: p.changeOrderNumber,
        description: p.description,
        amountCents: p.amountCents,
        withdraw: p.withdraw,
        userText,
      });
      const reply = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: result.text,
        payload: { changeOrderEdit: result.outcome },
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

    // The change-order reply is the coordinator's, not the model's prose.
    if (llmResponse.action?.type === "change_order") {
      // REQ-315 (demo-loop cycle 1, M26): the demo's model answered "change
      // plumbing fixtures to $1,300" with change_order "Adjust plumbing
      // fixtures to $1,300" (+$150) — a FIFTH line. A change order that is a
      // reprice changes the line instead; on a signed quote (whose lines
      // never change, REQ-202) it stays the change order the model asked for.
      // REQ-377: a new total is never a line reprice.
      const reprice = llmResponse.action.payload.targetTotalCents === undefined
        ? changeOrderAsReprice(llmResponse.action.payload, userText)
        : undefined;
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
        // REQ-377 (B1): the money is settled against the quote in code.
        targetTotalCents: llmResponse.action.payload.targetTotalCents,
        userText,
      });
      // REQ-392 (M7): a line added to the bound draft (or its pending
      // revision) flags the reply, as a revise does, so an open Ready-to-send
      // review re-reads the quote instead of showing the old lines.
      const co = result.outcome;
      const coChangedBound =
        (co.kind === "draft_updated" || co.kind === "pending_revision") &&
        co.quoteId === conv.quoteId;
      const reply = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: withNotDone(result.text), // REQ-444
        payload: {
          changeOrder: result.outcome,
          ...(coChangedBound ? { quoteUpdated: co.quoteId } : {}),
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
          // REQ-585 (M4): a job-details bullet is said to be one.
          jobDetails: boundQuote
            ? [
              boundQuote.description,
              ...Object.values(boundQuote.descriptionByLang ?? {}),
            ].filter((d): d is string => typeof d === "string" && !!d.trim())
              .join("\n")
            : undefined,
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
      existingDraft && !priceProblem &&
      llmResponse.action?.type === "create_quote"
    ) {
      const was = existingDraft.lineItems.map((l) => ({
        description: l.description,
        priceCents: l.price * (l.quantity ?? 1),
      }));
      const now = llmResponse.action.payload.lineItems.map((l) => ({
        description: l.description,
        priceCents: l.amountCents,
      }));
      // REQ-585 (demo-loop cycle 4, M4): a re-draft that changed nothing —
      // no line, no price, not the summary nor the job details — is said to
      // have changed nothing even when the model wrote prose ("I've added a
      // second option…" over an identical card); its answer, minus the
      // claim, follows.
      const payload = llmResponse.action.payload;
      const otherChange =
        (existingDraft.summary ?? "").trim() !== payload.summary.trim() ||
        Object.keys(payload.descriptionByLang ?? {}).length > 0;
      const unchanged = !otherChange && was.length === now.length &&
        was.every((l, i) =>
          l.description.trim() === now[i].description.trim() &&
          l.priceCents === now[i].priceCents
        );
      if (suppressTextBubble || unchanged) {
        const said = describeQuoteRevision(
          replyLang,
          was,
          now,
          input.content,
          { otherChange },
        );
        const answer = suppressTextBubble ? "" : proseAnswer(replyText);
        replyText = [said, answer].filter(Boolean).join(" ");
        suppressTextBubble = false;
      }
    }

    // ---- update_job_details (REQ-262, demo M25): rewrite / translate the
    // bound quote's job details. Applied BEFORE the reply is stored, because
    // the reply carries the outcome: `payload.quoteUpdated` tells the chat
    // island to re-read the quote; a refusal replaces any claim of success.
    // The quote is conv.quoteId — the model never names it — and prices and
    // line items are untouched (writeJobDetails).
    let replyPayload: Record<string, unknown> | undefined;
    if (llmResponse.action?.type === "update_job_details") {
      const done = await this.writeJobDetails(
        conv,
        input.userId,
        llmResponse.action.payload.descriptionByLang,
        replyLang,
      );
      if (done.kind === "none") {
        replyText = t(replyLang, "chatCoordinator.noActionFallback");
      } else if (done.kind === "locked") {
        replyText = t(replyLang, "chatCoordinator.jobDetailsLocked");
      } else {
        // REQ-444 (demo-loop cycle 3, M21): said from what changed — never a
        // bare "Done — the job details on the quote are updated." — and a
        // message that named an amount hears that no price moved.
        if (!llmText) replyText = jobDetailsChangeLine(replyLang, done.change);
        if (typedAmountsCents(userText).length > 0) {
          replyText = `${replyText} ${
            pricesSameLine(replyLang, done.totalCents)
          }`;
        }
        replyPayload = { quoteUpdated: done.quoteId };
      }
      suppressTextBubble = false;
    }

    // REQ-444: what this turn didn't do (a mix that couldn't all run, a call
    // that didn't parse) is said, never passed for done.
    if (notDone) {
      replyText = withNotDone(replyText);
      suppressTextBubble = false;
    }

    // REQ-388 (M23 + m38): a pricing answer carries its prices and offer.
    if (pricingPayload) replyPayload = { ...pricingPayload, ...replyPayload };
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
            action.payload.summary, // REQ-576 (m26): "— Bob Smith"
          );
          if (known) {
            customerId = known.id;
            convPatch.customerId = known.id;
          }
        }

        // REQ-263 (demo ai-assistant-m2): the job address — "412 Oak St
        // Austin" must never be thrown away because the model left it off.
        // REQ-418 (demo-loop cycle 2, M27): the address the user typed in
        // this conversation (latest user turn first) wins; the model's
        // `serviceAddress` is only a fallback, and only when it is
        // address-shaped (never a phone or email) and grounded in a user
        // turn — the model once returned "512-555-0199" as the address.
        const userTexts = history
          .filter((m) => m.role === "user" && typeof m.content === "string")
          .map((m) => m.content as string);
        const serviceAddress = [...userTexts].reverse()
          .map((text) => extractServiceAddress(text))
          .find((a): a is string => !!a) ||
          acceptModelServiceAddress(action.payload.serviceAddress, userTexts) ||
          undefined;

        // N7 — update-in-place when the conversation already has a draft
        // quote bound. Previously each create_quote re-issue created a new
        // Quote row in the store, leaving orphans on every correction
        // ("bump labor to $2,100" → 2 rows in the DB). Update the existing
        // draft if one exists; otherwise create. Locked/sent quotes are
        // immutable, so fall through to creating a new one if the bound
        // quote is no longer in 'draft'.
        // REQ-585 (demo-loop cycle 4, M4): the job details the model wrote
        // beside the draft (folded in by planToolCalls) land on it — pair 6's
        // Spanish details were refused as a separate call under a correct
        // card ("Todavía no pude actualizar los detalles del trabajo…").
        const byLang = Object.fromEntries(
          Object.entries(action.payload.descriptionByLang ?? {})
            .map(([l, v]) => [l, v?.trim() ?? ""])
            .filter(([, v]) => v),
        ) as Record<string, string>;
        const typedLangs = Object.keys(byLang);
        const details = typedLangs.length
          ? {
            descriptionByLang: {
              ...(existingDraft?.descriptionByLang ?? {}),
              ...byLang,
            },
            // the reply language's copy is the base; else the first one —
            // unless a draft already has a base this turn didn't rewrite
            ...(byLang[replyLang] || !existingDraft?.description?.trim()
              ? { description: byLang[replyLang] || byLang[typedLangs[0]] }
              : {}),
          }
          : {};
        let quote;
        if (existingDraft) {
          try {
            quote = await this.quotes.update(existingDraft.id, input.userId, {
              summary: action.payload.summary,
              lineItems: dtoLineItems,
              estimatedTotal,
              ...details, // REQ-585
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
            ...details, // REQ-585
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
            // REQ-465 (demo cycle 3, m37): the draft card names its Q- number.
            ...(quote.number ? { number: quote.number } : {}),
            customerId: quote.customerId,
            // REQ-435 (demo-loop cycle 3, M4): the draft card shows the job
            // address the quote carries.
            ...(quote.serviceAddress
              ? { serviceAddress: quote.serviceAddress }
              : {}),
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
        // REQ-447 (demo-loop cycle 3, m14): the job has one name — the
        // quote's jobName titles the thread from now on, not the first
        // message's wording.
        const jobTitled = titleFromJobName(quote.jobName);
        if (jobTitled) convPatch.title = jobTitled;

        // REQ-258 (demo M22): a payment split the contractor stated ("half
        // deposit") pre-selects the terms wizard's payment step. A later
        // correction that doesn't restate it keeps the earlier one.
        if (action.payload.paymentTerms) {
          convPatch.termsPrefill = {
            ...(conv.termsPrefill ?? {}),
            payment_terms: action.payload.paymentTerms,
          };
        }

        // REQ-715 (demo-loop cycle 5, c4-M34): "Ella habla español." — the
        // customer's language is saved on the customer the quote is for, so
        // every send to them starts in it. With no customer known yet it
        // waits on the conversation; the "Who is this for?" step puts it on
        // the customer it binds.
        const spoken = action.payload.customerLanguage;
        if (spoken) {
          const forCustomer = quote.customerId ?? customerId;
          if (forCustomer && this.customers) {
            await this.customers.update(forCustomer, input.userId, {
              language: spoken,
            }).catch((err) =>
              console.warn("[handle-chat-message] customer language:", err)
            );
          } else {
            convPatch.customerLanguage = spoken;
          }
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
              // REQ-435 (M4): the locked card keeps the job address.
              ...(locked.serviceAddress
                ? { serviceAddress: locked.serviceAddress }
                : {}),
              // REQ-465 (demo cycle 3, m37): the locked card names its number.
              ...(locked.number ? { number: locked.number } : {}),
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

    // Title locks in on the very first user message in the conversation —
    // unless this turn's quote already named the job (REQ-447).
    if (
      !convPatch.title && (
        history.length === 0 ||
        (history.length === 1 && history[0].id === userMsg.id)
      )
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
