/**
 * Poly-mod barrel for the LLM client feature.
 *
 * Re-exports the active variant and the base contract. External callers
 * import from here — never from implementations/ directly. Production
 * wiring swaps OpenAI in via `agents/domain/data/openai`; tests use the
 * stub variant exported here.
 */
export type {
  LLMAction,
  LLMClient,
  LLMRequest,
  LLMResponse,
  LLMRole,
  LLMTurn,
} from "./base/mod.ts";
export { LLM_CLIENT } from "./base/mod.ts";

export { StubLLMClient } from "./implementations/stub/mod.ts";
