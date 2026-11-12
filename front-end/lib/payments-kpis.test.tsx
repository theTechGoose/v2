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

/**
 * REQ-562 — demo-loop cycle 4, m21: a deposit paid the day it was issued is
 * 0 days to pay, and the KPI read "—" / "no paid history yet". A landed
 * payment IS history: zero days reads "0d" and "paid the same day".
 * `avgDays` null means no history.
 */
function avgCell(lang: Lang, avgDays: number | null): Element {
  const html = renderToString(
    <PaymentsKpis
      lang={lang}
      landedCount={1}
      monthTotal={1_425_00}
      transitCount={0}
      transitTotal={0}
      attentionCount={0}
      attentionTotal={0}
      avgDays={avgDays}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const cell = doc.querySelector('[data-cy="payments-kpi-avg"]');
  assert(cell, "the avg-days cell is rendered");
  return cell as Element;
}

Deno.test("REQ-562 (cycle 4, m21) a same-day payment is 0 days, not 'no paid history yet'", () => {
  const en = avgCell("en", 0);
  assertEquals(en.querySelector(".qkpi__val")?.textContent, "0d");
  assertEquals(
    en.querySelector(".qkpi__sub")?.textContent,
    "paid the same day",
  );
  const es = avgCell("es", 0);
  assertEquals(es.querySelector(".qkpi__val")?.textContent, "0d");
  assertEquals(
    es.querySelector(".qkpi__sub")?.textContent,
    "pagado el mismo día",
  );
});

Deno.test("REQ-562 (cycle 4, m21) no landed payment is no history; 3 days is 3d across landed payments", () => {
  const none = avgCell("en", null);
  assertEquals(none.querySelector(".qkpi__val")?.textContent, "—");
  assertEquals(
    none.querySelector(".qkpi__sub")?.textContent,
    "no paid history yet",
  );
  const three = avgCell("en", 3);
  assertEquals(three.querySelector(".qkpi__val")?.textContent, "3d");
  assertEquals(
    three.querySelector(".qkpi__sub")?.textContent,
    "across landed payments",
  );
});
