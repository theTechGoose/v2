import OpenAI from "#openai";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import type { LLMClient, LLMRequest, LLMResponse } from "@agents/domain/business/llm/base/mod.ts";
import { TOOL_DEFS, parseToolCall } from "@agents/domain/business/openai-tools/mod.ts";

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

  constructor(opts: { apiKey?: string; model?: string; baseURL?: string; fetch?: typeof fetch } = {}) {
    const apiKey = opts.apiKey ?? Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set; cannot use OpenAILLMClient");
    }
    // The SDK accepts a `fetch` override — used by smoke tests so they
    // never hit the live API. The SDK's `fetch` type uses URLLike rather
    // than the WHATWG URL, hence the cast.
    // deno-lint-ignore no-explicit-any
    this.client = new OpenAI({ apiKey, baseURL: opts.baseURL, fetch: opts.fetch as any });
    this.model = opts.model ?? Deno.env.get("OPENAI_MODEL") ?? DEFAULT_MODEL;
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
      messages.push({ role: "system", content: `Business context (refreshed each turn):\n${req.businessContext}` });
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
          const dataUrl = `data:${img.mimeType};base64,${encodeBase64(img.bytes)}`;
          parts.push({ type: "image_url", image_url: { url: dataUrl } });
        }
        messages.push({ role: m.role, content: parts });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: TOOL_DEFS as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
      tool_choice: "auto",
      // Keep responses tight — we want one focused step per turn.
      temperature: 0.2,
    });

    const choice = completion.choices[0];
    const text = choice?.message?.content ?? "";
    const toolCalls = choice?.message?.tool_calls ?? [];

    // We only honor the FIRST tool call per turn; multi-tool fan-out is
    // intentionally not supported yet (keeps the action handler simple).
    // If the LLM tries multiple, the rest are dropped — log if needed.
    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      const action = parseToolCall(tc);
      if (action) return { text: text || fallbackTextFor(action), action };
    }
    return { text };
  }
}

/** When the model returns a tool call but no surrounding prose, give the
 *  user a short readable filler so the chat doesn't show an empty bubble.
 *  Phrasing intentionally neutral — the action_card / continue_cta the
 *  coordinator appends afterwards carries the real information.
 */
function fallbackTextFor(action: { type: string }): string {
  switch (action.type) {
    case "create_quote":             return "Drafting a quote.";
    case "lock_quote":               return "Locking the quote.";
    case "request_terms_transition": return "Want to wrap the contract terms now?";
    default:                          return "";
  }
}
