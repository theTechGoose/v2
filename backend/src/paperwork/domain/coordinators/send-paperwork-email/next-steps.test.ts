/**
 * REQ-682 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue m28 ("Quote email promises steps that don't
 * apply"): the quote email's "What happens next" said "3 Pick a start day —
 * We'll text to confirm" and "4 … Receipt + warranty in your inbox" on every
 * quote — even with the start already set, texting off, and no warranty.
 * The steps are now built from the quote and the send channel.
 */
import { assertEquals, assertMatch, assertNotMatch } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { quoteEmailSteps, renderQuoteHtml } from "./mod.ts";

const carl = {
  id: "u-carl",
  name: "Carl",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const bizEn = {
  userId: "u-carl",
  businessName: "Jensen Electric LLC",
  commsLanguage: "en",
} as BusinessIdentity;
const bizEs = { ...bizEn, commsLanguage: "es" } as BusinessIdentity;

function quote(extra: Partial<Quote> = {}): Quote {
  return {
    id: "q-1",
    userId: "u-carl",
    number: "Q-001",
    version: 1,
    status: "sent",
    customerSnapshot: { name: "Pat Doe" },
    summary: "Panel upgrade",
    lineItems: [{ description: "Panel upgrade", quantity: 1, price: 250000 }],
    estimatedTotal: 250000,
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
    ...extra,
  } as unknown as Quote;
}

const step = (
  q: Quote,
  n: number,
  lang: "en" | "es" = "en",
  textable = false,
) => quoteEmailSteps(q, lang, { textable })[n - 1];

Deno.test("REQ-682 (m28) the email never asks the customer to pick a start day", () => {
  for (const lang of ["en", "es"] as const) {
    for (const textable of [true, false]) {
      const [, title] = step(quote(), 3, lang, textable);
      assertNotMatch(title, /Pick a start day|Eliges fecha de inicio/);
    }
  }
});

Deno.test("REQ-682 (m28) a set ISO startDate: step 3 reads 'Work starts <date>', no text promised", () => {
  const [, title, sub] = step(
    quote({ startDate: "2026-11-20" }),
    3,
    "en",
    true,
  );
  assertEquals(title, "Work starts Nov 20, 2026");
  assertNotMatch(sub, /text/i);
  const [, es] = step(quote({ startDate: "2026-11-20" }), 3, "es");
  assertEquals(es, "El trabajo empieza el 20 nov 2026");
});

Deno.test("REQ-682 (m28) a start TERM ('Next week' — pair 1): step 3 says when work starts", () => {
  const q = quote({
    terms: [{ stepId: "start_date", label: "Start", value: "Next week" }],
  });
  assertEquals(step(q, 3)[1], "Work starts next week");
  assertEquals(step(q, 3, "es")[1], "El trabajo empieza la próxima semana");
  const picked = quote({
    terms: [{ stepId: "start_date", label: "Start", value: "2026-12-01" }],
  });
  assertEquals(step(picked, 3)[1], "Work starts Dec 1, 2026");
});

Deno.test("REQ-682 (m28) no start (or TBD): 'We'll confirm a start day' — a text only when the send texts a textable number", () => {
  for (
    const q of [
      quote(),
      quote({
        terms: [{ stepId: "start_date", label: "Start", value: "TBD" }],
      }),
    ]
  ) {
    const [, title, emailOnly] = step(q, 3, "en", false);
    assertEquals(title, "We'll confirm a start day");
    assertNotMatch(emailOnly, /text/i);
    const [, , texted] = step(q, 3, "en", true);
    assertMatch(texted, /text/i);
    const [, esTitle, esSub] = step(q, 3, "es", false);
    assertEquals(esTitle, "Confirmamos la fecha de inicio");
    assertNotMatch(esSub, /mensaje/i);
  }
});

Deno.test("REQ-682 (m28) step 4 mentions the warranty only when the quote has one", () => {
  assertEquals(step(quote(), 4)[2], "Receipt in your inbox");
  const none = quote({
    terms: [{ stepId: "warranty", label: "Warranty", value: "No warranty" }],
  });
  assertEquals(step(none, 4)[2], "Receipt in your inbox");
  assertEquals(step(none, 4, "es")[2], "Recibo en tu correo");
  const year = quote({
    terms: [{ stepId: "warranty", label: "Warranty", value: "1 year" }],
  });
  assertEquals(step(year, 4)[2], "Receipt + warranty in your inbox");
  assertEquals(step(year, 4, "es")[2], "Recibo + garantía en tu correo");
});

Deno.test("REQ-682 (m28) renderQuoteHtml renders the built steps (email-only default promises no text)", () => {
  const html = renderQuoteHtml(
    quote({ startDate: "2026-11-20" }),
    undefined,
    carl,
    bizEn,
  );
  assertMatch(html, /Work starts Nov 20, 2026/);
  assertNotMatch(html, /Pick a start day|We'll text to confirm/);
  assertNotMatch(html, /warranty/i);
  const noStart = renderQuoteHtml(quote(), undefined, carl, bizEs);
  assertMatch(noStart, /Confirmamos la fecha de inicio/);
  assertNotMatch(noStart, /Te escribimos para confirmar|garantía/);
  const texted = renderQuoteHtml(quote(), undefined, carl, bizEn, {
    textable: true,
  });
  assertMatch(texted, /We(&#39;|')ll text you/);
});
