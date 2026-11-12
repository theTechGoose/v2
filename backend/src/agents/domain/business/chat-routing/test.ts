/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — the pure routing rules of a chat
 * turn: which messages are a pricing question or a billing request (answered
 * from the app's own data, never by the chat model), and which chat tools the
 * model may call in the conversation's current state.
 */
import { assertEquals } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { TOOL_DEFS } from "@agents/domain/business/openai-tools/mod.ts";
import {
  SYSTEM_PROMPT_QUOTE,
  systemPromptTermsFor,
} from "@agents/domain/business/llm-prompts/mod.ts";
import type { LLMToolName } from "@agents/domain/business/llm/base/mod.ts";
import {
  asksHowPriced,
  chatToolsFor,
  isInvoiceRequest,
  jobTitle,
  mayAdvanceQuote,
  owedNameFromHistory,
  parseDraftRequest,
  parseOwedQuestion,
  parsePricingFollowUp,
  parsePricingQuestion,
  pricingSubjects,
  withoutPlace,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// M30 — "how much do i charge for panel swap 200a" was refused by the model.
// ---------------------------------------------------------------------------

Deno.test("REQ-368 M30 parsePricingQuestion: the demo's sentence is a pricing question about 'panel swap 200a'", () => {
  assertEquals(
    parsePricingQuestion("how much do i charge for panel swap 200a"),
    { job: "panel swap 200a" },
  );
});

Deno.test("REQ-368 M30 parsePricingQuestion: the composer's own example (EN + ES) names the job before the question", () => {
  assertEquals(
    parsePricingQuestion(
      "Customer wants a 10'x10' slab, what should I charge?",
    ),
    { job: "a 10'x10' slab" },
  );
  assertEquals(
    parsePricingQuestion(
      "El cliente quiere una losa de 10'x10', ¿cuánto debo cobrar?",
    ),
    { job: "una losa de 10'x10'" },
  );
});

Deno.test("REQ-368 M30 parsePricingQuestion: other ways to ask, in English and Spanish", () => {
  const cases: [string, string][] = [
    ["What should I charge for 400 sqft of tile?", "400 sqft of tile"],
    [
      "how much should we charge to replace a water heater",
      "replace a water heater",
    ],
    ["How much to charge for a fence repair?", "a fence repair"],
    [
      "what's a fair price for a deck stain, 300 sqft",
      "a deck stain, 300 sqft",
    ],
    ["help me price a bathroom remodel", "a bathroom remodel"],
    ["¿Cuánto cobro por cambiar un panel de 200A?", "cambiar un panel de 200A"],
    ["cuanto le cobro por pintar 3 cuartos", "pintar 3 cuartos"],
    ["¿Qué precio le pongo a un techo de 2000 pies?", "un techo de 2000 pies"],
  ];
  for (const [text, job] of cases) {
    assertEquals(parsePricingQuestion(text), { job }, text);
  }
});

Deno.test("REQ-368 M30 parsePricingQuestion: a pricing question that names no job, or asks for a rate, has an empty job", () => {
  for (
    const text of [
      "what should I charge?",
      "How much should I charge for this?",
      "how much should I charge per hour?",
      "what's a fair hourly rate",
      "¿cuánto cobro por hora?",
      // the starter chip typed into the composer is a flow choice, not a job
      "I know the job, help me price it.",
      "Conozco el trabajo, ayúdame a ponerle precio.",
    ]
  ) {
    assertEquals(parsePricingQuestion(text), { job: "" }, text);
  }
});

Deno.test("REQ-368 M30 parsePricingQuestion: job descriptions, status questions and confirmations are not pricing questions", () => {
  for (
    const text of [
      "Quote for Bryant: gutter cleaning $220.",
      "Tile bathroom 80 sqft.",
      "what's the total?",
      "how much is the deposit?",
      "lock it in",
      "John signed! Please send him the deposit invoice for $1,600",
      "",
    ]
  ) {
    assertEquals(parsePricingQuestion(text), undefined, text);
  }
});

Deno.test("REQ-368 M30 jobTitle: the quote's title is the job, sentence-cased, without a leading article", () => {
  assertEquals(jobTitle("panel swap 200a"), "Panel swap 200a");
  assertEquals(jobTitle("a 10'x10' slab"), "10'x10' slab");
  assertEquals(jobTitle("una losa de 10'x10'"), "Losa de 10'x10'");
  assertEquals(jobTitle("the deck stain"), "Deck stain");
});

// ---------------------------------------------------------------------------
// M32 — "John signed! Please send him the deposit invoice" re-locked the
// signed quote and dead-ended in "All terms answered."
// ---------------------------------------------------------------------------

Deno.test("REQ-368 M32 isInvoiceRequest: the demo's sentence and other ways to ask for the bill (EN + ES)", () => {
  for (
    const text of [
      "John signed! Please send him the deposit invoice for $1,600",
      "send the invoice",
      "Invoice him for the deposit",
      "bill him for the deposit",
      "collect the deposit",
      "send him the bill",
      "Mándale la factura del anticipo",
      "factúrale el depósito",
      "hazle la factura",
      "cóbrale el anticipo",
    ]
  ) {
    assertEquals(isInvoiceRequest(text), true, text);
  }
});

Deno.test("REQ-368 M32 isInvoiceRequest: quotes, confirmations, pricing questions and change orders are not billing requests", () => {
  for (
    const text of [
      "Quote for Bryant: gutter cleaning $220.",
      "send it",
      "lock it in",
      "how much do i charge for panel swap 200a",
      "Change order for Maria: add fridge cleaning $40 to her invoice",
      "how do I bill a customer for materials?",
      "",
    ]
  ) {
    assertEquals(isInvoiceRequest(text), false, text);
  }
});

Deno.test("REQ-368 M32 chatToolsFor: a draft in the quote phase can be locked and taken to terms", () => {
  assertEquals(chatToolsFor("quote", { status: "draft" }), [
    "create_quote",
    "lock_quote",
    "request_terms_transition",
    "change_order",
    "update_job_details",
    "revise_quote", // REQ-375
  ]);
  // already locked (still a draft): locking again re-shows the terms CTA
  assertEquals(
    chatToolsFor("quote", {
      status: "draft",
      lockedAt: "2026-11-12T05:00:00Z",
    }).includes("lock_quote"),
    true,
  );
});

Deno.test("REQ-368 M32 chatToolsFor: nothing to lock — no quote, or a quote already sent / signed / declined", () => {
  const noAdvance = [
    "create_quote",
    "change_order",
    "update_job_details",
    "revise_quote", // REQ-375
  ];
  assertEquals(chatToolsFor("quote", undefined), noAdvance);
  for (const status of ["sent", "viewed", "accepted", "lost", "declined"]) {
    assertEquals(chatToolsFor("quote", { status }), noAdvance, status);
  }
  // a draft whose send was recorded is issued too
  assertEquals(
    chatToolsFor("quote", { status: "draft", sentAt: "2026-11-12T05:00:00Z" }),
    noAdvance,
  );
});

Deno.test("REQ-368 M32 chatToolsFor: the terms phase (pair 1: signed quote, finished wizard) never offers create / lock / terms", () => {
  const termsTools = ["revise_quote", "change_order", "update_job_details"]; // REQ-375
  assertEquals(chatToolsFor("terms", { status: "accepted" }), termsTools);
  assertEquals(chatToolsFor("terms", { status: "draft" }), termsTools);
  assertEquals(chatToolsFor("terms", undefined), termsTools);
});

Deno.test("REQ-368 M32 mayAdvanceQuote: lock / terms only run on a draft in the quote phase (an unreadable quote keeps the old path)", () => {
  assertEquals(mayAdvanceQuote("quote", { status: "draft" }), true);
  assertEquals(mayAdvanceQuote("quote", undefined), true);
  assertEquals(mayAdvanceQuote("quote", { status: "accepted" }), false);
  assertEquals(mayAdvanceQuote("quote", { status: "sent" }), false);
  assertEquals(mayAdvanceQuote("terms", { status: "draft" }), false);
  assertEquals(mayAdvanceQuote("terms", { status: "accepted" }), false);
});

// ---------------------------------------------------------------------------
// REQ-388 (demo-loop cycle 2, M23 + m38 + M19, run r561db6d4)
//
//   M23 (pair 7): "what should i charge to move a shower drain 18 inches on a
//   slab foundation in austin? explain how you got the number, and also
//   cuánto cobro por piso radiante en un baño de 8x10?" became ONE job — the
//   whole rest of the message — and a draft quote with it as the line item.
//   m38 (pair 7): "y para un baño de 5x8?" went to the free chat model.
//   M19 (pair 2): "¿Cuánto me debe Ana López?" had no deterministic path.
// ---------------------------------------------------------------------------

const PAIR7 =
  "what should i charge to move a shower drain 18 inches on a slab foundation in austin? explain how you got the number, and also cuánto cobro por piso radiante en un baño de 8x10?";
/** The same message as the customer quoted it back in the demo chat. */
const PAIR7_AS_QUOTED =
  "what should i charge to move a shower drain 18 inches on a slab... explain how you got the number, and also cuánto cobro por piso radiante en un baño de 8x10?";

Deno.test("REQ-388 M23 parsePricingQuestion: pair 7's question — the job ends where the question does, never the whole message", () => {
  assertEquals(parsePricingQuestion(PAIR7), {
    job: "move a shower drain 18 inches on a slab foundation in austin",
  });
  assertEquals(parsePricingQuestion(PAIR7_AS_QUOTED), {
    job: "move a shower drain 18 inches on a slab",
  });
});

Deno.test("REQ-388 M23 pricingSubjects: pair 7 asks two prices — the drain move and the heated floor", () => {
  assertEquals(pricingSubjects(PAIR7), [
    {
      job: "move a shower drain 18 inches on a slab foundation in austin",
      action: true,
    },
    { job: "piso radiante en un baño de 8x10", action: false },
  ]);
  assertEquals(pricingSubjects(PAIR7_AS_QUOTED), [
    { job: "move a shower drain 18 inches on a slab", action: true },
    { job: "piso radiante en un baño de 8x10", action: false },
  ]);
  // one question → one subject; "for" names a thing, "to" an action
  assertEquals(pricingSubjects("how much do i charge for panel swap 200a"), [
    { job: "panel swap 200a", action: false },
  ]);
  assertEquals(
    pricingSubjects("how much should we charge to replace a water heater"),
    [{ job: "replace a water heater", action: true }],
  );
  // no job / a rate / not a pricing question → nothing to price
  assertEquals(pricingSubjects("what should I charge?"), []);
  assertEquals(pricingSubjects("how much should I charge per hour?"), []);
  assertEquals(pricingSubjects("Tile bathroom 80 sqft."), []);
});

Deno.test("REQ-388 M23 the job ends at a clause boundary: '…', ', and also', 'explain', 'tell me why', a second question", () => {
  const cases: [string, string][] = [
    [
      "how much should I charge for a panel swap, and also how long does it take?",
      "a panel swap",
    ],
    ["what should I charge for a deck stain explain your math", "a deck stain"],
    ["what should I charge for a 12x12 deck… tell me why", "a 12x12 deck"],
    [
      "¿cuánto cobro por pintar 3 cuartos? y explícame por qué",
      "pintar 3 cuartos",
    ],
    [
      "Thanks. Customer wants a 10'x10' slab, what should I charge?",
      "a 10'x10' slab",
    ],
    // a comma alone, "sq. ft" and "$1,500.50" are not boundaries
    [
      "what's a fair price for a deck stain, 300 sqft",
      "a deck stain, 300 sqft",
    ],
    ["what should I charge for 400 sq. ft of tile", "400 sq. ft of tile"],
  ];
  for (const [text, job] of cases) {
    assertEquals(parsePricingQuestion(text), { job }, text);
  }
});

Deno.test("REQ-388 M23 asksHowPriced: 'explain how you got the number' asks for the reasoning; a bare pricing question does not", () => {
  for (
    const text of [
      PAIR7,
      "what should I charge for a deck? explain",
      "how much do I charge for a panel swap and why",
      "¿cuánto cobro por pintar 3 cuartos? explícame",
      "¿cuánto cobro por pintar 3 cuartos y por qué?",
      "what's a fair price for a deck stain — how did you get that number?",
    ]
  ) {
    assertEquals(asksHowPriced(text), true, text);
  }
  for (
    const text of [
      "how much do i charge for panel swap 200a",
      "¿Cuánto cobro por cambiar un panel de 200A?",
      "how much should we charge to replace a water heater",
      "what should i charge to move a shower drain 18 inches on a slab foundation in austin?",
      "",
    ]
  ) {
    assertEquals(asksHowPriced(text), false, text);
  }
});

Deno.test("REQ-388 m38 parsePricingFollowUp: 'y para un baño de 5x8?' asks the same price for another size", () => {
  const cases: [string, string][] = [
    ["y para un baño de 5x8?", "un baño de 5x8"],
    ["¿y para un baño de 5x8?", "un baño de 5x8"],
    ["and for a 5x8 one?", "a 5x8 one"],
    ["what about a 12x12 room?", "a 12x12 room"],
    ["¿y si es de 5x8?", "5x8"],
    ["how about 2 coats?", "2 coats"],
  ];
  for (const [text, job] of cases) {
    assertEquals(parsePricingFollowUp(text), { job }, text);
  }
  for (
    const text of [
      "and also add tile",
      "y gracias",
      "y para cuándo estaría listo?",
      "and what's the total?",
      "Tile bathroom 80 sqft.",
      "no no thats not a quote, I was ASKING... en español por favor",
      "",
    ]
  ) {
    assertEquals(parsePricingFollowUp(text), undefined, text);
  }
});

Deno.test("REQ-388 M19 parseOwedQuestion: pair 2 — '¿Cuánto me debe Ana López?' names her; the follow-up names nobody", () => {
  assertEquals(parseOwedQuestion("¿Cuánto me debe Ana López?"), {
    customerName: "Ana López",
  });
  assertEquals(
    parseOwedQuestion(
      "No entiendo. ¿Cuánto dinero me debe y cuándo me va a pagar?",
    ),
    {},
  );
});

Deno.test("REQ-388 M19 parseOwedQuestion: other ways to ask what a customer owes or when they pay (EN + ES)", () => {
  const named: [string, string][] = [
    ["How much does John Miller owe me?", "John Miller"],
    ["what does Ana owe?", "Ana"],
    ["how much does Ana still owe us", "Ana"],
    ["what's John's balance?", "John"],
    ["when is Ana going to pay me?", "Ana"],
    ["¿Qué me debe la señora Pérez?", "Pérez"],
    ["¿Cuándo me paga Ana López?", "Ana López"],
    ["¿Ana López cuánto me debe?", "Ana López"],
    ["cuanto me debe ana lopez y cuando me paga", "ana lopez"],
  ];
  for (const [text, name] of named) {
    assertEquals(parseOwedQuestion(text), { customerName: name }, text);
  }
  for (
    const text of [
      "how much does the customer owe me?",
      "what do they owe?",
      "¿Cuánto me debe el cliente?",
      "¿cuánto me debe?",
    ]
  ) {
    assertEquals(parseOwedQuestion(text), {}, text);
  }
});

Deno.test("REQ-388 M19 parseOwedQuestion: what the contractor owes, a pricing question, a billing ask are not 'what does X owe'", () => {
  for (
    const text of [
      "how much do I owe Home Depot?",
      "¿Cuánto le debo a Juan?",
      "¿Cuánto cobro por cambiar un panel de 200A?",
      "send him the invoice",
      "how much does a panel swap cost?",
      "John signed! Please send him the deposit invoice for $1,600",
      // what a document must say or a job costs — not what someone owes
      "¿Qué debe incluir la cotización?",
      "¿Cuánto debe costar un baño de 5x8?",
      "",
    ]
  ) {
    assertEquals(parseOwedQuestion(text), undefined, text);
  }
  // a filler word or a document is not a customer's name
  for (const text of ["Bueno, ¿cuánto me debe?", "what's the job's balance?"]) {
    assertEquals(parseOwedQuestion(text), {}, text);
  }
  // and pair 2's question is neither a billing ask nor a pricing question
  assertEquals(isInvoiceRequest("¿Cuánto me debe Ana López?"), false);
  assertEquals(parsePricingQuestion("¿Cuánto me debe Ana López?"), undefined);
});

Deno.test("REQ-388 M19 owedNameFromHistory: the follow-up 'how much does she owe' is about the customer the thread last named", () => {
  assertEquals(
    owedNameFromHistory([
      "¿Cuánto me debe Ana López?",
      "No entiendo. ¿Cuánto dinero me debe y cuándo me va a pagar?",
    ]),
    "Ana López",
  );
  assertEquals(
    owedNameFromHistory([
      "how much does John Miller owe me?",
      "what does Ana owe?",
      "and when will she pay?",
    ]),
    "Ana",
  );
  assertEquals(owedNameFromHistory(["hello", "¿cuánto me debe?"]), undefined);
});

Deno.test("REQ-388 M23 parseDraftRequest: the offer button's words (EN + ES) and 'draft it' ask for the draft", () => {
  assertEquals(parseDraftRequest("Draft a quote at $1,500"), {
    amountCents: 150_000,
  });
  assertEquals(parseDraftRequest("draft a quote at $1,500.50"), {
    amountCents: 150_050,
  });
  assertEquals(parseDraftRequest("Preparar cotización por $1,500"), {
    amountCents: 150_000,
  });
  assertEquals(parseDraftRequest("draft it at 1800"), { amountCents: 180_000 });
  assertEquals(parseDraftRequest("draft it"), {});
  assertEquals(parseDraftRequest("yes, draft it"), {});
  assertEquals(parseDraftRequest("sí, prepárala"), {});
  for (
    const text of [
      "draft a quote for a 12x12 deck, $3,000",
      "Quote for Bryant: gutter cleaning $220.",
      "how much do i charge for panel swap 200a",
      "I know my price, write it up.",
      "",
    ]
  ) {
    assertEquals(parseDraftRequest(text), undefined, text);
  }
});

Deno.test("REQ-388 M23 withoutPlace: 'in austin' is where the job is, not the job", () => {
  const austin = { city: "Austin", state: "TX" };
  assertEquals(
    withoutPlace(
      "move a shower drain 18 inches on a slab foundation in austin",
      austin,
    ),
    "move a shower drain 18 inches on a slab foundation",
  );
  assertEquals(withoutPlace("deck stain in Austin, TX", austin), "deck stain");
  assertEquals(
    withoutPlace("panel swap in round rock", austin),
    "panel swap in round rock",
  );
  assertEquals(withoutPlace("panel swap", {}), "panel swap");
});

Deno.test("REQ-388 M23 parseDraftRequest: what the chat's 'Draft a quote' button sends (asstChat.draftOffer, en + es) is read as the ask", () => {
  for (const lang of ["en", "es"] as const) {
    const said = t(lang, "asstChat.draftOffer", { amount: "$1,500" });
    assertEquals(parseDraftRequest(said), { amountCents: 150_000 }, said);
  }
});

// REQ-375 (demo-loop cycle 2, M11 + B1): the terms prompt told the model to
// call revise_quote, but chatToolsFor never offered it — so after the send it
// fell back to "tap Re-open on the quote card above", a button that isn't
// there. Every tool a prompt says to call must be one the phase offers.
// ---------------------------------------------------------------------------

Deno.test("REQ-375 M11 chatToolsFor: revise_quote is offered in both phases, whatever the quote's state", () => {
  for (
    const q of [
      undefined,
      { status: "draft" },
      { status: "draft", lockedAt: "2026-11-12T05:00:00Z" },
      { status: "sent", sentAt: "2026-11-12T05:00:00Z" },
      { status: "viewed" },
      { status: "accepted" },
    ]
  ) {
    for (const phase of ["quote", "terms"] as const) {
      assertEquals(
        chatToolsFor(phase, q).includes("revise_quote"),
        true,
        `${phase} ${JSON.stringify(q)}`,
      );
    }
  }
});

/** The tools a prompt tells the model to call ("call `x`", "fires `x`",
 *  "with `x`") — "NEVER call `x`" is not an instruction to call it. */
function toolsToCall(prompt: string): string[] {
  const names = new Set<string>(TOOL_DEFS.map((d) => d.function.name));
  const out = new Set<string>();
  for (
    const m of prompt.matchAll(
      /(?<!never\s)(?:call|fires?|with)\s+`([a-z_]+)`/gi,
    )
  ) {
    if (names.has(m[1])) out.add(m[1]);
  }
  return [...out];
}

Deno.test("REQ-375 guard: every tool the quote-phase prompt says to call is offered in the quote phase", () => {
  const offered = new Set(
    [undefined, { status: "draft" }, { status: "sent" }].flatMap((q) =>
      chatToolsFor("quote", q)
    ),
  );
  const asked = toolsToCall(SYSTEM_PROMPT_QUOTE);
  assertEquals(
    asked.includes("revise_quote"),
    true,
    "the guard reads the prompt",
  );
  for (const tool of asked) {
    assertEquals(offered.has(tool as LLMToolName), true, tool);
  }
});

Deno.test("REQ-375 guard: every tool the terms prompt says to call is offered in the terms phase, in every quote state", () => {
  const states = [
    { quote: undefined, card: false },
    { quote: { status: "draft" }, card: false },
    {
      quote: { status: "draft", lockedAt: "2026-11-12T05:00:00Z" },
      card: true,
    },
    { quote: { status: "sent", sentAt: "2026-11-12T05:00:00Z" }, card: false },
    { quote: { status: "sent", sentAt: "2026-11-12T05:00:00Z" }, card: true },
    { quote: { status: "accepted" }, card: true },
  ];
  for (const { quote, card } of states) {
    // PRICING_AND_BILLING is shared by both phases; its create_quote line is
    // scoped "In phase 1" — the terms phase is phase 2.
    const prompt = systemPromptTermsFor(quote, { hasActionCard: card })
      .split(/(?<=[.\n])/)
      .filter((s: string) => !/in phase 1/i.test(s))
      .join("");
    const offered = chatToolsFor("terms", quote);
    for (const tool of toolsToCall(prompt)) {
      assertEquals(
        offered.includes(tool as LLMToolName),
        true,
        `${tool} — ${JSON.stringify(quote)}`,
      );
    }
  }
});
