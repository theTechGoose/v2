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
}

/**
 * A structured intent the LLM wants the coordinator to execute. The
 * coordinator decides whether to actually fire (e.g. confirm-first for
 * destructive ops). Add new variants as the action surface grows.
 */
export type LLMAction =
  | { type: "create_quote"; payload: { summary: string; lineItems: { description: string; amountCents: number }[] } }
  | { type: "lock_quote"; payload: { quoteId: string } }
  | { type: "request_terms_transition"; payload: { quoteId: string } };

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
