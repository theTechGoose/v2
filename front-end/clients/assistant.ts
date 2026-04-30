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
export interface Quote {
  id: string;
  userId: string;
  customerId?: string;
  summary: string;
  lineItems: QuoteLineItem[];
  estimatedTotal: number;
  status: "draft" | "sent" | "accepted" | "declined" | "expired";
  createdAt: string;
  updatedAt: string;
}

/** Mirrors backend AgentPhase. */
export type ConversationPhase = "quote" | "terms";

export interface Conversation {
  id: string;
  userId: string;
  customerId?: string;
  quoteId?: string;
  contractId?: string;
  invoiceId?: string;
  currentPhase: ConversationPhase;
  title?: string;
  customerName?: string;
  preview?: string;
  /** Set by accept-contract; cleared by load-conversation on next read. */
  hasUnreadEvent?: boolean;
  /** Denormalized quote.status — sent / accepted. */
  quoteStatus?: string;
  /** Denormalized contract.status — drives the sidebar chip without an N+1. */
  contractStatus?: string;
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

export interface ContractLite {
  id: string;
  status?: string;
  totalAmount?: number;
  [k: string]: unknown;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  customer?: CustomerLite;
  contract?: ContractLite;
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
  try { return await fn(); } catch (err) {
    if (err instanceof ApiError && err.status === 404) return fallback;
    throw err;
  }
}

export const assistantClient = {
  conversations: (limit = 50, opts: ApiOptions = {}) =>
    safe(() => api.get<Conversation[]>("/agents/conversations", { ...opts, query: { limit } }), []),

  conversation:  (id: string, opts: ApiOptions = {}) =>
    api.get<ConversationDetail>(`/agents/conversations/${id}`, opts),

  startConversation: (body: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.post<Conversation>("/agents/conversations", body, opts),

  transitionToTerms: (id: string, opts: ApiOptions = {}) =>
    api.post<ConversationDetail>(`/agents/conversations/${id}/transition-to-terms`, undefined, opts),

  /** Flip the active quote to "sent" via the deterministic /lock-quote
   *  endpoint, bypassing the LLM. Returns the action_card + continue_cta
   *  to append to the chat. */
  lockQuote: (conversationId: string, quoteId: string, opts: ApiOptions = {}) =>
    api.post<{ conversation: Conversation; newMessages: Message[] }>(
      `/agents/conversations/${conversationId}/lock-quote`,
      { quoteId },
      opts,
    ),

  /** Dev-only: simulate the customer signing the contract — the single
   *  customer-facing acceptance event in the chain. Flips contract→
   *  accepted, emits the chat phase_divider + "Continue to invoice"
   *  CTA, and sets hasUnreadEvent so the threads sidebar bubbles +
   *  badges. */
  acceptContract: (conversationId: string, contractId: string, opts: ApiOptions = {}) =>
    api.post<{ conversation: Conversation; newMessages: Message[] }>(
      `/agents/conversations/${conversationId}/accept-contract`,
      { contractId },
      opts,
    ),

  /** Fire the wizard's "Ready to send" CTA: flips contract→sent and
   *  emails the customer. Idempotent, so a re-click just re-renders. */
  sendContract: (conversationId: string, contractId: string, opts: ApiOptions = {}) =>
    api.post<{ conversation: Conversation; newMessages: Message[] }>(
      `/agents/conversations/${conversationId}/send-contract`,
      { contractId },
      opts,
    ),

  /** Fire the post-contract-acceptance "Continue to invoice" CTA:
   *  materializes an Invoice from the bound contract (or reuses an
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
  sendQuote: (id: string, body: { to?: string; from?: string } = {}, opts: ApiOptions = {}) =>
    api.post<{ ok: boolean }>(`/quotes/${id}/email`, body, opts),

  listCustomers: (opts: ApiOptions = {}) =>
    safe(() => api.get<CustomerLite[]>("/customers", opts), [] as CustomerLite[]),

  answerWizard: (
    body: {
      conversationId: string;
      stepId: string;
      optionId: string;
      customValue?: string;
      customer?: { id?: string; create?: { name: string; email?: string; phoneNumber?: string } };
      followUpValues?: Record<string, string | number>;
    },
    opts: ApiOptions = {},
  ) =>
    api.post<{
      conversation: Conversation;
      wizardState?: unknown;
      newMessages: Message[];
    }>("/agents/wizard/answer", body, opts),
};
