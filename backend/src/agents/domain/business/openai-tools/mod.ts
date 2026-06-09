import type { LLMAction } from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";

/**
 * OpenAI function-tool schemas. The names + parameter shapes are pinned
 * to LLMAction's variants so `parseToolCall` can switch on `name` and
 * narrow into the right action union member.
 *
 * If you add a new LLMAction variant, ALSO:
 *   1. Add the matching tool schema below
 *   2. Add a case to `parseToolCall`
 *   3. Add the action handler in handle-chat-message coordinator
 */
export const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "create_quote",
      description: t("en", "prompts.tools.createQuote.description"),
      parameters: {
        type: "object",
        properties: {
          summary:    { type: "string", description: t("en", "prompts.tools.createQuote.summary") },
          lineItems: {
            type: "array",
            description: t("en", "prompts.tools.createQuote.lineItems"),
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: t("en", "prompts.tools.createQuote.lineItemDescription") },
                amountCents: {
                  type: "integer",
                  minimum: 0,
                  description: t("en", "prompts.tools.createQuote.lineItemAmountCents"),
                },
              },
              required: ["description", "amountCents"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "lineItems"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "lock_quote",
      description: t("en", "prompts.tools.lockQuote.description"),
      parameters: {
        type: "object",
        properties: {
          quoteId: { type: "string", description: t("en", "prompts.tools.lockQuote.quoteId") },
        },
        required: ["quoteId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "request_terms_transition",
      description: t("en", "prompts.tools.requestTermsTransition.description"),
      parameters: {
        type: "object",
        properties: {
          quoteId: { type: "string", description: t("en", "prompts.tools.requestTermsTransition.quoteId") },
        },
        required: ["quoteId"],
        additionalProperties: false,
      },
    },
  },
] as const;

/**
 * Pure parser: takes one OpenAI tool_call and narrows it into an LLMAction
 * (or returns undefined for unknown tools / malformed args). Exported for
 * direct unit testing without spinning up the real client.
 */
export function parseToolCall(call: { function: { name: string; arguments: string } }): LLMAction | undefined {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  switch (call.function.name) {
    case "create_quote": {
      const summary = typeof args.summary === "string" ? args.summary : "";
      const rawItems = Array.isArray(args.lineItems) ? args.lineItems : [];
      const lineItems: { description: string; amountCents: number }[] = [];
      for (const item of rawItems) {
        if (typeof item !== "object" || item === null) continue;
        const i = item as Record<string, unknown>;
        if (typeof i.description !== "string") continue;
        if (typeof i.amountCents !== "number" || !Number.isFinite(i.amountCents)) continue;
        lineItems.push({ description: i.description, amountCents: Math.trunc(i.amountCents) });
      }
      if (!summary || lineItems.length === 0) return undefined;
      return { type: "create_quote", payload: { summary, lineItems } };
    }
    case "lock_quote": {
      const quoteId = typeof args.quoteId === "string" ? args.quoteId : "";
      if (!quoteId) return undefined;
      return { type: "lock_quote", payload: { quoteId } };
    }
    case "request_terms_transition": {
      const quoteId = typeof args.quoteId === "string" ? args.quoteId : "";
      if (!quoteId) return undefined;
      return { type: "request_terms_transition", payload: { quoteId } };
    }
    default:
      return undefined;
  }
}
