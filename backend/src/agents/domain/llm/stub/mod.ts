import type { LLMClient, LLMRequest, LLMResponse } from "@agents/domain/llm/mod.ts";

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
    if (this.handler) return await this.handler(req);
    if (this.script.length > 0) return this.script.shift()!;

    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    return { text: `(stub) ${lastUser?.content ?? ""}` };
  }
}
