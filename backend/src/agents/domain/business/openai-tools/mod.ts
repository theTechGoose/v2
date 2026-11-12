import type { LLMAction } from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { PAYMENT_TERMS_PRESETS } from "@agents/domain/business/terms-prefill/mod.ts";

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
          // REQ-337 (demo m6/p15-1): the model names the job; the summary's
          // customer tail is never sliced into a title.
          jobName:    { type: "string", description: t("en", "prompts.tools.createQuote.jobName") },
          serviceAddress: { type: "string", description: t("en", "prompts.tools.createQuote.serviceAddress") },
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
          // REQ-258 (demo M22): "half deposit" had nowhere to go.
          paymentTerms: {
            type: "string",
            enum: [...PAYMENT_TERMS_PRESETS],
            description: t("en", "prompts.tools.createQuote.paymentTerms"),
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
  // REQ-238 (demo M27): "change order for Maria: add …" changes Maria's
  // existing job instead of drafting a new quote.
  {
    type: "function" as const,
    function: {
      name: "change_order",
      description: t("en", "prompts.tools.changeOrder.description"),
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string", description: t("en", "prompts.tools.changeOrder.customerName") },
          description: { type: "string", description: t("en", "prompts.tools.changeOrder.descriptionField") },
          deltaAmountCents: { type: "integer", description: t("en", "prompts.tools.changeOrder.deltaAmountCents") },
        },
        required: ["description", "deltaAmountCents"],
        additionalProperties: false,
      },
    },
  },
  // REQ-262 (demo M25): the assistant could not change job details once the
  // quote existed ("I can't change the job details at this stage").
  {
    type: "function" as const,
    function: {
      name: "update_job_details",
      description: t("en", "prompts.tools.updateJobDetails.description"),
      parameters: {
        type: "object",
        properties: {
          descriptionByLang: {
            type: "object",
            description: t("en", "prompts.tools.updateJobDetails.descriptionByLang"),
            properties: {
              en: { type: "string", description: t("en", "prompts.tools.updateJobDetails.en") },
              es: { type: "string", description: t("en", "prompts.tools.updateJobDetails.es") },
            },
            additionalProperties: false,
          },
        },
        required: ["descriptionByLang"],
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
      // REQ-337: the model's own job name, when it gave one
      const jobName = typeof args.jobName === "string" ? args.jobName.trim() : "";
      // REQ-263: the job address, when the user gave one
      const serviceAddress = typeof args.serviceAddress === "string" ? args.serviceAddress.trim() : "";
      // REQ-258: only a preset payment option id survives; anything else is
      // dropped and the wizard asks as before.
      const paymentTerms = typeof args.paymentTerms === "string" &&
          PAYMENT_TERMS_PRESETS.includes(args.paymentTerms)
        ? args.paymentTerms
        : undefined;
      return {
        type: "create_quote",
        payload: {
          summary,
          ...(jobName ? { jobName } : {}),
          lineItems,
          ...(serviceAddress ? { serviceAddress } : {}),
          ...(paymentTerms ? { paymentTerms } : {}),
        },
      };
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
    case "change_order": {
      const description = typeof args.description === "string" ? args.description.trim() : "";
      const delta = args.deltaAmountCents;
      if (!description || typeof delta !== "number" || !Number.isFinite(delta)) return undefined;
      const customerName = typeof args.customerName === "string" ? args.customerName.trim() : "";
      return {
        type: "change_order",
        payload: {
          ...(customerName ? { customerName } : {}),
          description,
          deltaAmountCents: Math.trunc(delta),
        },
      };
    }
    case "update_job_details": {
      const raw = args.descriptionByLang;
      if (typeof raw !== "object" || raw === null) return undefined;
      const byLang: Partial<Record<"en" | "es", string>> = {};
      for (const lang of ["en", "es"] as const) {
        const v = (raw as Record<string, unknown>)[lang];
        const text = Array.isArray(v)
          ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).join("\n")
          : typeof v === "string"
          ? v.trim()
          : "";
        if (text) byLang[lang] = text;
      }
      if (!Object.keys(byLang).length) return undefined;
      return { type: "update_job_details", payload: { descriptionByLang: byLang } };
    }
    default:
      return undefined;
  }
}
