/**
 * Poly-mod barrel for the transcription feature.
 *
 * Re-exports the active variant and the base contract. External callers
 * import from here, never from the implementations/ directory directly.
 *
 * The stub is the active variant for tests + local dev. Production wiring
 * would swap a vendor adapter under the same `TranscriptionClient`
 * contract — but we keep the seam here so callers don't change.
 */
export type {
  TranscriptionClient,
  TranscriptionRequest,
  TranscriptionResponse,
  TranscriptionWord,
} from "./base/mod.ts";

export { StubTranscriptionClient } from "./implementations/stub/mod.ts";
