/**
 * selectLlmClientName — REQ-001 (NW-05 / NW-11 / NW-12).
 *
 * Pure decision: which client class an env selects. No I/O here; the
 * module roots pass in the env values they read.
 *
 *   - `<key>=openai`                     → "openai"
 *   - anything else, NOT in production   → "stub" (tests and local dev)
 *   - anything else, IN production       → throws — never boot prod on
 *     the stub, whose "(stub) <text>" echo is what produced the verbatim
 *     job descriptions and unanchored prices the client screenshotted.
 *
 * "Production" = `DENO_DEPLOYMENT_ID` is set (Deno Deploy sets it on
 * every deployment; nothing else in this repo does).
 */
export type LlmClientName = "openai" | "stub";
export type LlmClientEnvKey = "AGENTS_LLM_CLIENT" | "TRANSCRIPTION_CLIENT";

export interface LlmClientEnv {
  AGENTS_LLM_CLIENT?: string;
  TRANSCRIPTION_CLIENT?: string;
  DENO_DEPLOYMENT_ID?: string;
}

export function selectLlmClientName(
  env: LlmClientEnv,
  key: LlmClientEnvKey = "AGENTS_LLM_CLIENT",
): LlmClientName {
  if (env[key] === "openai") return "openai";
  const inProduction = typeof env.DENO_DEPLOYMENT_ID === "string" && env.DENO_DEPLOYMENT_ID.length > 0;
  if (inProduction) {
    throw new Error(`${key} must be "openai" in production`);
  }
  return "stub";
}
