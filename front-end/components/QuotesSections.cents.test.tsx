/**
 * REQ-1085 (LOOP-007 cycle 3, issue q3-10; extends REQ-961 to /quotes) —
 * Raphael: "test every single aspect of this application … one Opus agent per
 * issue to do root cause analysis, then one to write the test, then one to fix
 * it and make it green."
 *
 * q3-10: a quote of $6,450.50 (and Q-001's $7,600.50 with its approved change
 * order) reads to the cent on /q, the agreement, the PDF and the detail panel,
 * but the /quotes "Decided this month" row printed "$6,451" / "$7,601": the
 * row, the "Biggest open quotes" side card and the open quote card format ONE
 * quote's total with the no-cents KPI formatter fmtMoney.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { DecidedRow, QSideBig } from "./QuotesSections.tsx";
import QuoteCard from "../islands/QuoteCard.tsx";
import type { Quote } from "../lib/quotes-seed.ts";

const CENTS = 512_550; // $5,125.50
const EXACT = "$5,125.50";
const ROUNDED = /\$5,126(?![\d.])/;

function quote(over: Partial<Quote> = {}): Quote {
  return {
    id: "q-q310",
    title: "Deck rebuild",
    client: "Ann Lee",
    initials: "AL",
    stage: "won",
    value: CENTS,
    daysIn: 3,
    opens: 1,
    sentDays: 3,
    decidedDays: 2,
    band: ["#000", "#111"],
    shadow: "none",
    number: "Q-001",
    version: 1,
    ...over,
  } as Quote;
}

const amounts = (html: string) => html.match(/\$[\d,.]+/g)?.join(" ") ?? "";

function assertExact(where: string, html: string) {
  assert(
    html.includes(EXACT),
    `${where} shows the quote to the cent (${EXACT}) — got: ${amounts(html)}`,
  );
  assertEquals(
    html.match(ROUNDED) ?? [],
    [],
    `${where} never rounds ${EXACT} to $5,126`,
  );
}

Deno.test("REQ-1085 q3-10: the /quotes 'Decided this month' row shows a won quote's total to the cent ($5,125.50, never $5,126)", () => {
  assertExact(
    "the Decided row (.qdone__amt)",
    renderToString(<DecidedRow q={quote()} lang="en" />),
  );
});

Deno.test("REQ-1085 q3-10: a lost quote's Decided row also keeps its cents", () => {
  assertExact(
    "the lost Decided row",
    renderToString(<DecidedRow q={quote({ stage: "lost" })} lang="en" />),
  );
});

Deno.test("REQ-1085 q3-10: the 'Biggest open quotes' side card (qbig__amt) shows one quote's value to the cent", () => {
  assertExact(
    "QSideBig's qbig__amt",
    renderToString(
      <QSideBig open={[quote({ stage: "sent", decidedDays: undefined })]} />,
    ),
  );
});

Deno.test("REQ-1085 q3-10: the open quote card (qcard__val-num) shows the quote's value to the cent", () => {
  assertExact(
    "QuoteCard's qcard__val-num",
    renderToString(
      <QuoteCard
        q={quote({ stage: "sent", decidedDays: undefined })}
        idx={0}
        lang="en"
      />,
    ),
  );
});
