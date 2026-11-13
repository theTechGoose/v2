import { assert, assertEquals } from "#std/assert";
import {
  SYSTEM_PROMPT_QUOTE,
  SYSTEM_PROMPT_TERMS,
  systemPromptTermsFor,
} from "./mod.ts";
import { t } from "@core/i18n/mod.ts";

Deno.test("llm-prompts: quote system prompt is a non-empty string", () => {
  assertEquals(typeof SYSTEM_PROMPT_QUOTE, "string");
  assert(SYSTEM_PROMPT_QUOTE.length > 0);
});

Deno.test("llm-prompts: terms system prompt is a non-empty string", () => {
  assertEquals(typeof SYSTEM_PROMPT_TERMS, "string");
  assert(SYSTEM_PROMPT_TERMS.length > 0);
});

Deno.test("llm-prompts: quote and terms are distinct prompts", () => {
  assert(SYSTEM_PROMPT_QUOTE !== SYSTEM_PROMPT_TERMS);
});

// REQ-258 (demo M22): "…2 coats, I supply paint. $2,400 total, half deposit."
// came back as "customer supplied paint" — the quote prompt never said the user
// is the contractor, and had no rule for a stated deposit. These are the rules
// the model executes; the tool's own field descriptions carry them too.
Deno.test("REQ-258 quote prompt: first person (I / we / my) is the contractor, and the supplier is never flipped", () => {
  assert(/I\/we\/my/.test(SYSTEM_PROMPT_QUOTE), "names I/we/my");
  assert(/the user is the contractor/i.test(SYSTEM_PROMPT_QUOTE), "says the user is the contractor");
  assert(SYSTEM_PROMPT_QUOTE.includes("'I supply paint'"), "carries the paint example");
  assert(/paint supplied by contractor/.test(SYSTEM_PROMPT_QUOTE), "maps it to the contractor");
  assert(/never flip/i.test(SYSTEM_PROMPT_QUOTE), "forbids flipping the supplier");
});

Deno.test("REQ-258 quote prompt: a stated deposit / payment split goes into paymentTerms", () => {
  assert(/paymentTerms/.test(SYSTEM_PROMPT_QUOTE));
  assert(/'half deposit'[^\n]*50_50/.test(SYSTEM_PROMPT_QUOTE), "half deposit → 50_50");
});

Deno.test("REQ-258 create_quote line-item description carries the contractor-perspective rule in both languages", () => {
  for (const lang of ["en", "es"] as const) {
    const d = t(lang, "prompts.tools.createQuote.lineItemDescription");
    assert(/contractor/i.test(d) && /never flip/i.test(d), `${lang}: ${d}`);
  }
});

// REQ-657 (demo-loop cycle 5, M13): the line-item hint carried the copyable
// phrase 'paint supplied by contractor', and gpt-4o-mini wrote it on a job
// whose message never said who supplies paint. The hint now says to mention
// the supplier only when the contractor said so, with no phrase to copy.
Deno.test("REQ-657 M13 create_quote line-item description: supplier only when stated, no copyable supplier phrase (en + es)", () => {
  for (const lang of ["en", "es"] as const) {
    const d = t(lang, "prompts.tools.createQuote.lineItemDescription");
    assert(!/supplied by/i.test(d), `${lang} carries a copyable supplier phrase: ${d}`);
    assert(!/I supply/i.test(d), `${lang} carries the paint example: ${d}`);
    assert(/ONLY if the contractor said so/.test(d), `${lang}: ${d}`);
    assert(/never flip/i.test(d), `${lang} keeps the REQ-258 rule: ${d}`);
  }
});

// REQ-261 (demo M26): both chat prompts tell the model a contractor's stated
// costs are private and never go into job details or customer text.
Deno.test("REQ-261 M26 quote and terms prompts carry the PRIVATE COSTS rule", () => {
  for (const p of [SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS]) {
    assert(p.includes("PRIVATE COSTS"), "missing PRIVATE COSTS rule");
    assert(/never put a dollar amount/i.test(p), "rule must forbid dollar amounts");
  }
});

// REQ-388 (demo-loop cycle 2, run r561db6d4) — the pricing/billing rules both
// chat prompts carry (REQ-368's prompts.pricingAndBilling).
//   m38: the model told the contractor "obtén varias cotizaciones de
//   contratistas locales" — the prompt never said the user IS the contractor.
//   M23: it told the model to "also call create_quote at the typical price"
//   for a pricing question — a question became a draft.
//   M19: it said "say the invoice already went out when they signed" for every
//   signed quote — false for a pay-after-completion job (REQ-316) — and the
//   Spanish override let the model answer "El invoice ya se envió".
Deno.test("REQ-388 m38 quote and terms prompts: the user is the contractor — advise what to charge, never send them to other contractors for quotes", () => {
  for (const p of [SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS]) {
    assert(
      /advise them on what to CHARGE/.test(p),
      "says who the advice is for",
    );
    assert(
      /never tell (?:them|the contractor) to get quotes or bids from other contractors/i
        .test(p),
      "forbids 'get quotes from other contractors'",
    );
  }
});

Deno.test("REQ-388 M23 quote and terms prompts: a pricing question is answered, never drafted into a quote", () => {
  for (const p of [SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS]) {
    assert(
      !/also call `?create_quote`? at the typical price/i.test(p),
      "still drafts",
    );
    assert(/don't draft a quote unless the contractor asks for one/i.test(p));
  }
});

Deno.test("REQ-388 M19 quote and terms prompts: what was billed follows the payment terms and the data — no blanket 'went out when they signed'", () => {
  for (const p of [SYSTEM_PROMPT_QUOTE, SYSTEM_PROMPT_TERMS]) {
    assert(!/say the invoice already went out when they signed/i.test(p));
    assert(
      /payment upon completion/i.test(p),
      "names pay-after-completion terms",
    );
    assert(/never say an invoice went out unless/i.test(p));
  }
});

Deno.test("REQ-388 M19 the Spanish override names the documents in Spanish — 'factura', never 'invoice' (en and es dictionaries agree)", () => {
  for (const lang of ["en", "es"] as const) {
    const o = t(lang, "prompts.contractorLanguageEsOverride");
    assert(o.includes("'factura' (never 'invoice')"), `${lang}: ${o}`);
    assert(o.includes("'cotización' (never 'quote')"), `${lang}: ${o}`);
  }
  assertEquals(
    t("en", "prompts.pricingAndBilling"),
    t("es", "prompts.pricingAndBilling"),
  );
});

// REQ-375 (demo-loop cycle 2, M11): after the send, the terms prompt still said
// "tell them to tap Re-open on the quote card above" — on a sent quote there is
// no such button (and ReopenQuote refuses an issued quote). The instruction now
// depends on the bound quote's state.
const REOPEN = /tap Re-open on the quote card/i;
const SENT = { status: "sent", sentAt: "2026-11-12T05:00:00Z" };

Deno.test("REQ-375 M11 base terms prompt carries no Re-open instruction", () => {
  for (const lang of ["en", "es"] as const) {
    assert(!REOPEN.test(t(lang, "prompts.systemTerms")), lang);
  }
  assert(!REOPEN.test(SYSTEM_PROMPT_TERMS));
});

Deno.test("REQ-375 M11 sent quote: make the change with revise_quote, say it is saved as the next Version — never 'tap Re-open'", () => {
  for (const hasActionCard of [false, true]) {
    for (const quote of [SENT, { status: "viewed" }]) {
      const p = systemPromptTermsFor(quote, { hasActionCard });
      assert(!REOPEN.test(p), `${JSON.stringify(quote)} card=${hasActionCard}`);
      assert(/`revise_quote`/.test(p));
      assert(/next Version/.test(p), "says the change is saved as a new Version");
      assert(/publish/i.test(p), "says the Version is waiting to be published");
      assert(/never tell the user to tap Re-open/i.test(p));
    }
  }
});

Deno.test("REQ-375 M11 signed quote: lines can't change — change_order, no Re-open", () => {
  const p = systemPromptTermsFor({ status: "accepted" }, { hasActionCard: true });
  assert(!REOPEN.test(p));
  assert(/SIGNED/.test(p) && /`change_order`/.test(p));
});

Deno.test("REQ-375 M11 Re-open is mentioned only for a locked, unsent quote that has a quote card", () => {
  const locked = { status: "draft", lockedAt: "2026-11-12T05:00:00Z" };
  const withCard = systemPromptTermsFor(locked, { hasActionCard: true });
  assert(REOPEN.test(withCard), withCard);
  assert(/`revise_quote`/.test(withCard));
  assert(!REOPEN.test(systemPromptTermsFor(locked, { hasActionCard: false })));
  assert(!REOPEN.test(systemPromptTermsFor({ status: "draft" }, { hasActionCard: false })));
  assert(!REOPEN.test(systemPromptTermsFor(undefined, { hasActionCard: false })));
});

Deno.test("REQ-375 every state-specific terms section exists in en and es", () => {
  for (const k of ["issued", "signed", "lockedCard", "open"]) {
    for (const lang of ["en", "es"] as const) {
      const key = `prompts.termsPriceChange.${k}`;
      assert(t(lang, key) !== key, `${lang}: ${key}`);
    }
  }
});
