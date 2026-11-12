/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — the pure routing rules of a chat
 * turn: which messages are a pricing question or a billing request (answered
 * from the app's own data, never by the chat model), and which chat tools the
 * model may call in the conversation's current state.
 */
import { assertEquals } from "#std/assert";
import {
  chatToolsFor,
  isInvoiceRequest,
  jobTitle,
  mayAdvanceQuote,
  parsePricingQuestion,
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
  const noAdvance = ["create_quote", "change_order", "update_job_details"];
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
  const termsTools = ["change_order", "update_job_details"];
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
