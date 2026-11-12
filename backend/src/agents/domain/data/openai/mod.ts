import OpenAI from "#openai";
import { encodeBase64 } from "#std/encoding/base64";
import type {
  LLMAction,
  LLMClient,
  LLMRequest,
  LLMResponse,
  LLMToolName,
} from "@agents/domain/business/llm/base/mod.ts";
import {
  parseToolCall,
  TOOL_DEFS,
} from "@agents/domain/business/openai-tools/mod.ts";
import {
  DEFAULT_CHAT_TIMEOUT_MS,
  withChatTimeout,
} from "#quote-flow/chat-timeout.ts";

const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * OpenAILLMClient — production adapter against OpenAI Chat Completions
 * with function-tool calling.
 *
 * Why Chat Completions and not the Assistants API:
 *   - The agents module already manages its own conversation state
 *     (AgentMessageStore + AgentConversationStore) — we don't need
 *     OpenAI threads on top.
 *   - Chat Completions is a stable, well-documented surface; the
 *     Assistants beta is heavy and changes shape.
 *   - Cheaper per-request, easier to swap models.
 *
 * Activation:
 *   - Set `OPENAI_API_KEY` in the env.
 *   - Optionally set `OPENAI_MODEL` (defaults to `gpt-4o-mini`).
 *   - The AgentsModule binds this client only when `AGENTS_LLM_CLIENT=openai`
 *     in the env (the `start` and `dev` deno tasks set this; tests don't,
 *     so they get StubLLMClient and never make a real API call).
 */
export class OpenAILLMClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(
    opts: {
      apiKey?: string;
      model?: string;
      baseURL?: string;
      fetch?: typeof fetch;
    } = {},
  ) {
    const apiKey = opts.apiKey ?? Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set; cannot use OpenAILLMClient");
    }
    // The SDK accepts a `fetch` override — used by smoke tests so they
    // never hit the live API. The SDK's `fetch` type uses URLLike rather
    // than the WHATWG URL, hence the cast.
    this.client = new OpenAI({
      apiKey,
      baseURL: opts.baseURL,
      // deno-lint-ignore no-explicit-any
      fetch: opts.fetch as any,
    });
    this.model = opts.model ?? Deno.env.get("OPENAI_MODEL") ?? DEFAULT_MODEL;
  }

  /**
   * One BOUNDED chat completion (P-10). The SDK's own defaults are 600s per
   * attempt × 2 retries, so a hung call meant an endless spinner with no
   * error and no cancel. `withChatTimeout` races the request against
   * DEFAULT_CHAT_TIMEOUT_MS and rejects with the typed, retryable
   * `TimeoutError`; the AbortSignal (fired just after the race is lost, so
   * the TimeoutError — not the SDK's abort error — is what surfaces) cancels
   * the in-flight request instead of leaving the socket open, and
   * `maxRetries: 1` caps the SDK's internal retry loop so a hung call errors
   * at ~30s rather than ~30 minutes.
   */
  private complete(
    // deno-lint-ignore no-explicit-any
    messages: Array<any>,
    model: string = this.model,
    responseFormat?: "json",
    allowed?: readonly LLMToolName[],
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const ctl = new AbortController();
    const timer = setTimeout(
      () => ctl.abort(),
      DEFAULT_CHAT_TIMEOUT_MS + 1_000,
    );
    // REQ-368 (M32): only the tools the coordinator allowed this turn.
    const defs = allowed
      ? TOOL_DEFS.filter((d) => allowed.includes(d.function.name))
      : TOOL_DEFS;
    // REQ-028: a JSON-mode call is a one-shot structured answer — no chat
    // tools (they could only divert the reply into a tool call) and the
    // provider guarantees a syntactically valid object.
    const toolParams = responseFormat === "json"
      ? { response_format: { type: "json_object" as const } }
      : defs.length === 0
      ? {}
      : {
        tools: defs as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
        tool_choice: "auto" as const,
      };
    const call = this.client.chat.completions.create({
      model,
      messages,
      ...toolParams,
      // Keep responses tight — we want one focused step per turn.
      temperature: 0.2,
    }, { signal: ctl.signal, maxRetries: 1 });
    return withChatTimeout(call).finally(() => clearTimeout(timer));
  }

  async respond(req: LLMRequest): Promise<LLMResponse> {
    // Build the message array. System prompt first, then history. Optional
    // pre-computed business context lands as a second system message so the
    // model can ground answers in real contractor data without us injecting
    // it into the user turn (keeps the user's text faithful).
    // deno-lint-ignore no-explicit-any
    const messages: Array<any> = [
      { role: "system", content: req.systemPrompt },
    ];
    if (req.businessContext && req.businessContext.length > 0) {
      messages.push({
        role: "system",
        content:
          `Business context (refreshed each turn):\n${req.businessContext}`,
      });
    }
    for (const m of req.messages) {
      // Vision turn: switch to OpenAI's content-array format with text +
      // image_url parts. We base64-encode bytes inline; cheaper-bandwidth
      // approaches (uploading to a CDN, passing a URL) are an optimization
      // we can do later if costs/latency demand it.
      if (m.role === "user" && m.images && m.images.length > 0) {
        const parts: Array<Record<string, unknown>> = [
          { type: "text", text: m.content || "(see attached image)" },
        ];
        for (const img of m.images) {
          const dataUrl = `data:${img.mimeType};base64,${
            encodeBase64(img.bytes)
          }`;
          parts.push({ type: "image_url", image_url: { url: dataUrl } });
        }
        messages.push({ role: m.role, content: parts });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    // One retry on a fully-empty response (no text AND no tool call). This
    // happens occasionally on gpt-4o-mini when the input is long and tool-
    // call output is truncated; the user sees zero assistant messages,
    // which reads as a broken UI. The retry is deterministic enough to be
    // worth the latency cost (~1s when it triggers).
    // REQ-017: a coordinator may ask for a specific model for this call.
    const model = req.model?.trim() || this.model;
    let completion = await this.complete(
      messages,
      model,
      req.responseFormat,
      req.tools,
    );
    let choice = completion.choices[0];
    const isEmpty = (c: typeof choice) =>
      !((c?.message?.content ?? "").trim()) &&
      (c?.message?.tool_calls ?? []).length === 0;
    if (isEmpty(choice)) {
      console.warn("[openai-llm] empty response on first try; retrying once");
      completion = await this.complete(
        messages,
        model,
        req.responseFormat,
        req.tools,
      );
      choice = completion.choices[0];
    }

    const text = choice?.message?.content ?? "";
    const toolCalls = choice?.message?.tool_calls ?? [];

    // REQ-444 (demo-loop cycle 3, M21): EVERY valid tool call comes back, in
    // the model's order — the coordinator runs them all ("fix the Spanish
    // and add a $450 permit" is two). Only the first used to be honoured and
    // the rest were dropped silently, so the reply said "Done" over a change
    // that never happened. A call whose arguments don't parse is named in
    // `dropped` so the reply can say it wasn't made.
    const actions: LLMAction[] = [];
    const dropped: LLMToolName[] = [];
    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      const name = tc.function?.name as LLMToolName;
      // REQ-368: a tool this turn did not offer is never acted on (and not
      // reported — the turn never offered it).
      if (req.tools && !req.tools.includes(name)) continue;
      const action = parseToolCall(tc);
      if (action) actions.push(action);
      else if (TOOL_NAMES.has(name)) dropped.push(name);
    }
    const notMade = dropped.length ? { dropped } : {};
    if (actions.length === 0) return { text, ...notMade };
    return {
      text: text || fallbackTextFor(actions[0]),
      action: actions[0],
      actions,
      ...notMade,
    };
  }
}

/** The chat tools by name — a call to anything else is not a tool of ours. */
const TOOL_NAMES = new Set<string>(TOOL_DEFS.map((d) => d.function.name));

/** When the model returns a tool call but no surrounding prose, give the
 *  user a short readable filler. For actions that emit their own
 *  action_card (create_quote, lock_quote) we return empty — the card is
 *  more informative than restating "Drafting a quote." next to it, and
 *  the chat UI shows transient typing dots while the request is in
 *  flight. The coordinator suppresses an empty assistant bubble for
 *  these cases so we don't persist a ghost row in scrollback (#36).
 */
function fallbackTextFor(action: { type: string }): string {
  switch (action.type) {
    case "create_quote":
      return "";
    case "lock_quote":
      return "";
    case "request_terms_transition":
      return "Want to wrap the agreement terms now?";
    default:
      return "";
  }
}
