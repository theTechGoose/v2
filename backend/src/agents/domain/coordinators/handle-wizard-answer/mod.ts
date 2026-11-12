import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import {
  applyAnswer,
  computeProgress,
} from "@agents/domain/business/wizard-progress/mod.ts";
import {
  getWizardSpec,
  localizeOptions,
} from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { suggestedOptionId } from "@agents/domain/business/terms-prefill/mod.ts";
import { customerContactError } from "#quote-flow/customer-contact.ts"; // REQ-278
import { findExistingCustomer } from "#quote-flow/customer-dedupe.ts"; // REQ-331
import { termFromPick } from "#quote-flow/wizard-terms.ts"; // REQ-347
import { accountNetDays } from "#quote-flow/completion-schedule.ts"; // REQ-411
import { isQuoteLocked } from "#documents/versions.ts"; // REQ-460
import { docNumberOf } from "#documents/numbering.ts"; // REQ-460
import { formatTermDate } from "#quote-flow/format-helpers.ts"; // REQ-495
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type {
  WizardAnswer,
  WizardSpec,
  WizardState,
} from "@agents/dto/wizard.ts";

export interface WizardAnswerInput {
  userId: string;
  conversationId: string;
  stepId: string;
  optionId: string;
  customValue?: string;
  /** REQ-263 (demo ai-assistant-m2): the job address typed (or pre-filled)
   *  in the customer step — lands on the quote as `serviceAddress`. */
  serviceAddress?: string;
  /** Customer-step payload (only meaningful when stepId === "customer"). */
  customer?: {
    id?: string;
    create?: {
      name: string;
      email?: string;
      phoneNumber?: string;
      isBusiness?: boolean;
      businessName?: string;
      /** REQ-331 (demo m44): the contractor saw "<name> already exists" and
       *  chose "create anyway" — skip the same-owner dedupe. */
      allowDuplicate?: boolean;
    };
  };
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
    private customers: CustomerStore,
    private users: UserStore,
    private bus: EventBus,
    /** REQ-411 (m35): the account's days to pay fill the payment step's
     *  "within {n} days" sub-line. Optional — without it, the default. */
    private identity?: BusinessIdentityStore,
  ) {}

  async run(input: WizardAnswerInput): Promise<WizardAnswerResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.currentPhase !== "terms") {
      throw new Error("conversation is not in 'terms' phase");
    }

    // Chat copy is rendered to the contractor in their own UI language.
    const me = await this.users.get(input.userId).catch(() => null);
    const lang = me?.language === "es" ? "es" : "en";

    const current = await this.conversations.getWizardState(
      input.conversationId,
    );
    if (!current) {
      throw new Error("wizard state missing — call transition-to-terms first");
    }

    // REQ-460 (demo-loop cycle 3, B1): the bound quote first, before any
    // write. Once the customer signed it the agreement is final (REQ-202) —
    // in the demo "Deposit + balance" landed on a signed agreement and the
    // wizard went on to the warranty.
    const signed = await this.signedQuote(conv);
    if (signed) return await this.closeForSigned(conv, current, signed, lang);

    // Pre-validate the step ordering BEFORE any side effect. applyAnswer
    // performs the same check, but it runs after handleCustomerStep — and
    // an out-of-order `create_new` (stale card in a second tab, a double
    // tap, a lost response followed by a retry) used to materialize an
    // orphan Customer row on every failed attempt.
    // REQ-024: the spec comes from the persisted state — the quote wizard
    // or the invoice wizard.
    const spec = getWizardSpec(current.specId);
    const activeStep = spec.steps[current.activeStepIdx];
    if (!activeStep) {
      throw new Error(
        `wizard already complete (step ${current.activeStepIdx} of ${spec.steps.length})`,
      );
    }
    if (activeStep.id !== input.stepId) {
      throw new Error(
        `expected answer for "${activeStep.id}", got "${input.stepId}"`,
      );
    }

    // Customer step needs special handling: the wizard option `create_new`
    // is `isCustom: true` but the frontend sends a structured `customer.create`
    // payload (name/email/phone) instead of a free-text customValue. We
    // materialize the customer / pick the existing one HERE, bind it onto
    // the conversation, and synthesize a customValue (the customer's name)
    // so the generic applyAnswer step doesn't reject it.
    let customerCustomValue = input.customValue;
    let boundCustomerId = conv.customerId;
    let boundCustomerName: string | undefined;
    /** REQ-386 (demo m17): the job address the customer step settled on. */
    let stepAddress: string | undefined;
    if (input.stepId === "customer") {
      const handled = await this.handleCustomerStep(conv.id, input, lang);
      boundCustomerId = handled.customerId ?? boundCustomerId;
      boundCustomerName = handled.customerName;
      customerCustomValue = handled.customValue ?? customerCustomValue;
      stepAddress = await this.applyServiceAddress(
        conv,
        input.userId,
        input.serviceAddress,
        handled.customerAddress,
      );
    }

    const next = applyAnswer(spec, current, {
      stepId: input.stepId,
      optionId: input.optionId,
      customValue: customerCustomValue,
    });
    await this.conversations.putWizardState(input.conversationId, next);

    const stepDef = spec.steps.find((s) => s.id === input.stepId)!;
    const optionDef = stepDef.options.find((o) => o.id === input.optionId)!;
    // For the customer step, prefer the resolved customer's name so the
    // chat transcript reads "Customer: Jane Doe" rather than "Customer:
    // Create a new customer".
    const pickValue = input.stepId === "customer" && boundCustomerName
      ? boundCustomerName
      : optionDef.isCustom
      // REQ-495 (m17): a picked date (stored ISO) reads in the contractor's
      // language — "1 dic 2026" / "Dec 1, 2026"; other values pass through.
      ? (customerCustomValue !== undefined
        ? formatTermDate(customerCustomValue, lang)
        : t(lang, "wizardAnswer.pick.customFallback"))
      : t(lang, optionDef.label);

    // REQ-386 (demo m17): the customer line also carries the job address, so
    // the thread still shows it after a reload ("Customer: Dave Roof — 88 Oak
    // Hollow Dr, Austin TX 78745").
    const pickLine = stepAddress
      ? t(lang, "wizardAnswer.pick.transcriptAddress", {
        label: t(lang, stepDef.label),
        value: pickValue,
        address: stepAddress,
      })
      : t(lang, "wizardAnswer.pick.transcript", {
        label: t(lang, stepDef.label),
        value: pickValue,
      });
    const userPick = await this.messages.append({
      conversationId: input.conversationId,
      role: "user",
      kind: "text",
      content: pickLine,
      payload: {
        wizardStepId: input.stepId,
        optionId: input.optionId,
        customValue: input.customValue,
      },
    });

    const newMessages: AgentMessage[] = [userPick];
    const progress = computeProgress(spec, next);

    const convPatch: Partial<AgentConversation> = { preview: pickLine };
    if (
      input.stepId === "customer" && boundCustomerId &&
      boundCustomerId !== conv.customerId
    ) {
      convPatch.customerId = boundCustomerId;
    }

    // REQ-240 (demo M29): every answer lands on the quote as it is given —
    // the customer at the customer step, each term at its step. Waiting for
    // completion left a quote the contractor walked away from mid-wizard
    // with no customer and no terms ("PARA —", "INICIO Por agendar"), and
    // the invoice its signature created billed nobody ("FACTURAR A —").
    // Best-effort: if conv.quoteId is missing or the quote can't be loaded,
    // the turn still answers (and the CTA still shows on completion — the
    // user can pick a quote manually before sending).
    const persisted = await this.persistAnswers(
      conv,
      boundCustomerId,
      spec,
      next,
    );

    if (progress.isComplete) {
      // The quote IS the agreement: the full terms set is on it now.
      const quoteId = persisted
        ? await this.announceTermsDrafted(conv)
        : undefined;

      const cta = await this.messages.append({
        conversationId: input.conversationId,
        role: "assistant",
        kind: "continue_cta",
        content: t(lang, "wizardAnswer.cta.readyToSend"),
        payload: {
          toPhase: "send",
          summary: t(lang, "wizardAnswer.cta.readyToSendSummary"),
          ...(quoteId ? { quoteId } : {}),
          // REQ-024: the review opens in invoice mode for the invoice wizard.
          ...(conv.docKind ? { docKind: conv.docKind } : {}),
        },
      });
      newMessages.push(cta);
    } else {
      const step = progress.activeStep!;
      const n = accountNetDays(
        (await this.identity?.get(input.userId).catch(() => null))
          ?.invoiceNetDays,
      );
      const wizardMsg = await this.messages.append({
        conversationId: input.conversationId,
        role: "assistant",
        kind: "wizard",
        content: t(lang, step.question),
        payload: {
          specId: spec.id,
          stepIdx: next.activeStepIdx,
          stepId: step.id,
          // REQ-491 (m60): "Deposit + balance" names its $ split.
          options: localizeOptions(step.options, lang, {
            n,
            totalCents: await this.quoteTotalCents(conv),
          }),
          hint: step.hint,
          suggestedOptionId: suggestedOptionId(conv.termsPrefill, step),
        },
      });
      newMessages.push(wizardMsg);
    }

    const updatedConv = await this.conversations.update(
      input.conversationId,
      convPatch,
    );
    return { conversation: updatedConv, wizardState: next, newMessages };
  }

  /** REQ-460: the conversation's quote, when its customer already signed it. */
  private async signedQuote(
    conv: AgentConversation,
  ): Promise<Quote | undefined> {
    if (!conv.quoteId) return undefined;
    const quote = await this.quotes.getOwned(conv.quoteId, conv.userId)
      .catch(() => null);
    return quote && isQuoteLocked(quote) ? quote : undefined;
  }

  /**
   * REQ-460 (demo-loop cycle 3, B1): an answer for a quote the customer has
   * signed. Nothing is recorded — no pick, no answer, nothing on the quote.
   * The wizard closes: no step stays active and its open question leaves the
   * thread, so a reload does not ask it again. The assistant says the
   * agreement is final and that a change goes through a change order or a
   * new version.
   */
  private async closeForSigned(
    conv: AgentConversation,
    state: WizardState,
    quote: Quote,
    lang: "en" | "es",
  ): Promise<WizardAnswerResult> {
    const spec = getWizardSpec(state.specId);
    const closed: WizardState = { ...state, activeStepIdx: spec.steps.length };
    await this.conversations.putWizardState(conv.id, closed);
    const msgs = await this.messages.listByConversation(conv.id);
    const answered = new Set(
      msgs.map((m) =>
        (m.payload as { wizardStepId?: string } | undefined)?.wizardStepId
      ),
    );
    const open = msgs.filter((m) => {
      if (m.kind !== "wizard") return false;
      const stepId = (m.payload as { stepId?: string } | undefined)?.stepId;
      return !!stepId && spec.steps.some((s) => s.id === stepId) &&
        !answered.has(stepId);
    }).map((m) => m.id);
    await this.messages.deleteByIds(conv.id, open);
    const content = t(lang, "wizardAnswer.signedLocked", {
      number: docNumberOf(quote),
    });
    const reply = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "text",
      content,
    });
    const conversation = await this.conversations.update(conv.id, {
      preview: content,
    });
    return { conversation, wizardState: closed, newMessages: [reply] };
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
    conversationId: string,
    input: WizardAnswerInput,
    lang: "en" | "es",
  ): Promise<
    {
      customerId?: string;
      customerName?: string;
      customValue?: string;
      /** REQ-263: the resolved customer's own address, if any. */
      customerAddress?: string;
    }
  > {
    if (input.optionId === "create_new") {
      // Prefer the structured customer.create payload; fall back to a
      // legacy name-only customValue path so older callers that only
      // pass `customValue: "<name>"` still work.
      const create = input.customer?.create;
      const name = (create?.name ?? input.customValue ?? "").trim();
      if (!name) {
        throw new Error(
          "create_new requires customer.create.name (or customValue)",
        );
      }
      // Guard against seeding a customer with the contractor's OWN contact —
      // the root of the bug where every customer carried the contractor's
      // email/phone and the agreement was delivered back to the contractor.
      const email = create?.email?.trim();
      const phone = create?.phoneNumber?.trim();
      // REQ-278 (demo M16): this path never went through the customer DTO,
      // so "123" / "555-12" / "davis@@gmail" were saved as the contact.
      // Same rule as parseCreateCustomer, in the contractor's language.
      const contactErr = customerContactError({ email, phoneNumber: phone });
      if (contactErr) throw new Error(t(lang, contactErr));
      if (email || phone) {
        const creator = await this.users.get(input.userId).catch(() => null);
        const normEmail = (e?: string) => (e ?? "").trim().toLowerCase();
        // Compare the trailing 10 digits so a US country-code prefix doesn't
        // defeat the match (E.164 "+15403331334" vs "(540) 333-1334").
        const normPhone = (p?: string) => {
          const d = (p ?? "").replace(/\D/g, "");
          return d.length > 10 ? d.slice(-10) : d;
        };
        if (
          (email && creator?.email &&
            normEmail(email) === normEmail(creator.email)) ||
          (phone && creator?.phoneNumber &&
            normPhone(phone) === normPhone(creator.phoneNumber))
        ) {
          // REQ-029 (NW-22): the contractor reads this — dictionary copy in
          // their language, never a raw developer string.
          throw new Error(t(lang, "termsWizard.customer.ownContact"));
        }
      }
      // REQ-331 (demo m44): "+ New customer" let the demo create a second
      // "x" while C-001 "x" already existed. The same owner's customers are
      // looked up by phone, email and accent-folded name first; a match is
      // bound instead of duplicated — unless the contractor saw the
      // "already exists" hint and chose "create anyway".
      if (!create?.allowDuplicate) {
        const mine: Customer[] = await this.customers.listByUser(input.userId)
          .catch(() => []);
        const existing = findExistingCustomer(mine, {
          name,
          email,
          phoneNumber: phone,
        });
        if (existing) {
          return {
            customerId: existing.id,
            customerName: existing.name,
            customValue: existing.name,
            customerAddress: existing.address,
          };
        }
      }
      const created = await this.customers.create(input.userId, {
        name,
        ...(create?.email ? { email: create.email.trim() } : {}),
        ...(create?.phoneNumber
          ? { phoneNumber: create.phoneNumber.trim() }
          : {}),
        ...(typeof create?.isBusiness === "boolean"
          ? { isBusiness: create.isBusiness }
          : {}),
        ...(create?.businessName?.trim()
          ? { businessName: create.businessName.trim() }
          : {}),
        // REQ-263: a new customer's address is the job address typed with it
        ...(input.serviceAddress?.trim()
          ? { address: input.serviceAddress.trim() }
          : {}),
      });
      return {
        customerId: created.id,
        customerName: created.name,
        customValue: created.name,
      };
    }
    if (input.optionId === "pick_existing") {
      const id = input.customer?.id;
      if (typeof id !== "string" || !id) {
        throw new Error("pick_existing requires customer.id");
      }
      const existing = await this.customers.getOwned(id, input.userId);
      return {
        customerId: existing.id,
        customerName: existing.name,
        customerAddress: existing.address,
      };
    }
    // use_active — the customer already bound to the conversation. REQ-531
    // (demo-loop cycle 3, p8-pair6-a): return its name too, so the transcript
    // reads "Cliente: Maria Lopez", not the option label "Cliente: Usar el
    // cliente del chat". A bound customer that doesn't load keeps the label.
    if (input.optionId === "use_active" && conversationId) {
      const conv = await this.conversations.get(conversationId);
      if (conv.customerId) {
        const bound = await this.customers.getOwned(
          conv.customerId,
          input.userId,
        )
          .catch(() => null);
        if (bound) {
          return {
            customerId: bound.id,
            customerName: bound.name?.trim() || undefined,
            customerAddress: bound.address,
          };
        }
      }
    }
    return {};
  }

  /**
   * REQ-263 (demo ai-assistant-m2): the quote's job address after the
   * customer step. An address typed in the step wins (the contractor saw it,
   * pre-filled or not, and confirmed it); otherwise an empty job address is
   * filled from the customer's own address. An address already on the quote
   * is never replaced by the customer's. REQ-386: returns the job address
   * the step settled on (the quote's, or — with no quote yet — the typed /
   * customer's one), for the transcript line.
   */
  private async applyServiceAddress(
    conv: AgentConversation,
    userId: string,
    typed: string | undefined,
    customerAddress: string | undefined,
  ): Promise<string | undefined> {
    const fallback = typed?.trim() || customerAddress?.trim() || undefined;
    if (!conv.quoteId) return fallback;
    const quote = await this.quotes.getOwned(conv.quoteId, userId)
      .catch(() => null);
    if (!quote) return fallback;
    const current = quote.serviceAddress?.trim() || undefined;
    const next = typed?.trim() ||
      (current ? undefined : customerAddress?.trim());
    if (!next || next === quote.serviceAddress) return current;
    await this.quotes.update(quote.id, userId, { serviceAddress: next });
    return next;
  }

  /**
   * Persist the wizard's answers so far onto the conversation's quote — run
   * on EVERY answer (REQ-240), not only on completion. Returns whether the
   * quote was written. Idempotent: re-running with the same picks writes the
   * same terms.
   */
  private async persistAnswers(
    conv: AgentConversation,
    boundCustomerId: string | undefined,
    spec: WizardSpec,
    state: WizardState,
  ): Promise<boolean> {
    // Walk the conversation messages and project the user's wizard picks
    // into a labeled terms array. Each pick lives on a `text` user message
    // with payload.wizardStepId — the chat transcript is the canonical
    // record. We snapshot it onto the quote so the public /q page can
    // render the agreed terms without re-loading the conversation.
    const terms = await this.captureTerms(conv.id, spec);
    // REQ-024 (NW-18): the invoice wizard's completion date lands on the
    // agreement as estimatedCompletionDate — the invoice's due date derives
    // from it (Due Now → the same day; net terms → +N days).
    const completed = completionDateFromAnswers(state.answers);

    if (!conv.quoteId) {
      console.error(
        `[wizard:persist] conversation ${conv.id} has no quoteId — skipping terms persist`,
      );
      return false;
    }
    try {
      const customerId = boundCustomerId ?? conv.customerId;
      const quote = await this.quotes.getOwned(conv.quoteId, conv.userId);
      const patch = {
        ...(terms.length ? { terms } : {}),
        ...(customerId && !quote.customerId ? { customerId } : {}),
        ...(completed ? { estimatedCompletionDate: completed } : {}),
      };
      if (Object.keys(patch).length) {
        await this.quotes.update(conv.quoteId, conv.userId, patch);
      }
    } catch (err) {
      console.error(
        `[wizard:persist] failed to persist terms onto quote ${conv.quoteId}:`,
        err,
      );
      return false;
    }
    return true;
  }

  /** REQ-491 (demo m60): the total the payment split bills (the quote's
   *  estimatedTotal, as send-signed-confirmation invoices it), or undefined
   *  when there is no readable quote yet. */
  private async quoteTotalCents(
    conv: AgentConversation,
  ): Promise<number | undefined> {
    if (!conv.quoteId) return undefined;
    const quote = await this.quotes.getOwned(conv.quoteId, conv.userId)
      .catch(() => undefined);
    return quote?.estimatedTotal;
  }

  /** The wizard completed: tell the bus the quote's terms are drafted. */
  private async announceTermsDrafted(
    conv: AgentConversation,
  ): Promise<string | undefined> {
    if (!conv.quoteId) return undefined;
    await this.bus.emit({
      userId: conv.userId,
      entityType: "quote",
      entityId: conv.quoteId,
      action: "terms_drafted",
      data: { quoteId: conv.quoteId, customerId: conv.customerId },
    });
    return conv.quoteId;
  }

  /** Project wizard-answer chat messages into a labeled terms array. */
  private async captureTerms(
    conversationId: string,
    spec: WizardSpec,
  ): Promise<{ stepId: string; label: string; value: string }[]> {
    const msgs = await this.messages.listByConversation(conversationId);
    const picks: { stepId: string; label: string; value: string }[] = [];
    const seen = new Set<string>();
    for (const m of msgs) {
      if (m.role !== "user" || m.kind !== "text") continue;
      const p = m.payload as
        | { wizardStepId?: string; optionId?: string; customValue?: string }
        | undefined;
      const stepId = p?.wizardStepId;
      if (!stepId || stepId === "customer" || seen.has(stepId)) continue;
      seen.add(stepId);
      // Store terms in ENGLISH — the neutral base. Every reader (the in-app
      // preview, the public agreement, and the PDF) localizes them to its own
      // target language via termLabels[stepId] + localizeTermValue(). Resolve
      // from the step/option ids on the payload, NOT the transcript text (which
      // is now rendered in the contractor's UI language and would poison the
      // base — localizeTermValue assumes EN input).
      // REQ-347: the same rule the in-app preview uses (shared termFromPick).
      const term = termFromPick(
        { stepId, optionId: p?.optionId, customValue: p?.customValue },
        t,
        spec.steps,
      );
      if (term) picks.push(term);
    }
    return picks;
  }
}

/** REQ-024: the invoice wizard's completion_date answer as YYYY-MM-DD —
 *  today / yesterday / last_week relative to now; a custom pick must be an
 *  ISO date, anything else falls back to today. Undefined when the wizard
 *  had no completion step (the quote wizard). */
function completionDateFromAnswers(
  answers: WizardAnswer[],
): string | undefined {
  const a = answers.find((x) => x.stepId === "completion_date");
  if (!a) return undefined;
  const iso = (offsetDays: number) =>
    new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
  if (a.optionId === "today") return iso(0);
  if (a.optionId === "yesterday") return iso(1);
  if (a.optionId === "last_week") return iso(7);
  const custom = (a.customValue ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(custom) ? custom : iso(0);
}
