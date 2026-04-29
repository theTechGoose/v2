/**
 * Poly-mod barrel for the transcription feature.
 *
 * Re-exports the base contract + every implementation. Module roots wire
 * `TRANSCRIPTION_CLIENT` to one of these classes based on env config; tests
 * and local dev get the stub by default, production opts in to OpenAI
 * Whisper via `TRANSCRIPTION_CLIENT=openai`.
 */
export type {
  TranscriptionClient,
  TranscriptionRequest,
  TranscriptionResponse,
  TranscriptionWord,
} from "./base/mod.ts";
export { TRANSCRIPTION_CLIENT } from "./base/mod.ts";

export { StubTranscriptionClient } from "./implementations/stub/mod.ts";
export { OpenAIWhisperClient } from "./implementations/openai-whisper/mod.ts";
