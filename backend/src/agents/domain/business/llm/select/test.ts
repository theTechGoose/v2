import { assertEquals, assertThrows } from "#std/assert";
import { selectLlmClientName } from "./mod.ts";

// REQ-001 — production must never silently boot on the stub LLM.

Deno.test("REQ-001 selectLlmClientName: AGENTS_LLM_CLIENT=openai → openai", () => {
  assertEquals(selectLlmClientName({ AGENTS_LLM_CLIENT: "openai" }), "openai");
});

Deno.test("REQ-001 selectLlmClientName: unset outside production → stub (tests/dev keep the stub)", () => {
  assertEquals(selectLlmClientName({}), "stub");
  assertEquals(selectLlmClientName({ AGENTS_LLM_CLIENT: "" }), "stub");
  assertEquals(selectLlmClientName({ AGENTS_LLM_CLIENT: "something-else" }), "stub");
});

Deno.test("REQ-001 selectLlmClientName: unset in production (DENO_DEPLOYMENT_ID set) → throws loudly", () => {
  assertThrows(
    () => selectLlmClientName({ DENO_DEPLOYMENT_ID: "abc" }),
    Error,
    'AGENTS_LLM_CLIENT must be "openai" in production',
  );
});

Deno.test("REQ-001 selectLlmClientName: production with the var set → openai", () => {
  assertEquals(
    selectLlmClientName({ AGENTS_LLM_CLIENT: "openai", DENO_DEPLOYMENT_ID: "abc" }),
    "openai",
  );
});

Deno.test("REQ-001 selectLlmClientName: second key TRANSCRIPTION_CLIENT gets the same rules", () => {
  assertEquals(selectLlmClientName({ TRANSCRIPTION_CLIENT: "openai" }, "TRANSCRIPTION_CLIENT"), "openai");
  assertEquals(selectLlmClientName({}, "TRANSCRIPTION_CLIENT"), "stub");
  assertThrows(
    () => selectLlmClientName({ DENO_DEPLOYMENT_ID: "abc" }, "TRANSCRIPTION_CLIENT"),
    Error,
    'TRANSCRIPTION_CLIENT must be "openai" in production',
  );
});
