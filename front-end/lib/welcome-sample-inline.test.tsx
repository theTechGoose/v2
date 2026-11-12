/**
 * REQ-433 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue M13: onboarding step 10 "See what your
 * customer sees" was a blank grey box on the demo stage.
 *
 * The step embedded the sample as <iframe src="/q/<id>">, and the stage
 * mirror never carries an embedded page (REQ-242: the recorder drops an
 * iframe's src, the replayer refuses it, the stage CSP is frame-src 'none').
 * The sample is now rendered inline — the same QuoteDoc the public /q page
 * paints, in a scaled container — so the mirror carries it as plain DOM.
 * The browser proof is e2e/welcome-sample-inline.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import type { QuotePublic } from "../components/quote-doc.tsx";
import { SampleQuoteDoc } from "../components/SampleQuotePreview.tsx";

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

function sample(): QuotePublic {
  return {
    id: "q-433",
    isSample: true,
    internal: true,
    status: "draft",
    contractor: { name: "Rosa Rivera", businessName: "Rivera Roofing" },
    jobName: "Roof Shingle Replacement",
    jobNameByLang: {
      en: "Roof Shingle Replacement",
      es: "Reemplazo de tejas del techo",
    },
    summary: "Replace the shingles",
    estimatedTotal: 480000,
    lineItems: [],
    terms: [],
  } as QuotePublic;
}

Deno.test("REQ-433 SampleQuoteDoc renders the sample quote inline — its job name, no iframe", () => {
  const html = renderToString(<SampleQuoteDoc quote={sample()} lang="en" />);
  assert(
    html.includes("Roof Shingle Replacement"),
    "the job name is in the DOM",
  );
  assert(!/<iframe/i.test(html), "no iframe");
  assert(
    html.includes('data-cy="welcome-sample-doc"'),
    "the scaled container is marked",
  );
});

Deno.test("REQ-433 SampleQuoteDoc follows the wizard's language", () => {
  const html = renderToString(<SampleQuoteDoc quote={sample()} lang="es" />);
  assert(html.includes("Reemplazo de tejas del techo"));
  assert(!html.includes("Roof Shingle Replacement"));
});

Deno.test("REQ-433 the wizard's sample step embeds no page — it renders SampleQuotePreview and keeps the open-full-size link", () => {
  const wizard = src("../islands/WelcomeWizard.tsx");
  assertEquals(
    /<iframe\b/.test(wizard),
    false,
    "WelcomeWizard renders no <iframe>",
  );
  assert(
    wizard.includes("<SampleQuotePreview"),
    "the step renders SampleQuotePreview",
  );
  assert(
    wizard.includes('t("welcome.sample.openFull")'),
    "the open-full-size link stays",
  );
});
