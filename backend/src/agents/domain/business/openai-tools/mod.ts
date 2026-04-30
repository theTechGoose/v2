import type { LLMAction } from "@agents/domain/business/llm/base/mod.ts";

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
      description: "Draft a quote for the user to review. Fire immediately when work is described — don't ask for confirmation, sizes, materials, or anything else first.",
      parameters: {
        type: "object",
        properties: {
          summary:    { type: "string", description: "One-line headline like 'Quote: 2-Car Garage Epoxy Floor'." },
          lineItems: {
            type: "array",
            description: "Quote line items. CRITICAL: amountCents is in CENTS — always multiply your dollar estimate by 100. A $1,200 job is amountCents: 120000, NOT 1200. A $16 job is 1600. If the line item should look like $X.YZ in the UI, send X*100 + YZ.",
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: "Plain-English line, e.g. 'Bathroom tile install (80 sqft, porcelain)'." },
                amountCents: {
                  type: "integer",
                  minimum: 0,
                  description: "Total dollars × 100. $1,200 → 120000. $850 → 85000. NEVER pass dollars directly.",
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
      description: "Lock the active quote so it can't be edited. Fire when the user confirms (e.g. 'lock it in', 'send it', 'yes').",
      parameters: {
        type: "object",
        properties: {
          quoteId: { type: "string", description: "The id of the quote to lock — typically the most recently drafted quote in this conversation." },
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
      description: "Offer to advance from phase 1 (quote) to phase 2 (contract terms wizard). Fire AFTER lock_quote in the same response.",
      parameters: {
        type: "object",
        properties: {
          quoteId: { type: "string", description: "The locked quote that the contract will be drafted against." },
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
