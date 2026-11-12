/**
 * LLM client abstraction.
 *
 * The agents module never imports an OpenAI/Anthropic SDK directly — it
 * always goes through `LLMClient`. This lets:
 *   - tests inject a deterministic StubLLMClient (no API key needed)
 *   - production swap models (OpenAI Assistants → Responses API → Anthropic
 *     Messages) without touching coordinators
 *   - integration tests of the chat coordinator run end-to-end against a
 *     scripted client
 *
 * The contract is intentionally narrow: take a chat history + system
 * prompt, return a text reply plus an optional structured action that
 * the coordinator should execute (create-quote, lock-quote, etc.).
 */

export type LLMRole = "user" | "assistant" | "system";

/** Vision attachment on a user turn — passed through to the model in
 *  whatever the adapter's native image format is (OpenAI uses an
 *  image_url content part with a base64 data URL). Stub clients ignore. */
export interface LLMImageAttachment {
  /** Raw bytes; the adapter base64-encodes when constructing the request. */
  bytes: Uint8Array;
  /** MIME type so the data URL gets the right header. */
  mimeType: string;
}

export interface LLMTurn {
  role: LLMRole;
  content: string;
  /** Optional vision attachments (only meaningful on user turns).
   *  Adapters that don't support vision fall back to content-only. */
  images?: LLMImageAttachment[];
}

export interface LLMRequest {
  systemPrompt: string;
  messages: LLMTurn[];
  /** Stable id of the calling user — for logging/quota; never sent to the model. */
  userId: string;
  /**
   * Pre-computed business context (customer summary, open items, etc.).
   * Coordinators build this; the LLM client just appends it to the prompt.
   */
  businessContext?: string;
  /**
   * Per-call model override (REQ-017 / NW-12). Most turns run on the
   * client's default (OPENAI_MODEL, gpt-4o-mini); pricing asks for a
   * stronger model because the small one under-prices real jobs. Ignored by
   * the stub.
   */
  model?: string;
  /**
   * REQ-028 (NW-05): ask the provider for JSON mode — a syntactically valid
   * object every time. Set by the one-shot JSON coordinators (job options,
   * polish); live probes on gpt-4o-mini fell to the fallback 4 of 5 times on
   * a missing brace. The stub ignores it.
   */
  responseFormat?: "json";
  /**
   * REQ-368 (demo-loop cycle 1, M32): the chat tools the model may call this
   * turn — the coordinator's call, from the conversation's phase and its
   * quote's state. Omitted → every tool (callers that don't gate); [] → none.
   * A signed quote's terms-phase turn carried lock_quote, and "send him the
   * deposit invoice" became a re-lock of the signed quote.
   */
  tools?: readonly LLMToolName[];
}

/**
 * A structured intent the LLM wants the coordinator to execute. The
 * coordinator decides whether to actually fire (e.g. confirm-first for
 * destructive ops). Add new variants as the action surface grows.
 */
export type LLMAction =
  | {
    type: "create_quote";
    payload: {
      summary: string;
      /** REQ-337 (demo m6/p15-1): the model's own short job name, when it
       *  gave one — preferred over the summary-derived fallback. */
      jobName?: string;
      lineItems: { description: string; amountCents: number }[];
      /** REQ-263: the job address the user typed, when they gave one. */
      serviceAddress?: string;
      /** REQ-258 (demo M22): a payment split the contractor stated ("half
       *  deposit" → "50_50") — a payment_terms wizard option id. */
      paymentTerms?: string;
    };
  }
  | { type: "lock_quote"; payload: { quoteId: string } }
  | { type: "request_terms_transition"; payload: { quoteId: string } }
  /** REQ-238 (demo M27): change an EXISTING job — a change order on its
   *  invoice, a pending revision on its issued quote, a line on its draft.
   *  Never a new quote. `deltaAmountCents` is signed (− is a credit). */
  | {
    type: "change_order";
    payload: {
      customerName?: string;
      /** REQ-315: an explicit "Q-001" — resolves straight to that quote. */
      quoteNumber?: string;
      description: string;
      deltaAmountCents: number;
    };
  }
  /** REQ-315 (demo-loop cycle 1, M26): change lines that are ALREADY on a
   *  customer's quote — reprice / reword (`lines`) or take off (`remove`) —
   *  never append. The coordinator finds the quote (an explicit Q-number
   *  first), matches each named line, and writes a pending revision on an
   *  issued quote or edits a draft in place. */
  | {
    type: "revise_quote";
    payload: {
      customerName?: string;
      quoteNumber?: string;
      lines: { match: string; description?: string; amountCents?: number }[];
      remove: string[];
    };
  }
  /** REQ-262 (demo M25): rewrite / translate the bound quote's job details.
   *  The coordinator applies it to conv.quoteId — never to a model-named id —
   *  and never to a signed quote. Text per language, bullets newline-joined. */
  | {
    type: "update_job_details";
    payload: { descriptionByLang: Partial<Record<"en" | "es", string>> };
  };

/** REQ-368: a chat tool's name — one per LLMAction variant. */
export type LLMToolName = LLMAction["type"];

export interface LLMResponse {
  text: string;
  action?: LLMAction;
}

export interface LLMClient {
  respond(req: LLMRequest): Promise<LLMResponse>;
}

/**
 * Injection token for the LLMClient. Danet's container resolves by class
 * constructor by default; for an interface-only contract we use a string
 * token. Modules wire a concrete implementation under this token
 * (StubLLMClient in tests, OpenAILLMClient in production).
 */
export const LLM_CLIENT = "LLM_CLIENT";
