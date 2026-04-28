import { AssemblyAI } from "#assemblyai";
import type {
  TranscriptionClient,
  TranscriptionRequest,
  TranscriptionResponse,
} from "@transcription/mod.ts";

/**
 * AssemblyAITranscriptionClient — production adapter against AssemblyAI's
 * pre-recorded transcription API.
 *
 * Why AssemblyAI:
 *   - Accepts raw bytes via SDK upload OR a hosted URL — fits both our
 *     in-KV voice clips (FileStore.readBytes) and S3-hosted media.
 *   - Single `transcripts.transcribe(...)` call submits + polls until the
 *     transcript is ready, so callers get a synchronous Promise<text>.
 *   - Returns word-level timings (start/end in ms) which we surface as-is
 *     for downstream highlighting/seek-to-word UI.
 *
 * Activation:
 *   - Set `ASSEMBLYAI_API_KEY` in the env.
 *   - The CoreModule binds this client only when
 *     `TRANSCRIPTION_CLIENT=assemblyai` (the `start` and `dev` deno tasks
 *     set this; tests don't, so they get StubTranscriptionClient and
 *     never make a real API call).
 */
export class AssemblyAITranscriptionClient implements TranscriptionClient {
  private client: AssemblyAI;

  constructor(opts: { apiKey?: string } = {}) {
    const apiKey = opts.apiKey ?? Deno.env.get("ASSEMBLYAI_API_KEY");
    if (!apiKey) {
      throw new Error("ASSEMBLYAI_API_KEY is not set; cannot use AssemblyAITranscriptionClient");
    }
    this.client = new AssemblyAI({ apiKey });
  }

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResponse> {
    if (!req.audio && !req.audioUrl) {
      throw new Error("transcribe requires either `audio` bytes or `audioUrl`");
    }

    // The SDK's `transcribe()` helper submits the job and polls until it
    // reaches a terminal state (`completed` or `error`). For bytes it
    // uploads to AssemblyAI's storage first, then hands back the transcript.
    const transcript = await this.client.transcripts.transcribe({
      audio: req.audio ?? req.audioUrl!,
      language_code: req.language,
    });

    if (transcript.status === "error") {
      throw new Error(`AssemblyAI transcription failed: ${transcript.error ?? "unknown error"}`);
    }

    return {
      text: transcript.text ?? "",
      language: transcript.language_code ?? undefined,
      durationSec: transcript.audio_duration ?? undefined,
      words: transcript.words?.map((w) => ({
        text: w.text,
        startMs: w.start,
        endMs: w.end,
        confidence: w.confidence,
      })),
    };
  }
}
