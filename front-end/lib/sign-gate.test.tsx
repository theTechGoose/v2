/**
 * REQ-460 — demo-loop cycle 3, issue M16 ("the customer link can be signed
 * before the quote is finished"): /q read "AWAITING SIGNATURE" and offered the
 * pad — and the owner's "Sign in person" — while the assistant was still asking
 * for the payment terms. The server now names why a quote cannot be signed yet
 * (`signRefusal` on the public payload); the page then shows a "not ready to
 * sign" notice where the pad was, to the customer and to the owner alike, and
 * the status pill stops saying "Awaiting signature".
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";
import { tFor } from "./i18n.ts";

function quote(extra: Partial<QuotePublic> = {}): QuotePublic {
  return {
    id: "q-460",
    number: "Q-004",
    version: 1,
    state: "draft",
    status: "draft",
    customer: { name: "Linda Ortiz", email: "linda@example.com" },
    contractor: { name: "Tom Baker", businessName: "Baker Roofing" },
    summary: "Roof replacement",
    estimatedTotal: 1_450_000,
    lineItems: [{
      description: "Roof replacement",
      quantity: 1,
      unit: "job",
      price: 1_450_000,
    }],
    terms: [{ stepId: "start_date", label: "Start", value: "Next week" }],
    ...extra,
  } as QuotePublic;
}

function render(q: QuotePublic, lang: "en" | "es" = "en", search = "") {
  const html = renderToString(
    <QuoteDoc quote={q} lang={lang} search={search} />,
  );
  return new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
}

Deno.test("REQ-460 (demo-loop cycle 3, M16): the customer opening an unsent quote's link sees 'not ready to sign' — no pad, no 'Awaiting signature'", () => {
  const doc = render(quote({ signRefusal: "not_issued" }));
  const notice = doc.querySelector("[data-cy='quote-not-ready']");
  assert(notice, "the not-ready notice renders");
  assert(
    notice.textContent.includes(tFor("en", "public.doc.notReady")),
    notice.textContent,
  );
  assertEquals(doc.querySelector("form.ctr__sign-form"), null, "no pad");
  assertEquals(
    doc.body.textContent.includes(tFor("en", "quoteDoc.awaiting")),
    false,
    "the pill no longer says Awaiting signature",
  );
});

Deno.test("REQ-460 (demo-loop cycle 3, M16): the owner's own view — even with ?as=customer&confirm=1 — offers no 'Sign in person' and no pad while the quote is unready", () => {
  for (const search of ["", "?as=customer&confirm=1"]) {
    const doc = render(
      quote({ internal: true, signRefusal: "not_issued" }),
      "en",
      search,
    );
    assert(doc.querySelector("[data-cy='quote-not-ready']"), search);
    assertEquals(
      doc.querySelector("[data-cy='quote-sign-in-person']"),
      null,
      `no Sign in person (${search || "plain"})`,
    );
    assertEquals(doc.querySelector("[data-cy='quote-internal-preview']"), null);
    assertEquals(doc.querySelector("form.ctr__sign-form"), null);
  }
});

Deno.test("REQ-460 (demo-loop cycle 3, M15): a sent quote whose payment terms are not on it yet is not signable either — in Spanish too", () => {
  const doc = render(
    quote({ status: "sent", state: "sent", signRefusal: "terms_incomplete" }),
    "es",
  );
  const notice = doc.querySelector("[data-cy='quote-not-ready']");
  assert(notice);
  assert(
    notice.textContent.includes(tFor("es", "public.doc.notReadyBody")),
    notice.textContent,
  );
  assertEquals(doc.querySelector("form.ctr__sign-form"), null);
});

Deno.test("REQ-460: a sent quote with its payment terms still shows the pad and 'Awaiting signature' to the customer", () => {
  const doc = render(
    quote({
      status: "sent",
      state: "sent",
      terms: [
        { stepId: "start_date", label: "Start", value: "Next week" },
        { stepId: "payment_terms", label: "Payment", value: "50 / 50" },
      ],
    }),
  );
  assertEquals(doc.querySelector("[data-cy='quote-not-ready']"), null);
  assert(doc.querySelector("form.ctr__sign-form"), "the pad renders");
  assert(doc.body.textContent.includes(tFor("en", "quoteDoc.awaiting")));
});
