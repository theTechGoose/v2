/**
 * REQ-961 (LOOP-007 cycle 1, issue q1-35) — Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it green."
 *
 * q1-35: an invoice of $2,489.75 reads "$2,489.75" everywhere the customer
 * looks, but the owner's dashboard money bar printed "$2,490": the headline fed
 * `Math.round(owedCents / 100)` to its Ticker and the bucket columns, segment
 * labels and per-invoice rows went through the no-cents KPI formatter
 * `fmtMoney`. A single document's amount, and the totals read against it, are
 * shown to the cent.
 */
import { assert, assertEquals } from "@std/assert";
import { options, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { MoneyBar } from "./MoneyBar.tsx";
import Ticker from "../islands/Ticker.tsx";
import type { MoneyBarData } from "../../shared/receivables/money-bar.ts";

const CENTS = 248_975; // $2,400 − $100 + 8.25% tax

const data: MoneyBarData = {
  owedCents: CENTS,
  totalCents: CENTS,
  buckets: [
    { key: "estimates", cents: 0, count: 0, items: [] },
    { key: "unbilled", cents: 0, count: 0, items: [] },
    { key: "overdue", cents: 0, count: 0, items: [] },
    {
      key: "open",
      cents: CENTS,
      count: 1,
      items: [{
        id: "inv-q135",
        kind: "invoice",
        title: "Ann Lee",
        job: "Deck",
        number: "INV-001",
        cents: CENTS,
        url: "/invoices?open=inv-q135",
        dueDate: "2026-12-01",
      }],
    },
    { key: "paid", cents: 0, count: 0, items: [] },
  ],
};

/** render, and capture the props every Ticker was given */
function render(): { html: string; tickers: Record<string, unknown>[] } {
  const tickers: Record<string, unknown>[] = [];
  const prev = options.vnode;
  options.vnode = (v: VNode) => {
    if (v.type === Ticker) tickers.push({ ...(v.props as object) });
    prev?.(v);
  };
  try {
    const html = renderToString(
      <MoneyBar data={data} lang="en" now={new Date("2026-11-18T12:00:00Z")} />,
    );
    return { html, tickers };
  } finally {
    options.vnode = prev;
  }
}

Deno.test("REQ-961 q1-35: the money bar's open bucket, its segment and the invoice's row read $2,489.75, never $2,490", () => {
  const { html } = render();
  assert(
    html.includes("$2,489.75"),
    `the money bar shows the invoice to the cent ($2,489.75) — got: ${
      html.match(/\$[\d,.]+/g)?.join(" ")
    }`,
  );
  assertEquals(
    html.match(/\$2,490(?![\d.])/g) ?? [],
    [],
    "no money-bar figure rounds $2,489.75 up to $2,490",
  );
});

Deno.test("REQ-961 q1-35: the money bar's 'Money owed to you' headline is not fed a whole-dollar 2490", () => {
  const { tickers } = render();
  assertEquals(tickers.length, 1, "the headline renders one Ticker");
  const v = tickers[0].value as number;
  assert(
    v !== Math.round(CENTS / 100),
    `the headline Ticker gets the exact owed amount (2489.75 dollars or 248975 cents), not Math.round(owedCents/100) = ${v}`,
  );
  assert(
    v === CENTS || v === CENTS / 100,
    `the headline Ticker value carries the cents — got ${v}`,
  );
});
