/**
 * REQ-360 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issue m11: the onboarding sample's card offered
 * "Resend" (and "Copy link") for a quote that was never sent, and the Resend
 * button did nothing on any card (its onClick only stopped propagation).
 *
 * Renders the real QuoteCard island (server side, flipped to its back face)
 * for the sample and for a real sent quote.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import QuoteCard from "../islands/QuoteCard.tsx";
import type { Quote } from "./quotes-seed.ts";

const en = JSON.parse(
  await Deno.readTextFile(new URL("../../lang/en.json", import.meta.url)),
) as Record<string, string>;

const base: Quote = {
  id: "q1",
  title: "Roof Leak Repair",
  client: "Tom Reyes",
  initials: "TR",
  stage: "sent",
  value: 120000,
  daysIn: 0,
  opens: 0,
  sentDays: 0,
  band: ["#FFB3B3", "#FF6B6B"],
  shadow: "rgba(255,107,107,0.35)",
};

function backButtons(q: Quote): string[] {
  const html = renderToString(
    <QuoteCard q={q} idx={0} lang="en" flipOnMount onOpen={() => {}} />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const foot = doc.querySelector(".qcard__back-foot");
  assert(foot, "the card renders its back face");
  return [...foot.querySelectorAll("button, a")].map((el) =>
    el.textContent.trim()
  );
}

Deno.test("REQ-360 m11: the sample card's back offers no Resend and no Copy link", () => {
  const labels = backButtons({
    ...base,
    id: "s1",
    stage: "draft",
    sentDays: null,
    isSample: true,
    client: "Sample customer",
  });
  assertEquals(labels.includes(en["quoteCard.back.resend"]), false);
  assertEquals(labels.includes(en["quoteCard.back.copyLink"]), false);
  // it still opens and still shows what the customer would see
  assert(labels.includes(en["quoteCard.back.open"]), labels.join(" | "));
  assert(
    labels.includes(en["quoteCard.back.viewAsClient"]),
    labels.join(" | "),
  );
});

Deno.test("REQ-360 m11: no card carries a dead Resend button; a real card keeps Copy link", () => {
  const labels = backButtons(base);
  assertEquals(labels.includes(en["quoteCard.back.resend"]), false);
  assert(labels.includes(en["quoteCard.back.copyLink"]), labels.join(" | "));
  assert(labels.includes(en["quoteCard.back.open"]), labels.join(" | "));
});
