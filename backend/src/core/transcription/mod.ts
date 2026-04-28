/**
 * Transcription client abstraction.
 *
 * Core never imports the AssemblyAI SDK (or any other speech-to-text
 * vendor) directly — callers always go through `TranscriptionClient`. This
 * lets:
 *   - tests inject a deterministic StubTranscriptionClient (no API key)
 *   - production swap vendors (AssemblyAI → Deepgram → Whisper) without
 *     touching consumers
 *   - voice-memo handling in agents/communication share one entrypoint
 *
 * The contract is intentionally narrow: take audio bytes (or a URL), get
 * back text plus a few useful fields (duration, language, optional word
 * timings). Anything richer (diarization, summarization, sentiment) is
 * vendor-specific and stays inside the adapter.
 */

export interface TranscriptionRequest {
  /** Raw audio bytes. Either `audio` or `audioUrl` must be set. */
  audio?: Uint8Array;
  /** Public URL the vendor can fetch. Either `audio` or `audioUrl` must be set. */
  audioUrl?: string;
  /** MIME type of the audio (e.g. "audio/webm", "audio/mp4"). Optional hint. */
  mimeType?: string;
  /** BCP-47 language code (e.g. "en", "es"). Defaults to vendor auto-detect. */
  language?: string;
  /** Stable id of the calling user — for logging/quota; never sent to the model. */
  userId: string;
}

export interface TranscriptionWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface TranscriptionResponse {
  /** Plain-text transcript. Empty string if the audio had no detected speech. */
  text: string;
  /** Detected (or echoed) BCP-47 language code. */
  language?: string;
  /** Audio duration in seconds, when the vendor reports it. */
  durationSec?: number;
  /** Optional per-word timings — populated when the vendor returns them. */
  words?: TranscriptionWord[];
}

export interface TranscriptionClient {
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResponse>;
}
