/**
 * REQ-957 — Raphael: "test every single aspect of this application … one Opus agent per issue to
 * do root cause analysis, then one to write the test, then one to fix it and make it green."
 * LOOP-007 cycle 1, issue q1-32: the dashboard said "MONEY OWED TO YOU $0" right next to
 * "$4,650 1 open invoice".
 *
 * owedCents is overdue + open, so the data always agrees with the tiles; the headline is drawn
 * through <Ticker>, which starts at useState(0) and climbs over 1400 ms on rAF ticks. The server
 * render and the first paint say $0, and while the lists load (`pending`) the headline is a real
 * $0 built from empty lists. A count-up from 0 must never stand in for the number.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { MoneyBar } from "./MoneyBar.tsx";
import { buildMoneyBar } from "../../shared/receivables/money-bar.ts";

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;

const NOW = new Date("2026-11-18T15:00:00Z");

/** INV-001: $4,650, sent, due Nov 25 — open, not yet overdue (the tester's dashboard). */
const data = buildMoneyBar({
  quotes: [],
  jobs: [],
  invoices: [{
    id: "inv-1",
    status: "sent",
    amount: 465_000,
    dueDate: "2026-11-25",
    customerId: "c1",
    number: "INV-001",
    updatedAt: "",
  }],
  customerNames: new Map([["c1", "Maria"]]),
  now: NOW,
});

Deno.test("REQ-957 q1-32: the money-owed headline renders the real amount, equal to the open tile", () => {
  assertEquals(data.owedCents, 465_000, "precondition: owed = open = $4,650");
  const doc = parse(renderToString(<MoneyBar data={data} now={NOW} />));
  const owed = doc.querySelector('[data-cy="money-owed"]')!.textContent.trim();
  const open = doc.querySelector(
    '[data-cy="money-col"][data-bucket="open"] .moneybar__col-amt',
  )!.textContent.trim();
  assertEquals(open, "$4,650");
  assertEquals(
    owed,
    open,
    `headline "${owed}" must match the open tile "${open}"`,
  );
});

Deno.test("REQ-957 q1-32: while the lists are pending the headline is a skeleton, never $0", () => {
  const empty = buildMoneyBar({
    quotes: [],
    jobs: [],
    invoices: [],
    customerNames: new Map(),
    now: NOW,
  });
  const doc = parse(
    renderToString(<MoneyBar data={empty} now={NOW} pending />),
  );
  const head = doc.querySelector('[data-cy="money-owed"]');
  const text = head?.textContent.trim() ?? "";
  assert(
    !/\$\s*0\b/.test(text),
    `pending headline must not read "$0" (got "${text}")`,
  );
  const headWrap = doc.querySelector(".moneybar__head")!;
  assert(
    [...headWrap.querySelectorAll("[style]")].some((el) =>
      (el.getAttribute("style") ?? "").includes("pmShimmer")
    ),
    `pending headline shows a skeleton (got ${headWrap.innerHTML})`,
  );
});
