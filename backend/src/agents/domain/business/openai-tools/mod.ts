import type { LLMAction } from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { PAYMENT_TERMS_PRESETS } from "@agents/domain/business/terms-prefill/mod.ts";
import { isAddressShaped } from "#quote-flow/quick-quote-prefill.ts";
import { ES_TRADE_GLOSSARY } from "@agents/domain/business/es-trade-glossary/mod.ts";

/** REQ-315: "q-001" / "Q-001 bathroom" → "Q-001"; anything else → undefined. */
function docNumber(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/\bQ-\d+\b/i);
  return m ? m[0].toUpperCase() : undefined;
}

/** REQ-462: "co-001" / "CO-1 door" → "CO-001" / "CO-1"; anything else → undefined. */
function coNumber(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/\bCO-\d+\b/i);
  return m ? m[0].toUpperCase() : undefined;
}

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
          // REQ-315: "… on Q-001" names the quote outright.
          quoteNumber: { type: "string", description: t("en", "prompts.tools.changeOrder.quoteNumber") },
          description: { type: "string", description: t("en", "prompts.tools.changeOrder.descriptionField") },
          deltaAmountCents: { type: "integer", description: t("en", "prompts.tools.changeOrder.deltaAmountCents") },
          // REQ-377 (demo-loop cycle 2, B1): a new TOTAL, in dollars — the
          // server subtracts the current total and converts to cents.
          newTotalDollars: { type: "number", description: t("en", "prompts.tools.changeOrder.newTotalDollars") },
        },
        required: ["description"],
        additionalProperties: false,
      },
    },
  },
  // REQ-315 (demo-loop cycle 1, M26): "change plumbing fixtures to $1,300"
  // reprices THAT line; change_order would have appended one.
  {
    type: "function" as const,
    function: {
      name: "revise_quote",
      description: t("en", "prompts.tools.reviseQuote.description"),
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string", description: t("en", "prompts.tools.reviseQuote.customerName") },
          quoteNumber: { type: "string", description: t("en", "prompts.tools.reviseQuote.quoteNumber") },
          lines: {
            type: "array",
            description: t("en", "prompts.tools.reviseQuote.lines"),
            items: {
              type: "object",
              properties: {
                match: { type: "string", description: t("en", "prompts.tools.reviseQuote.match") },
                description: { type: "string", description: t("en", "prompts.tools.reviseQuote.lineDescription") },
                amountCents: { type: "integer", description: t("en", "prompts.tools.reviseQuote.amountCents") },
              },
              required: ["match"],
              additionalProperties: false,
            },
          },
          remove: {
            type: "array",
            description: t("en", "prompts.tools.reviseQuote.remove"),
            items: { type: "string" },
          },
        },
        required: ["lines"],
        additionalProperties: false,
      },
    },
  },
  // REQ-462 (demo-loop cycle 3, M26): "Change of plan on CO-001: make it
  // $1,000" edits THAT change order; revise_quote can't touch one.
  {
    type: "function" as const,
    function: {
      name: "update_change_order",
      description: t("en", "prompts.tools.updateChangeOrder.description"),
      parameters: {
        type: "object",
        properties: {
          changeOrderNumber: { type: "string", description: t("en", "prompts.tools.updateChangeOrder.changeOrderNumber") },
          description: { type: "string", description: t("en", "prompts.tools.updateChangeOrder.descriptionField") },
          amountDollars: { type: "number", description: t("en", "prompts.tools.updateChangeOrder.amountDollars") },
          withdraw: { type: "boolean", description: t("en", "prompts.tools.updateChangeOrder.withdraw") },
        },
        required: ["changeOrderNumber"],
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
              // REQ-448 (demo-loop cycle 3, m47): the Spanish the chat model
              // writes here gets the shared trade glossary.
              es: { type: "string", description: `${t("en", "prompts.tools.updateJobDetails.es")} ${ES_TRADE_GLOSSARY}` },
            },
            additionalProperties: false,
          },
        },
        required: ["descriptionByLang"],
        additionalProperties: false,
      },
    },
  },
  // REQ-585 (demo-loop cycle 4, M4 + M30): "we start monday nov 23",
  // "empezamos la próxima semana, no el próximo mes", "its 2 and a half weeks
  // not 2" had no tool — the agreement terms are changed here, in the
  // contractor's own words; the coordinator reads them against today.
  {
    type: "function" as const,
    function: {
      name: "update_terms",
      description: t("en", "prompts.tools.updateTerms.description"),
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: t("en", "prompts.tools.updateTerms.startDate") },
          duration: { type: "string", description: t("en", "prompts.tools.updateTerms.duration") },
          paymentTerms: { type: "string", description: t("en", "prompts.tools.updateTerms.paymentTerms") },
        },
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
      // REQ-263: the job address, when the user gave one. REQ-418 (demo M27):
      // a phone, an email or a letterless value is never one — dropped here;
      // the coordinator also checks it against what the user typed.
      const rawAddress = typeof args.serviceAddress === "string" ? args.serviceAddress.trim() : "";
      const serviceAddress = rawAddress && isAddressShaped(rawAddress) ? rawAddress : "";
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
      const hasDelta = typeof delta === "number" && Number.isFinite(delta);
      // REQ-377 (B1): a new total in dollars → integer cents, here, in code.
      const total = args.newTotalDollars;
      const targetTotalCents = typeof total === "number" && Number.isFinite(total) && total > 0
        ? Math.round(total * 100)
        : undefined;
      if (!description || (!hasDelta && targetTotalCents === undefined)) return undefined;
      const customerName = typeof args.customerName === "string" ? args.customerName.trim() : "";
      const quoteNumber = docNumber(args.quoteNumber); // REQ-315
      return {
        type: "change_order",
        payload: {
          ...(customerName ? { customerName } : {}),
          ...(quoteNumber ? { quoteNumber } : {}),
          description,
          deltaAmountCents: hasDelta ? Math.trunc(delta as number) : 0,
          ...(targetTotalCents !== undefined ? { targetTotalCents } : {}),
        },
      };
    }
    // REQ-315 (demo-loop cycle 1, M26): only entries that name a line AND
    // change something survive; a remove-only call is fine; nothing → undefined.
    case "revise_quote": {
      const lines: { match: string; description?: string; amountCents?: number }[] = [];
      for (const raw of Array.isArray(args.lines) ? args.lines : []) {
        if (typeof raw !== "object" || raw === null) continue;
        const r = raw as Record<string, unknown>;
        const match = typeof r.match === "string" ? r.match.trim() : "";
        if (!match) continue;
        const description = typeof r.description === "string" ? r.description.trim() : "";
        const cents = typeof r.amountCents === "number" && Number.isFinite(r.amountCents)
          ? Math.trunc(r.amountCents)
          : undefined;
        if (!description && cents === undefined) continue;
        lines.push({
          match,
          ...(description ? { description } : {}),
          ...(cents !== undefined ? { amountCents: cents } : {}),
        });
      }
      const remove = (Array.isArray(args.remove) ? args.remove : [])
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean);
      if (lines.length === 0 && remove.length === 0) return undefined;
      const customerName = typeof args.customerName === "string" ? args.customerName.trim() : "";
      const quoteNumber = docNumber(args.quoteNumber);
      return {
        type: "revise_quote",
        payload: {
          ...(customerName ? { customerName } : {}),
          ...(quoteNumber ? { quoteNumber } : {}),
          lines,
          remove,
        },
      };
    }
    // REQ-462 (M26): a CO number plus a withdrawal, a new wording or a new
    // amount — dollars → integer cents here, in code; nothing to change → undefined.
    case "update_change_order": {
      const changeOrderNumber = coNumber(args.changeOrderNumber);
      if (!changeOrderNumber) return undefined;
      if (args.withdraw === true) {
        return { type: "update_change_order", payload: { changeOrderNumber, withdraw: true } };
      }
      const description = typeof args.description === "string" ? args.description.trim() : "";
      const dollars = args.amountDollars;
      const amountCents = typeof dollars === "number" && Number.isFinite(dollars) && dollars !== 0
        ? Math.round(dollars * 100)
        : undefined;
      if (!description && amountCents === undefined) return undefined;
      return {
        type: "update_change_order",
        payload: {
          changeOrderNumber,
          ...(description ? { description } : {}),
          ...(amountCents !== undefined ? { amountCents } : {}),
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
    // REQ-585 (M4 + M30): each term the model gave, trimmed — the server reads
    // the words; nothing given → undefined.
    case "update_terms": {
      const payload: { startDate?: string; duration?: string; paymentTerms?: string } = {};
      for (const k of ["startDate", "duration", "paymentTerms"] as const) {
        const v = typeof args[k] === "string" ? (args[k] as string).trim() : "";
        if (v) payload[k] = v;
      }
      if (!Object.keys(payload).length) return undefined;
      return { type: "update_terms", payload };
    }
    default:
      return undefined;
  }
}
