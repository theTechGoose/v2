/**
 * REQ-1045 — LOOP-007 cycle 2, q2-29 [BUG_CONTRADICTION]: an unsent draft
 * quote's card offered "Reenviar" (Resend) on its back while the same card's
 * reading line says "Aún sin enviar — termina de escribirlo…". The back's
 * Resend was gated only on `!q.isSample`, never on the stage, so on a draft
 * it would send the unfinished quote (email + text) skipping the preview.
 *
 * Renders the real QuoteCard island server side, flipped to its back face.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import QuoteCard from "../islands/QuoteCard.tsx";
import type { Quote } from "./quotes-seed.ts";

const dict = async (l: "en" | "es") =>
  JSON.parse(
    await Deno.readTextFile(new URL(`../../lang/${l}.json`, import.meta.url)),
  ) as Record<string, string>;
const en = await dict("en");
const es = await dict("es");

const base: Quote = {
  id: "q1",
  title: "Spring cleanup",
  client: "Ana Torres",
  initials: "AT",
  stage: "sent",
  value: 45000,
  daysIn: 0,
  opens: 0,
  sentDays: 0,
  band: ["#FFB3B3", "#FF6B6B"],
  shadow: "rgba(255,107,107,0.35)",
};

function back(q: Quote, lang: "en" | "es") {
  const html = renderToString(
    <QuoteCard q={q} idx={0} lang={lang} flipOnMount onOpen={() => {}} />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const foot = doc.querySelector(".qcard__back-foot");
  assert(foot, "the card renders its back face");
  return {
    labels: [...foot.querySelectorAll("button, a")].map((el) =>
      el.textContent.trim()
    ),
    resendBtn: foot.querySelector("[data-cy='qcard-resend']"),
    text: doc.body?.textContent ?? "",
  };
}

const draft: Quote = { ...base, stage: "draft", sentDays: null };

for (const [lang, d] of [["en", en], ["es", es]] as const) {
  Deno.test(`REQ-1045 q2-29 (${lang}): a draft quote's back offers no Resend — it was never sent`, () => {
    const b = back(draft, lang);
    // the card itself says it was never sent …
    assert(
      b.text.includes(d["quotesSeed.reading.draft.text"].trim()),
      `the draft card reads "${d["quotesSeed.reading.draft.text"]}"`,
    );
    // … so it must not offer to send it "again"
    assertEquals(
      b.labels.includes(d["quoteCard.back.resend"]),
      false,
      `draft back actions: ${b.labels.join(" | ")}`,
    );
    assertEquals(b.resendBtn, null, "no [data-cy=qcard-resend] on a draft");
    // Open quote still works on a draft
    assert(b.labels.includes(d["quoteCard.back.open"]), b.labels.join(" | "));
  });

  for (const stage of ["sent", "undelivered"] as const) {
    Deno.test(`REQ-1045 q2-29 (${lang}): a ${stage} quote keeps its Resend`, () => {
      const b = back({ ...base, stage }, lang);
      assert(
        b.labels.includes(d["quoteCard.back.resend"]),
        `${stage} back actions: ${b.labels.join(" | ")}`,
      );
    });
  }
}
