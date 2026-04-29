import type {
  TranscriptionClient,
  TranscriptionRequest,
  TranscriptionResponse,
} from "@core/business/transcription/base/mod.ts";

/**
 * StubTranscriptionClient — for tests + local dev without an API key.
 *
 * Three modes:
 *
 *   1. Default (no script set): returns a deterministic placeholder
 *      "(stub transcript)" with empty word timings. Lets coordinator
 *      tests run without setup.
 *
 *   2. Scripted (setScript): pop one canned response per call. Lets
 *      coordinator/E2E tests assert specific multi-call flows.
 *
 *   3. Programmable (setHandler): inspect the TranscriptionRequest and
 *      decide what to return. Lets a test simulate "this fileId returns
 *      'hello world', that one returns ''".
 *
 * Mirrors the shape of StubLLMClient so the wiring patterns stay
 * symmetrical between agents/llm and core/transcription.
 */
export class StubTranscriptionClient implements TranscriptionClient {
  private script: TranscriptionResponse[] = [];
  private handler: ((req: TranscriptionRequest) => TranscriptionResponse | Promise<TranscriptionResponse>) | null = null;

  setScript(responses: TranscriptionResponse[]): void {
    this.script = [...responses];
  }

  setHandler(fn: (req: TranscriptionRequest) => TranscriptionResponse | Promise<TranscriptionResponse>): void {
    this.handler = fn;
  }

  reset(): void {
    this.script = [];
    this.handler = null;
  }

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResponse> {
    if (this.handler) return await this.handler(req);
    if (this.script.length > 0) return this.script.shift()!;
    return { text: "(stub transcript)", language: req.language ?? "en" };
  }
}
