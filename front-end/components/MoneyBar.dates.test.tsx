/**
 * REQ-1039 — Raphael: "test every single aspect of this application … one Opus agent per issue to
 * do root cause analysis, then one to write the test, then one to fix it and make it green."
 * LOOP-007 cycle 2, issue q2-23: the Spanish dashboard's money bar read "Vence dic 4 · INV-001"
 * (every other screen says "4 dic"), printed paid/sent days in the browser's zone instead of the
 * business's (REQ-944), counted days-until-due from the browser's midnight, and glued the client to
 * the job ("Rosa Delgado· Instalación").
 *
 * The business-zone checks use pairs of instants that land on different days in two zones, so they
 * fail under ANY process TZ while the browser's zone is used (one of each pair always disagrees).
 * MoneyBar's new `timeZone` prop is what the fix adds; the cast keeps this file type-checking now.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import type { ComponentChild } from "preact";
import { MoneyBar } from "./MoneyBar.tsx";
import {
  buildMoneyBar,
  type MoneyBarData,
} from "../../shared/receivables/money-bar.ts";

type Props = Parameters<typeof MoneyBar>[0] & { timeZone?: string };
const Bar = MoneyBar as unknown as (p: Props) => ComponentChild;

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;

function rows(props: Props, bucket: string) {
  const doc = parse(renderToString(<Bar {...props} />));
  const list = doc.querySelector('[data-cy="money-list"]')!;
  assertEquals(
    list.getAttribute("data-bucket"),
    bucket,
    `precondition: the ${bucket} bucket is the one listed`,
  );
  return [...doc.querySelectorAll('[data-cy="money-row"]')].map((r) => ({
    client: r.querySelector(".moneybar__row-client")!.textContent,
    meta: r.querySelector(".moneybar__row-meta")!.textContent.trim(),
  }));
}

function openData(dueDate: string, now: Date): MoneyBarData {
  return buildMoneyBar({
    quotes: [],
    jobs: [],
    invoices: [{
      id: "inv-1",
      status: "sent",
      amount: 120_000,
      dueDate,
      customerId: "c1",
      number: "INV-001",
      jobName: "Instalación de azulejo en baño",
      updatedAt: "",
    }],
    customerNames: new Map([["c1", "Rosa Delgado"]]),
    now,
  });
}

function paidData(paidAt: string, now: Date): MoneyBarData {
  return buildMoneyBar(
    {
      quotes: [],
      jobs: [],
      invoices: [{
        id: "inv-2",
        status: "paid",
        amount: 80_000,
        paidCents: 80_000,
        dueDate: "2026-11-30",
        paidAt,
        customerId: "c1",
        number: "INV-002",
        updatedAt: paidAt,
      }],
      customerNames: new Map([["c1", "Rosa Delgado"]]),
      now,
    } as Parameters<typeof buildMoneyBar>[0],
  );
}

Deno.test("REQ-1039 q2-23: the Spanish open row reads 'Vence 4 dic · INV-001', day before month", () => {
  const now = new Date("2026-11-19T15:00:00Z");
  const [row] = rows(
    {
      data: openData("2026-12-04", now),
      lang: "es",
      now,
      timeZone: "America/New_York",
    },
    "open",
  );
  assertEquals(row.meta, "Vence 4 dic · INV-001");
  assert(!row.meta.includes("dic 4"), `month-first date in "${row.meta}"`);
});

Deno.test("REQ-1039 q2-23: the English open row stays 'Due Dec 4 · INV-001'", () => {
  const now = new Date("2026-11-19T15:00:00Z");
  const [row] = rows(
    {
      data: openData("2026-12-04", now),
      lang: "en",
      now,
      timeZone: "America/New_York",
    },
    "open",
  );
  assertEquals(row.meta, "Due Dec 4 · INV-001");
});

Deno.test("REQ-1039 q2-23: a paid row prints the paid instant's day in the business zone (REQ-944), not the browser's", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  // 03:30Z Nov 19 = 10:30 PM Nov 18 in New York
  const ny = rows(
    {
      data: paidData("2026-11-19T03:30:00Z", now),
      lang: "es",
      now,
      timeZone: "America/New_York",
    },
    "paid",
  );
  assert(
    ny[0].meta.startsWith("Cobrada 18 nov · INV-002"),
    `New York business, paid 10:30 PM Nov 18: got "${ny[0].meta}"`,
  );
  // 20:00Z Nov 18 = 5:00 AM Nov 19 in Tokyo
  const tokyo = rows(
    {
      data: paidData("2026-11-18T20:00:00Z", now),
      lang: "es",
      now,
      timeZone: "Asia/Tokyo",
    },
    "paid",
  );
  assert(
    tokyo[0].meta.startsWith("Cobrada 19 nov · INV-002"),
    `Tokyo business, paid 5:00 AM Nov 19: got "${tokyo[0].meta}"`,
  );
});

Deno.test("REQ-1039 q2-23: days-until-due counts from today in the business zone, not the browser's midnight", () => {
  // 03:30Z Nov 19 is still Nov 18 in New York: Nov 23 is 5 days out
  const nyNow = new Date("2026-11-19T03:30:00Z");
  const [ny] = rows(
    {
      data: openData("2026-11-23", nyNow),
      lang: "es",
      now: nyNow,
      timeZone: "America/New_York",
    },
    "open",
  );
  assertEquals(ny.meta, "Vence en 5 días · INV-001", "New York business");
  // 20:00Z Nov 18 is already Nov 19 in Tokyo: Nov 23 is 4 days out
  const tkNow = new Date("2026-11-18T20:00:00Z");
  const [tk] = rows(
    {
      data: openData("2026-11-23", tkNow),
      lang: "es",
      now: tkNow,
      timeZone: "Asia/Tokyo",
    },
    "open",
  );
  assertEquals(tk.meta, "Vence en 4 días · INV-001", "Tokyo business");
});

Deno.test("REQ-1039 q2-23: the row's text keeps a space between the client and the job", () => {
  const now = new Date("2026-11-19T15:00:00Z");
  const [row] = rows(
    { data: openData("2026-12-04", now), lang: "es", now },
    "open",
  );
  assert(
    row.client.includes("Rosa Delgado · Instalación"),
    `client line text is "${row.client}"`,
  );
});
