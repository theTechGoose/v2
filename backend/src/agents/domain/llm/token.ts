/**
 * Injection token for the LLMClient.
 *
 * Danet's container resolves by class constructor by default; for an
 * interface-only contract we use a string token. Modules wire a concrete
 * implementation under this token (StubLLMClient in v1/tests, swap to
 * OpenAILLMClient in production).
 */
export const LLM_CLIENT = "LLM_CLIENT";
