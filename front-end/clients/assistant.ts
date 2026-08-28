/**
 * HTTP client for the /assistant page.
 *
 * Wraps the backend's `agents/*` routes. The chat module is still being built
 * server-side — for v1 the page falls back to a static seed when the backend
 * returns an empty list (or 404).
 */
import { api, ApiError, type ApiOptions } from "../lib/api.ts";

/** Minimal mirror of the backend Quote DTO — the frontend only needs the
 *  fields read from `getQuote`. Defined here (not in dashboard.ts) because
 *  dashboard.ts already grew large; centralize when a third caller appears. */
export interface QuoteLineItem {
  description: string;
  quantity?: number;
  unit?: string;
  price?: number;
}
export interface QuoteTerm {
  stepId: string;
  label: string;
  value: string;
}
export interface Quote {
  id: string;
  userId: string;
  customerId?: string;
  summary: string;
  /** Polished narrative produced from the user's raw job-details input. */
  description?: string;
  lineItems: QuoteLineItem[];
  estimatedTotal: number;
  status:
    | "draft"
    | "sent"
    | "viewed"
    | "accepted"
    | "lost"
    | "declined"
    | "expired";
  /** Wizard-captured agreement terms — the quote IS the agreement. */
  terms?: QuoteTerm[];
  sentAt?: string;
  acceptedAt?: string;
  acceptedName?: string;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
}

/** One of three scope-of-work options returned by generateJobOptions.
 *  The "Job Details" picker screen renders these as editable bullet
 *  lists; the picked option's surviving bullets become the quote's
 *  description, and its jobName/summary seed the quote. */
export interface JobOptionLang {
  jobName: string;
  summary: string;
  bullets: string[];
}

export interface JobOption {
  id: string;
  jobName: string;
  summary: string;
  bullets: string[];
  /** Per-language content of this option (the contractor's app language +
   *  every selected send language), generated up front so the picked option's
   *  description can be stored — and shown to the customer — in each language. */
  byLang?: Record<string, JobOptionLang>;
}

/** Mirrors backend AgentPhase. */
export type ConversationPhase = "quote" | "terms";

export interface Conversation {
  id: string;
  userId: string;
  customerId?: string;
  quoteId?: string;
  invoiceId?: string;
  currentPhase: ConversationPhase;
  title?: string;
  customerName?: string;
  /** Denormalized quote.jobName (UX-14) — titles the thread row. */
  jobName?: string;
  preview?: string;
  /** Set by accept-quote; cleared by load-conversation on next read. */
  hasUnreadEvent?: boolean;
  /** Denormalized quote.status — sent / accepted. */
  quoteStatus?: string;
  /** Denormalized invoice.status — sent / paid. */
  invoiceStatus?: string;
  /** ISO-8601 strings (backend returns `new Date().toISOString()`). */
  updatedAt: string;
  createdAt: string;
  [k: string]: unknown;
}

export type MessageKind =
  | "text"
  | "voice"
  | "image"
  | "action"
  | "action_card"
  | "wizard"
  | "phase_divider"
  | "continue_cta";

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  kind?: MessageKind;
  content: string;
  createdAt: number;
  [k: string]: unknown;
}

export interface CustomerLite {
  id: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  [k: string]: unknown;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  customer?: CustomerLite;
  /** Bound quote (the agreement) — populated once a quote is locked. */
  quote?: Quote;
  [k: string]: unknown;
}

export interface ChatInput {
  conversationId?: string;
  /** Optional for media uploads (voice/image) — the backend reads the
   *  bytes via payload.fileId and supplies content itself. */
  content?: string;
  kind?: "text" | "voice" | "image";
  payload?: Record<string, unknown>;
}

export interface ChatResult {
  conversationId: string;
  message?: Message;
  [k: string]: unknown;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return fallback;
    throw err;
  }
}

export const assistantClient = {
  conversations: (limit = 50, opts: ApiOptions = {}) =>
    safe(
      () =>
        api.get<Conversation[]>("/agents/conversations", {
          ...opts,
          query: { limit },
        }),
      [],
    ),

  conversation: (id: string, opts: ApiOptions = {}) =>
    api.get<ConversationDetail>(`/agents/conversations/${id}`, opts),

  startConversation: (body: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.post<Conversation>("/agents/conversations", body, opts),

  transitionToTerms: (id: string, opts: ApiOptions = {}) =>
    api.post<ConversationDetail>(
      `/agents/conversations/${id}/transition-to-terms`,
      undefined,
      opts,
    ),

  /** Flip the active quote to "sent" via the deterministic /lock-quote
   *  endpoint, bypassing the LLM. Returns the action_card + continue_cta
   *  to append to the chat. */
  lockQuote: (conversationId: string, quoteId: string, opts: ApiOptions = {}) =>
    api.post<{ conversation: Conversation; newMessages: Message[] }>(
      `/agents/conversations/${conversationId}/lock-quote`,
      { quoteId },
      opts,
    ),

  /** Dev-only: simulate the customer signing the quote — the single
   *  customer-facing acceptance event in the chain. Flips quote→
   *  accepted, emits the chat phase_divider + "Continue to invoice"
   *  CTA, and sets hasUnreadEvent so the threads sidebar bubbles +
   *  badges. */
  acceptQuote: (
    conversationId: string,
    quoteId: string,
    opts: ApiOptions = {},
  ) =>
    api.post<{ conversation: Conversation; newMessages: Message[] }>(
      `/agents/conversations/${conversationId}/accept-quote`,
      { quoteId },
      opts,
    ),

  /** Fire the wizard's "Ready to send" CTA: flips quote→sent and
   *  dispatches via the requested channel (email, sms, or both).
   *  Idempotent on state, but dispatch fires every time the user clicks. */
  sendQuoteFlow: (
    conversationId: string,
    quoteId: string,
    channel: "email" | "sms" | "both" = "email",
    language?: "en" | "es",
    opts: ApiOptions = {},
  ) =>
    api.post<{ conversation: Conversation; newMessages: Message[] }>(
      `/agents/conversations/${conversationId}/send-quote`,
      { quoteId, channel, ...(language ? { language } : {}) },
      opts,
    ),

  /** Fire the post-acceptance "Continue to invoice" CTA:
   *  materializes an Invoice from the bound quote (or reuses an
   *  already-bound one), flips status→sent, and dispatches the
   *  customer email. Returns the action_card to append to the chat. */
  sendInvoice: (conversationId: string, opts: ApiOptions = {}) =>
    api.post<{ conversation: Conversation; newMessages: Message[] }>(
      `/agents/conversations/${conversationId}/send-invoice`,
      undefined,
      opts,
    ),

  chat: (input: ChatInput, opts: ApiOptions = {}) =>
    api.post<ChatResult>("/agents/chat", input, opts),

  /** Read-only quote preview. Reuses /quotes/:id. */
  quote: (id: string, opts: ApiOptions = {}) =>
    api.get<Quote>(`/quotes/${id}`, opts),

  /** Email the quote to the bound customer. POST /quotes/:id/email. */
  sendQuote: (
    id: string,
    body: { to?: string; from?: string } = {},
    opts: ApiOptions = {},
  ) => api.post<{ ok: boolean }>(`/quotes/${id}/email`, body, opts),

  listCustomers: (opts: ApiOptions = {}) =>
    safe(
      () => api.get<CustomerLite[]>("/customers", opts),
      [] as CustomerLite[],
    ),

  /** Idempotent "see what your customer sees" sample quote. Returns the
   *  per-user quoteId so the onboarding-handoff CTA can link to a
   *  branded preview owned by the current user, not a hardcoded
   *  Dev Business quote. */
  ensureSampleQuote: (opts: ApiOptions = {}) =>
    api.post<{ quoteId: string; created: boolean }>(
      "/agents/conversations/sample-quote",
      {},
      opts,
    ),

  /** Re-point a conversation (and its bound quote, if any) at a
   *  different customer the contractor owns. Used by the quote-review
   *  surface's "swap customer" pencil. */
  bindCustomer: (
    conversationId: string,
    customerId: string,
    opts: ApiOptions = {},
  ) =>
    api.post<{ conversation: Conversation; customer: CustomerLite }>(
      `/agents/conversations/${conversationId}/bind-customer`,
      { customerId },
      opts,
    ),

  answerWizard: (
    body: {
      conversationId: string;
      stepId: string;
      optionId: string;
      customValue?: string;
      customer?: {
        id?: string;
        create?: {
          name: string;
          email?: string;
          phoneNumber?: string;
          isBusiness?: boolean;
        };
      };
      followUpValues?: Record<string, string | number>;
    },
    opts: ApiOptions = {},
  ) =>
    api.post<{
      conversation: Conversation;
      wizardState?: unknown;
      newMessages: Message[];
    }>("/agents/wizard/answer", body, opts),

  /** Step one wizard question backwards so it can be re-edited
   *  (roadmap p.2). Drops the trailing step + pick server-side and
   *  returns the now-active step id. */
  rewindWizard: (
    conversationId: string,
    opts: ApiOptions = {},
    /** Rewind TO this step (0-based) in one call; omitted = one step back. */
    toStepIdx?: number,
  ) =>
    api.post<{
      conversation: Conversation;
      wizardState?: unknown;
      activeStepId: string | null;
      removedMessageIds: string[];
      /** The popped pick for the re-asked step, so the UI can highlight
       *  the prior selection (roadmap p.8). */
      previousAnswer?: {
        stepId: string;
        optionId: string;
        customValue?: string;
      };
    }>(
      "/agents/wizard/back",
      {
        conversationId,
        ...(typeof toStepIdx === "number" ? { toStepIdx } : {}),
      },
      opts,
    ),

  /** One-shot LLM pass: turns the user's raw job description into a
   *  polished {summary, jobName, description} triple. Used by the
   *  empty-state "tell me the job details" step before the quote is
   *  created. `jobName` is the 3-words-or-less label used as the
   *  human-facing identifier across the platform. */
  polishJobDetails: (raw: string, priceCents?: number, opts: ApiOptions = {}) =>
    api.post<{ summary: string; jobName: string; description: string }>(
      "/agents/job-details/polish",
      { raw, ...(typeof priceCents === "number" ? { priceCents } : {}) },
      opts,
    ),

  /** LLM pass that turns the raw job description into three editable
   *  scope-of-work options for the "Job Details" picker screen. The user
   *  edits bullets and picks one option before the quote is built. */
  generateJobOptions: (
    raw: string,
    priceCents?: number,
    opts: ApiOptions = {},
  ) =>
    api.post<{ options: JobOption[] }>(
      "/agents/job-details/options",
      { raw, ...(typeof priceCents === "number" ? { priceCents } : {}) },
      opts,
    ),

  /** Three suggested price tiers for the "I know the job, help me price it"
   *  flow (roadmap p.10). The 4th "custom" option is the manual entry. */
  suggestPrices: (raw: string, opts: ApiOptions = {}) =>
    api.post<
      {
        options: Array<
          { tier: string; label: string; priceCents: number; rationale: string }
        >;
      }
    >("/agents/job-details/prices", { raw }, opts),

  /** Single-line cleanup: rewrites one rough bullet into a tidy scope
   *  line. Called when the user edits/adds a bullet and opts in to the
   *  "professionalize that?" prompt on the Job Details screen. */
  professionalizeBullet: (text: string, opts: ApiOptions = {}) =>
    api.post<{ text: string }>(
      "/agents/job-details/professionalize",
      { text },
      opts,
    ),

  /** Translate job-detail lines into `to`. Used to localize a quote's
   *  description for the preview / sent agreement when no pre-translation
   *  exists (returns the same count + order). */
  translate: (texts: string[], to: "en" | "es", opts: ApiOptions = {}) =>
    api.post<{ texts: string[] }>(
      "/agents/job-details/translate",
      { texts, to },
      opts,
    ),
};
