import type {
  TranscriptionClient,
  TranscriptionRequest,
  TranscriptionResponse,
} from "@core/business/transcription/base/mod.ts";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "whisper-1";

/**
 * OpenAIWhisperClient — production TranscriptionClient backed by the OpenAI
 * Audio Transcriptions API.
 *
 * Configuration:
 *   - OPENAI_API_KEY                (required)
 *   - OPENAI_BASE_URL               (defaults to https://api.openai.com/v1)
 *   - OPENAI_TRANSCRIPTION_MODEL    (defaults to whisper-1)
 *
 * Wire-format choice: the multipart `audio/transcriptions` endpoint with
 * `response_format=verbose_json` so we get language detection + duration.
 *
 * Tests can swap `fetchOverride` to intercept the HTTP request without
 * hitting the live API.
 */
export class OpenAIWhisperClient implements TranscriptionClient {
  fetchOverride: typeof fetch | null = null;

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResponse> {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? DEFAULT_BASE_URL;
    const model = Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") ?? DEFAULT_MODEL;

    const audioBytes = await resolveAudioBytes(req);
    const form = new FormData();
    const filename = guessFilename(req.mimeType);
    form.append(
      "file",
      new Blob([audioBytes as BlobPart], { type: req.mimeType ?? "audio/webm" }),
      filename,
    );
    form.append("model", model);
    form.append("response_format", "verbose_json");
    if (req.language) form.append("language", req.language);

    const f = this.fetchOverride ?? globalThis.fetch;
    const res = await f(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`openai whisper ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = await res.json() as {
      text?: string;
      language?: string;
      duration?: number;
      words?: { word: string; start: number; end: number }[];
    };
    return {
      text:        body.text ?? "",
      language:    body.language,
      durationSec: body.duration,
      words: body.words?.map((w) => ({
        text:    w.word,
        startMs: Math.round(w.start * 1000),
        endMs:   Math.round(w.end * 1000),
      })),
    };
  }
}

async function resolveAudioBytes(req: TranscriptionRequest): Promise<Uint8Array> {
  if (req.audio) return req.audio;
  if (req.audioUrl) {
    const r = await fetch(req.audioUrl);
    if (!r.ok) throw new Error(`failed to fetch audio at ${req.audioUrl}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  throw new Error("transcription request requires `audio` or `audioUrl`");
}

function guessFilename(mimeType?: string): string {
  if (!mimeType) return "audio.webm";
  if (mimeType.includes("mp4"))  return "audio.mp4";
  if (mimeType.includes("mpeg")) return "audio.mp3";
  if (mimeType.includes("wav"))  return "audio.wav";
  if (mimeType.includes("ogg"))  return "audio.ogg";
  return "audio.webm";
}
