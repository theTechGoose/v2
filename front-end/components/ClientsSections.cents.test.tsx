/**
 * REQ-1086 (LOOP-007 cycle 3, issue q3-9) — Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it green."
 *
 * q3-9: the /customers hero lede formats the owed total with its own
 * `toLocaleString("en-US", { maximumFractionDigits: 0 })`, so $2,562.75 owed
 * reads "$2,563 currently owed to you" while the board card and the sidebar on
 * the same screen read "$2,562.75". REQ-961 / REQ-1072: a customer-money total
 * reads to the cent — whole dollars only when the total is whole
 * (fmtMoneyTotal).
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { ClientsHero } from "./ClientsSections.tsx";
import type { Lang } from "../lib/i18n.ts";

const SRC = new URL("./ClientsSections.tsx", import.meta.url);

/** The hero's owed amount: the <strong> right before the clientsHero.owed copy. */
function heroOwed(owedTotal: number, lang: Lang): string {
  // Both shapes of the owed prop: today's dollars (`owedTotal`) and the cents
  // the fix may pass through instead (`owedCents`) — the test pins the output.
  const props = {
    totalClients: 3,
    activeJobs: 2,
    owedTotal,
    owedCents: Math.round(owedTotal * 100),
    quietCount: 0,
    lang,
  } as unknown as Parameters<typeof ClientsHero>[0];
  const html = renderToString(<ClientsHero {...props} />);
  const sub = html.match(/<p class="ph2__sub">([\s\S]*?)<\/p>/)?.[1] ?? "";
  const strongs = [...sub.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) =>
    m[1].replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "").trim()
  );
  const money = strongs.find((s) => s.includes("$"));
  assert(money, `no $ amount in the hero lede: ${sub}`);
  return money;
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1086 (LOOP-007 q3, q3-9): the /customers hero reads $2,562.75 owed to the cent, never $2,563 (${lang})`, () => {
    const got = heroOwed(2562.75, lang);
    assertEquals(
      got,
      "$2,562.75",
      `the hero rounds money owed to whole dollars (${lang}): got "${got}"`,
    );
  });

  Deno.test(`REQ-1086 (LOOP-007 q3, q3-9): the hero keeps cents for $1,935.15 and $600.25 (${lang})`, () => {
    assertEquals(heroOwed(1935.15, lang), "$1,935.15");
    assertEquals(heroOwed(600.25, lang), "$600.25");
  });

  Deno.test(`REQ-1086 (LOOP-007 q3, q3-9): a whole-dollar total stays compact — $2,400 (${lang})`, () => {
    assertEquals(heroOwed(2400, lang), "$2,400");
  });
}

Deno.test("REQ-1086 (LOOP-007 q3, q3-9): ClientsSections.tsx never forces maximumFractionDigits 0 on money", async () => {
  const src = await Deno.readTextFile(SRC);
  assert(
    !/maximumFractionDigits:\s*0/.test(src),
    "ClientsSections.tsx still rounds money with maximumFractionDigits: 0",
  );
});
