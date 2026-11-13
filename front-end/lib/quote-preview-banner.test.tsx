/**
 * REQ-559 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issues m17 ("Owner's preview of client quote page
 * confusing: sign disabled vs prompts, notice only in section 05") and
 * p4-p1c ("'Sign in person' not obvious").
 *
 * In the owner's preview of their own quote (/q/:id, internal, open, no
 * override):
 * - a top banner says who they are previewing as and that signing, questions
 *   and decline are off, with a SOLID "Sign in person" button (same handler);
 * - the "Sign and type your name below ↓" instruction is not shown;
 * - Ask a question / Decline are disabled, with a tooltip saying why.
 * The customer's own view (not internal) and the in-person override keep all
 * of it as before. The browser proof is e2e/quote-preview-banner.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";
import PublicQuoteActions from "../islands/PublicQuoteActions.tsx";
import { tFor } from "./i18n.ts";

function quote(internal: boolean): QuotePublic {
  return {
    id: "q-559",
    number: "Q-559",
    version: 1,
    state: "sent",
    status: "sent",
    internal,
    customer: { name: "Linda Park", email: "linda@example.com" },
    contractor: { name: "Bob Builder", businessName: "Bob's Plumbing" },
    summary: "Deck repair",
    estimatedTotal: 250000,
    lineItems: [{
      description: "Deck repair",
      quantity: 1,
      unit: "job",
      price: 250000,
    }],
  } as QuotePublic;
}

function render(node: preact.JSX.Element) {
  return new DOMParser().parseFromString(
    `<html><body>${renderToString(node)}</body></html>`,
    "text/html",
  )!;
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-559 (demo m17 + p4-p1c, cycle 4) [${lang}]: the owner's preview opens with a top banner naming the customer and a solid Sign in person button`, () => {
    let called = 0;
    const doc = render(
      <QuoteDoc
        quote={quote(true)}
        lang={lang}
        search=""
        onSignInPerson={() => called++}
      />,
    );
    const banner = doc.querySelector("[data-cy='quote-preview-banner']");
    assert(banner, "the preview banner renders");
    const html = doc.body.innerHTML;
    assert(
      html.indexOf("quote-preview-banner") < html.indexOf("<h1") ||
        html.indexOf("<h1") === -1,
      "the banner sits above the document",
    );
    assert(
      html.indexOf("quote-preview-banner") <
        html.indexOf("quote-internal-preview"),
      "the banner comes before the signature section",
    );
    const text = banner.textContent ?? "";
    assert(text.includes("Linda Park"), `names the customer: ${text}`);
    assert(
      text.includes(tFor(lang, "public.doc.previewBanner.off")),
      `says signing, questions and decline are off: ${text}`,
    );
    const style = banner.getAttribute("style") ?? "";
    assert(/position:\s*sticky/.test(style), `sticky: ${style}`);
    assert(/top:\s*0/.test(style), `pinned to the top: ${style}`);
    const btn = banner.querySelector(
      "[data-cy='quote-preview-sign-in-person']",
    );
    assert(btn, "the banner carries the Sign in person button");
    assertEquals(btn.tagName.toLowerCase(), "button");
    assertEquals(btn.getAttribute("type"), "button");
    const bstyle = btn.getAttribute("style") ?? "";
    assert(!/text-decoration:\s*underline/.test(bstyle), "not a text link");
    assert(/background:\s*#[0-9a-f]{3,6}/i.test(bstyle), `solid: ${bstyle}`);
    assertEquals(
      (btn.textContent ?? "").trim(),
      tFor(lang, "public.doc.previewBanner.signInPerson"),
    );
    assertEquals(called, 0);
  });

  Deno.test(`REQ-559 (demo m17, cycle 4) [${lang}]: the preview does not tell the owner to "sign below"`, () => {
    const doc = render(
      <QuoteDoc quote={quote(true)} lang={lang} search="" />,
    );
    const text = doc.body.textContent ?? "";
    assertEquals(
      text.includes("↓"),
      false,
      `no "sign below ↓" instruction in preview`,
    );
  });

  Deno.test(`REQ-559 (demo m17, cycle 4) [${lang}]: the customer's own view and the in-person override keep the instruction and no banner`, () => {
    for (
      const [q, search] of [
        [quote(false), ""],
        [quote(true), "?as=customer&confirm=1"],
      ] as const
    ) {
      const doc = render(<QuoteDoc quote={q} lang={lang} search={search} />);
      assertEquals(
        doc.querySelector("[data-cy='quote-preview-banner']"),
        null,
        "no preview banner",
      );
      assert((doc.body.textContent ?? "").includes("↓"), "sign-below kept");
    }
  });

  Deno.test(`REQ-559 (demo m17, cycle 4) [${lang}]: in preview Ask a question and Decline are disabled with a tooltip`, () => {
    const doc = render(
      <PublicQuoteActions quoteId="q-559" lang={lang} preview />,
    );
    const ask = doc.querySelector("[data-cy='quote-ask']");
    const dec = doc.querySelector("[data-cy='quote-decline']");
    assert(ask && dec, "both buttons render");
    const tip = tFor(lang, "publicQuoteActions.previewDisabled");
    assert(tip && tip !== "publicQuoteActions.previewDisabled", "key exists");
    for (const b of [ask, dec]) {
      assert(b.hasAttribute("disabled"), "disabled");
      assertEquals(b.getAttribute("title"), tip);
    }
    const live = render(<PublicQuoteActions quoteId="q-559" lang={lang} />);
    for (const sel of ["quote-ask", "quote-decline"]) {
      const b = live.querySelector(`[data-cy='${sel}']`);
      assert(b, sel);
      assertEquals(b.hasAttribute("disabled"), false, `${sel} live`);
    }
  });

  Deno.test(`REQ-559 (demo m17, cycle 4) [${lang}]: QuoteDoc hands the preview flag to the actions panel`, () => {
    const doc = render(
      <QuoteDoc quote={quote(true)} lang={lang} search="" />,
    );
    const ask = doc.querySelector("[data-cy='quote-ask']");
    assert(ask, "actions panel renders");
    assert(ask.hasAttribute("disabled"), "Ask disabled in the owner preview");
  });
}
