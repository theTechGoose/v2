/**
 * REQ-687 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issues m59 ("Contractor's view of
 * her signed quote thanks her as the client") and p14 ("Sticky 'You're
 * previewing as' bar covers '05 SIGN HERE'").
 *
 * m59: the business viewing its own SIGNED quote (/q/:id, internal, no
 * in-person override) gets an owner-voiced banner — "Signed by Linda Park on
 * … — you're viewing the customer's copy" — with an owner next step (the
 * open invoice in Invoices, else the quote in Quotes), never the customer's
 * "Thanks, Linda" / "your contractor will be in touch" / "pay the … due".
 *
 * p14: the sticky preview banner collapses to a one-line strip once the page
 * scrolls, and the document's sections reserve room for it (scroll-margin-top)
 * so a header scrolled to the top is not hidden under it.
 * The browser proof is e2e/owner-signed-quote.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";
import {
  ownerSignedNext,
  ownerSignedView,
} from "../../shared/quote-flow/public-doc-state.ts";
import { tFor } from "./i18n.ts";

const ACCEPTED_AT = "2026-11-12T15:00:00.000Z";

function signedQuote(
  internal: boolean,
  invoices: QuotePublic["invoices"] = [],
): QuotePublic {
  return {
    id: "q-687",
    number: "Q-687",
    version: 1,
    state: "accepted",
    status: "accepted",
    internal,
    acceptedAt: ACCEPTED_AT,
    acceptedName: "Linda Park",
    customer: { name: "Linda Park", email: "linda@example.com" },
    contractor: { name: "Maria Castro", businessName: "Castro Painting" },
    summary: "Living room painting",
    estimatedTotal: 145000,
    lineItems: [{
      description: "Living room painting",
      quantity: 1,
      unit: "job",
      price: 145000,
    }],
    invoices,
  } as QuotePublic;
}

const OPEN_INVOICE = [{
  id: "inv-1",
  number: "INV-001",
  status: "sent",
  amountCents: 72500,
  balanceCents: 72500,
  url: "/i/inv-1",
}] as QuotePublic["invoices"];

function openQuote(internal: boolean): QuotePublic {
  return {
    ...signedQuote(internal),
    state: "sent",
    status: "sent",
    acceptedAt: undefined,
    acceptedName: undefined,
  } as QuotePublic;
}

function render(node: preact.JSX.Element) {
  return new DOMParser().parseFromString(
    `<html><body>${renderToString(node)}</body></html>`,
    "text/html",
  )!;
}

Deno.test("REQ-687 (demo m59, cycle 5): ownerSignedView is the business viewing its own signed quote without the in-person override", () => {
  assertEquals(ownerSignedView(signedQuote(true), ""), true);
  assertEquals(ownerSignedView(signedQuote(false), ""), false, "customer");
  assertEquals(
    ownerSignedView(signedQuote(true), "?as=customer&confirm=1"),
    false,
    "in-person override: the customer holds the device",
  );
  assertEquals(ownerSignedView(openQuote(true), ""), false, "not signed");
});

Deno.test("REQ-687 (demo m59, cycle 5): ownerSignedNext points at the open invoice in Invoices, else the quote in Quotes", () => {
  assertEquals(ownerSignedNext(signedQuote(true, OPEN_INVOICE)), {
    kind: "invoice",
    href: "/invoices?open=inv-1",
    number: "INV-001",
    balanceCents: 72500,
  });
  assertEquals(ownerSignedNext(signedQuote(true)), {
    kind: "quote",
    href: "/quotes?open=q-687",
  });
});

Deno.test("REQ-687 (demo p14, cycle 5): public-contract.css reserves the sticky strip's height above every section of a previewing document", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/public-contract.css", import.meta.url),
  );
  const m = css.match(
    /\.ctr--previewing\s+section\s*\{[^}]*scroll-margin-top:\s*(\d+)px/,
  );
  assert(m, "a .ctr--previewing section { scroll-margin-top } rule");
  assert(Number(m[1]) >= 56, `at least the strip's height: ${m[1]}px`);
});

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-687 (demo m59, cycle 5) [${lang}]: the owner's signed quote says who signed and that it is the customer's copy — never "Thanks" or "your contractor"`, () => {
    for (const invoices of [OPEN_INVOICE ?? [], []]) {
      const doc = render(
        <QuoteDoc
          quote={signedQuote(true, invoices)}
          lang={lang}
          search=""
        />,
      );
      const banner = doc.querySelector("[data-cy='quote-signed-banner']");
      assert(banner, "the signed banner renders");
      assertEquals(banner.getAttribute("data-viewer"), "owner");
      const text = banner.textContent ?? "";
      assert(text.includes("Linda Park"), `names the signer: ${text}`);
      const thanks = tFor(lang, "quoteDoc.signedBanner.thanks", {
        name: "Linda Park",
        date: "",
      }).split("—")[0].trim();
      assertEquals(text.includes(thanks), false, `no "${thanks}": ${text}`);
      assertEquals(
        text.includes(tFor(lang, "quoteDoc.signedBanner.nextNoInvoice")),
        false,
        `no "your contractor will be in touch": ${text}`,
      );
      assert(
        text.includes(
          tFor(lang, "quoteDoc.signedBanner.ownerCopy").trim(),
        ),
        `says it is the customer's copy: ${text}`,
      );
      assertEquals(
        doc.querySelector("[data-cy='quote-signed-banner-pay']"),
        null,
        "no customer 'pay the … due' link",
      );
      const next = banner.querySelector(
        "[data-cy='quote-signed-banner-owner-next']",
      );
      assert(next, "an owner next step");
      assertEquals(
        next.getAttribute("href"),
        invoices.length ? "/invoices?open=inv-1" : "/quotes?open=q-687",
      );
    }
  });

  Deno.test(`REQ-687 (demo m59, cycle 5) [${lang}]: the customer and the in-person override keep the thank-you`, () => {
    for (
      const [q, search] of [
        [signedQuote(false, OPEN_INVOICE), ""],
        [signedQuote(true, OPEN_INVOICE), "?as=customer&confirm=1"],
      ] as const
    ) {
      const doc = render(<QuoteDoc quote={q} lang={lang} search={search} />);
      const banner = doc.querySelector("[data-cy='quote-signed-banner']");
      assert(banner, "the signed banner renders");
      assertEquals(banner.getAttribute("data-viewer"), "customer");
      assert(
        doc.querySelector("[data-cy='quote-signed-banner-pay']"),
        "the customer's pay link stays",
      );
      assertEquals(
        doc.querySelector("[data-cy='quote-signed-banner-owner-next']"),
        null,
      );
    }
  });

  Deno.test(`REQ-687 (demo p14, cycle 5) [${lang}]: the preview's sections reserve room for the sticky strip, and the strip starts expanded`, () => {
    const doc = render(
      <QuoteDoc quote={openQuote(true)} lang={lang} search="" />,
    );
    const banner = doc.querySelector("[data-cy='quote-preview-banner']");
    assert(banner, "the preview banner renders");
    assertEquals(banner.getAttribute("data-compact"), "false");
    assert(
      doc.querySelector("[data-cy='quote-preview-sentinel']"),
      "a sentinel above the banner drives the collapse",
    );
    const article = doc.querySelector("article.ctr");
    assert(article, "the document renders");
    assert(
      (article.getAttribute("class") ?? "").split(/\s+/).includes(
        "ctr--previewing",
      ),
      `the previewing document is marked: ${article.getAttribute("class")}`,
    );
    assert(
      article.querySelectorAll("section").length >= 3,
      "its sections render",
    );
    // the customer's own view is not marked
    const cust = render(
      <QuoteDoc quote={openQuote(false)} lang={lang} search="" />,
    );
    assertEquals(
      (cust.querySelector("article.ctr")?.getAttribute("class") ?? "")
        .includes("ctr--previewing"),
      false,
    );
  });

  Deno.test(`REQ-687 (cycle 5) [${lang}]: en and es carry the owner signed-banner keys`, () => {
    for (
      const k of [
        "quoteDoc.signedBanner.owner",
        "quoteDoc.signedBanner.ownerCopy",
        "quoteDoc.signedBanner.ownerNextInvoice",
        "quoteDoc.signedBanner.ownerNextQuote",
        "public.doc.previewBanner.compact",
      ]
    ) {
      const v = tFor(lang, k, {
        name: "X",
        date: "Y",
        amount: "Z",
        number: "N",
      });
      assert(v && v !== k, `${lang} ${k}`);
    }
  });
}
