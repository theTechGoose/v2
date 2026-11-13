import type {
  LLMClient,
  LLMRequest,
  LLMResponse,
  LLMStreamSink,
} from "@agents/domain/business/llm/base/mod.ts";

/**
 * REQ-670 (demo-loop cycle 5, p7): how far apart the stub's streamed pieces
 * go out — a model's pace, so a streamed turn (the SSE route, the chat's
 * bubble) is visibly streamed without a key.
 */
export const STUB_STREAM_PIECE_MS = 20;

/**
 * StubLLMClient — for tests + local dev without an API key.
 *
 * Three modes:
 *
 *   1. Default (no script set): echoes the latest user message back as
 *      "(stub) <message>". No actions fired. Lets coordinator tests run
 *      without setup.
 *
 *   2. Scripted (setScript): pop one canned response per call. Lets
 *      coordinator/E2E tests assert specific multi-turn flows.
 *
 *   3. Programmable (setHandler): inspect the LLMRequest and decide
 *      what to return. Lets a test simulate "agent recognizes 'lock
 *      it in' and emits lock_quote action".
 *
 * REQ-670: a request with a `stream` sink (not JSON mode) gets its answer
 * streamed like the real client's — the text word by word, then the tool
 * call's name — and the same response back.
 *
 * StubLLMClient is `@Injectable`-style by virtue of having a no-arg
 * constructor; the agents module wires it as the default in tests.
 */
export class StubLLMClient implements LLMClient {
  private script: LLMResponse[] = [];
  private handler: ((req: LLMRequest) => LLMResponse | Promise<LLMResponse>) | null = null;

  setScript(responses: LLMResponse[]): void {
    this.script = [...responses];
  }

  setHandler(fn: (req: LLMRequest) => LLMResponse | Promise<LLMResponse>): void {
    this.handler = fn;
  }

  reset(): void {
    this.script = [];
    this.handler = null;
  }

  async respond(req: LLMRequest): Promise<LLMResponse> {
    const res = await this.answer(req);
    if (req.stream && req.responseFormat !== "json") {
      await streamOut(res, req.stream);
    }
    return res;
  }

  private async answer(req: LLMRequest): Promise<LLMResponse> {
    if (this.handler) return await this.handler(req);
    if (this.script.length > 0) return this.script.shift()!;

    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    return { text: `(stub) ${lastUser?.content ?? ""}` };
  }
}

/** REQ-670: the response's text to the sink a word at a time, a model's pace
 *  apart, then its first tool call's name — the order OpenAI streams them. */
async function streamOut(res: LLMResponse, sink: LLMStreamSink): Promise<void> {
  const pieces = (res.text ?? "").match(/\s*\S+\s*/g) ?? [];
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, STUB_STREAM_PIECE_MS));
    }
    sink.text(pieces[i]);
  }
  const first = res.action ?? res.actions?.[0];
  if (first) sink.tool?.(first.type);
}
