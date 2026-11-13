/**
 * REQ-614 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue m16: "Onboarding sample quote sits in the
 * pipeline with 'Finish + send'".
 *
 * RCA (cycle 4, m16): QuoteCard's front CTA was chosen from the stage alone —
 * `q.stage === "draft"` → "Finish + send" — and the onboarding sample is an
 * unnumbered draft (REQ-256) kept in the Drafting track (REQ-360), so it
 * offered to send a quote that has no customer. The sample's CTA is now
 * "View sample →", a link to the customer view (/q/<id>), never the send flow.
 *
 * Renders the real island server-side and checks the HTML.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import QuoteCard from "../islands/QuoteCard.tsx";
import type { Quote } from "./quotes-seed.ts";
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

function quote(over: Partial<Quote> = {}): Quote {
  return {
    id: "q-1",
    title: "Junk Removal & Haul-Away",
    client: "Sample customer",
    initials: "SC",
    stage: "draft",
    value: 370000,
    daysIn: 0,
    opens: 0,
    sentDays: 0,
    band: ["#FFB3B3", "#FF6B6B"],
    shadow: "rgba(255,107,107,0.35)",
    ...over,
  };
}

function render(q: Quote, lang: "en" | "es") {
  const html = renderToString(
    <QuoteCard q={q} idx={0} lang={lang} onOpen={() => {}} />,
  );
  return new DOMParser().parseFromString(html, "text/html");
}

Deno.test("REQ-614 (m16) the sample card's front CTA is 'View sample', never 'Finish + send'", () => {
  for (const [lang, dict] of [["en", EN], ["es", ES]] as const) {
    const doc = render(quote({ isSample: true }), lang);
    const cta = doc.querySelector('[data-cy="qcard-cta"]');
    assert(cta, `a front CTA on the sample card (${lang})`);
    const text = cta.textContent.replace(/\s+/g, " ").trim();
    assert(
      !text.includes(dict["quoteCard.cta.finishSend"]),
      `no "${
        dict["quoteCard.cta.finishSend"]
      }" on the sample (${lang}): ${text}`,
    );
    assert(
      dict["quoteCard.cta.viewSample"],
      `quoteCard.cta.viewSample has ${lang} copy`,
    );
    assert(
      text.startsWith(dict["quoteCard.cta.viewSample"]),
      `the sample CTA reads "${
        dict["quoteCard.cta.viewSample"]
      }" (${lang}): ${text}`,
    );
  }
});

Deno.test("REQ-614 (m16) the sample CTA opens the customer view /q/<id> in a new tab", () => {
  const doc = render(quote({ id: "sample-123", isSample: true }), "en");
  const cta = doc.querySelector('[data-cy="qcard-cta"]');
  assert(cta, "a front CTA on the sample card");
  assertEquals(cta.tagName.toLowerCase(), "a", "the sample CTA is a link");
  assertEquals(cta.getAttribute("href"), "/q/sample-123");
  assertEquals(cta.getAttribute("target"), "_blank");
});

Deno.test("REQ-614 (m16) no send wording anywhere on the sample card", () => {
  const doc = render(quote({ isSample: true }), "en");
  const all = doc.querySelector(".qcard")!.textContent;
  for (
    const k of [
      "quoteCard.cta.finishSend",
      "quoteCard.back.resend",
      "quoteCard.back.copyLink",
    ]
  ) {
    if (!EN[k]) continue;
    assert(!all.includes(EN[k]), `no "${EN[k]}" on the sample card`);
  }
});

Deno.test("REQ-614 (m16) a real draft still offers 'Finish + send' (opens the panel)", () => {
  const doc = render(quote({ client: "Ana Torres" }), "en");
  const cta = doc.querySelector('[data-cy="qcard-cta"]');
  assert(cta);
  assertEquals(cta.tagName.toLowerCase(), "button");
  assert(cta.textContent.includes(EN["quoteCard.cta.finishSend"]));
});
