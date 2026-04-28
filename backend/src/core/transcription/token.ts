/**
 * Injection token for the TranscriptionClient.
 *
 * Danet's container resolves by class constructor by default; for an
 * interface-only contract we use a string token. CoreModule wires a
 * concrete implementation under this token (StubTranscriptionClient in
 * tests, AssemblyAITranscriptionClient in production).
 */
export const TRANSCRIPTION_CLIENT = "TRANSCRIPTION_CLIENT";
