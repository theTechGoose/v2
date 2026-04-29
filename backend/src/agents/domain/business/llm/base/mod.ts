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

export interface LLMTurn {
  role: LLMRole;
  content: string;
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
}

/**
 * A structured intent the LLM wants the coordinator to execute. The
 * coordinator decides whether to actually fire (e.g. confirm-first for
 * destructive ops). Add new variants as the action surface grows.
 */
export type LLMAction =
  | { type: "create_quote"; payload: { customerId?: string; summary: string; lineItems: { description: string; amountCents: number }[] } }
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
