/**
 * REQ-408 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 2, issue p13-a: with nothing in transit the /payments KPI
 * strip still painted the "in transit" cell in the pink accent (gradient +
 * brand-pink value), so "$0 · 0 en camino" read like an alert. The accent is
 * for money actually on its way; at zero the cell is a plain cell reading "—"
 * and "Nothing in transit".
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PaymentsKpis from "../components/PaymentsKpis.tsx";
import type { Lang } from "./i18n.ts";

function transitCell(
  lang: Lang,
  transitCount: number,
  transitTotal: number,
): Element {
  const html = renderToString(
    <PaymentsKpis
      lang={lang}
      landedCount={0}
      monthTotal={0}
      transitCount={transitCount}
      transitTotal={transitTotal}
      attentionCount={0}
      attentionTotal={0}
      avgDays={0}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const cell = doc.querySelector('[data-cy="payments-kpi-transit"]');
  assert(cell, "the in-transit cell is rendered");
  return cell as Element;
}

Deno.test("REQ-408 p13-a: nothing in transit is a plain cell, not the pink alert accent", () => {
  for (const lang of ["en", "es"] as Lang[]) {
    const cell = transitCell(lang, 0, 0);
    assert(
      !cell.className.split(/\s+/).includes("qkpi__cell--accent"),
      `${lang}: the zero cell carries no accent: ${cell.className}`,
    );
    assertEquals(cell.querySelector(".qkpi__val")?.textContent, "—");
  }
  assertEquals(
    transitCell("en", 0, 0).querySelector(".qkpi__sub")?.textContent,
    "Nothing in transit",
  );
  assertEquals(
    transitCell("es", 0, 0).querySelector(".qkpi__sub")?.textContent,
    "Nada en camino",
  );
});

Deno.test("REQ-408 p13-a: money on its way keeps the accent, amount and count", () => {
  const cell = transitCell("es", 2, 125_000);
  assert(cell.className.split(/\s+/).includes("qkpi__cell--accent"));
  assertEquals(cell.querySelector(".qkpi__val")?.textContent, "$1,250");
  assertEquals(cell.querySelector(".qkpi__sub")?.textContent, "2 en camino");
});
