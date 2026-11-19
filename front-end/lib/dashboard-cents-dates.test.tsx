/**
 * REQ-1093 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 3, issues q3-11 and
 * q3-12 (amends REQ-473 + REQ-961).
 *
 * q3-11: after a 50/50 signing the dashboard money bar's upcoming line read
 *   "Próximo: $2,563 se cobra el dic 3" for a $2,562.75 scheduled balance —
 *   rounded to whole dollars, month-first in Spanish, and "se cobra"
 *   (collected) for an installment /invoices calls "programada … te
 *   recordamos enviarla".
 * q3-12: the Active jobs card read "$5,126" and "Vence nov 26" for a $5,125.50
 *   job — rounded, and month-first in Spanish while the money bar on the same
 *   page reads "26 nov".
 *
 * The island is mounted live (hooks + the dashboard fetch effect run for
 * real, api.get stubbed), and the props DashboardPage hands to <MoneyBar>
 * (`upcoming`) and <ActiveJobs> (`jobs`) are read off the vnodes. The
 * browser proof is e2e/dashboard-cents-dates.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { options, render } from "preact";
import { act } from "preact/test-utils";
import { api } from "./api.ts";
import { langSignal } from "./i18n.ts";
import DashboardPage from "../islands/DashboardPage.tsx";
import { MoneyBar } from "../components/MoneyBar.tsx";
import { ActiveJobs, type JobRow } from "../components/DashSections.tsx";

const dict = (lang: "en" | "es") =>
  JSON.parse(
    Deno.readTextFileSync(new URL(`../../lang/${lang}.json`, import.meta.url)),
  ) as Record<string, string>;

/** yyyy-mm-dd of local today + n days. */
function isoIn(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const JOB_DUE = isoIn(10); // > 7 days out → the month/day branch of fmtDueRel
const BALANCE_ON = "2026-12-03"; // the QA run's scheduled balance

const JOBS = [{
  id: "job-1",
  customer: { id: "c-1", name: "Rosa Delgado" },
  quote: {
    id: "q-1",
    summary: "Kitchen remodel — Rosa Delgado",
    estimatedTotalCents: 512_550,
    jobName: "Kitchen remodel",
  },
  totalCents: 512_550, // $5,125.50
  paidCents: 256_275,
  pctPaid: 50,
  nextDueDate: JOB_DUE,
  paymentTerms: "50% deposit, 50% on completion",
  status: "in_progress",
  statusLabel: "In progress",
}];

const INVOICES = [
  {
    id: "inv-1",
    userId: "u-1",
    quoteId: "q-1",
    customerId: "c-1",
    amount: 256_275,
    dueDate: "2026-11-19",
    status: "paid",
    paidAt: "2026-11-19T15:00:00.000Z",
  },
  {
    id: "inv-2",
    userId: "u-1",
    quoteId: "q-1",
    customerId: "c-1",
    amount: 256_275, // $2,562.75
    dueDate: "2027-01-02",
    scheduledFor: BALANCE_ON,
    status: "scheduled",
  },
];

type Get = typeof api.get;
type VNodeLike = { type: unknown; props?: Record<string, unknown> };

/** Mount DashboardPage in `lang`; return the latest `upcoming` and `jobs` props. */
async function mount(
  lang: "en" | "es",
): Promise<{ upcoming: string | null; jobs: JobRow[] }> {
  const doc = new DOMParser().parseFromString(
    "<html><body><div id=r></div></body></html>",
    "text/html",
  )!;
  const g = globalThis as unknown as { document?: unknown };
  const prevDoc = g.document;
  const prevGet = api.get;
  const prevLang = langSignal.value;
  const o = options as { vnode?: (v: VNodeLike) => void };
  const prevVnode = o.vnode;
  let upcoming: string | null = null;
  let jobs: JobRow[] = [];
  o.vnode = (v) => {
    if (v.type === MoneyBar && v.props) {
      upcoming = (v.props.upcoming as string | null) ?? null;
    }
    if (v.type === ActiveJobs && v.props) {
      jobs = (v.props.jobs as JobRow[]) ?? [];
    }
    prevVnode?.(v);
  };
  g.document = doc;
  langSignal.value = lang;
  (api as { get: Get }).get = ((path: string) => {
    if (path.startsWith("/jobs")) return Promise.resolve(structuredClone(JOBS));
    if (path.startsWith("/invoices")) {
      return Promise.resolve(structuredClone(INVOICES));
    }
    if (path.startsWith("/analytics/dashboard")) {
      return Promise.reject(new Error("no stats in this test"));
    }
    if (path.startsWith("/notifications/unread-count")) {
      return Promise.resolve({ count: 0 });
    }
    return Promise.resolve([]);
  }) as Get;
  try {
    const root = doc.getElementById("r") as unknown as Element;
    await act(() => {
      render(<DashboardPage />, root);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    }
    await act(() => {
      render(null, root);
    });
  } finally {
    o.vnode = prevVnode;
    g.document = prevDoc;
    langSignal.value = prevLang;
    (api as { get: Get }).get = prevGet;
  }
  return { upcoming, jobs };
}

/** The house short date (day-first in es, month-first in en), no year. */
function houseDay(iso: string, lang: "en" | "es"): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    { month: "short", day: "numeric", timeZone: "UTC" },
  ).replace(".", "");
}

// ---------- q3-11: the money bar's upcoming line ----------

Deno.test("REQ-1093 (LOOP-007 q3, q3-11): es — the dashboard upcoming line shows the scheduled balance to the cent, day-first, without 'se cobra'", async () => {
  const { upcoming } = await mount("es");
  assert(upcoming, "the money bar got an upcoming line");
  assert(
    upcoming.includes("$2,562.75"),
    `the upcoming line shows $2,562.75 to the cent: "${upcoming}"`,
  );
  assert(!upcoming.includes("$2,563"), `rounded to $2,563: "${upcoming}"`);
  assert(
    upcoming.includes("3 dic"),
    `the date reads "3 dic" (house Spanish order): "${upcoming}"`,
  );
  assert(!upcoming.includes("dic 3"), `month-first "dic 3": "${upcoming}"`);
  assert(
    !/se cobra/i.test(upcoming),
    `a scheduled send is not "collected" ("se cobra"): "${upcoming}"`,
  );
});

Deno.test("REQ-1093 (LOOP-007 q3, q3-11): en — the dashboard upcoming line shows $2,562.75 and Dec 3", async () => {
  const { upcoming } = await mount("en");
  assert(upcoming, "the money bar got an upcoming line");
  assert(
    upcoming.includes("$2,562.75"),
    `the upcoming line shows $2,562.75 to the cent: "${upcoming}"`,
  );
  assert(upcoming.includes("Dec 3"), `the date reads "Dec 3": "${upcoming}"`);
});

Deno.test("REQ-1093 (LOOP-007 q3, q3-11): es 'outstanding.upcoming' uses the scheduled-send wording ('enviar'), not 'se cobra'", () => {
  const es = dict("es")["outstanding.upcoming"];
  assert(!/se cobra/i.test(es), `es copy says "se cobra": "${es}"`);
  assert(/envi/i.test(es), `es copy uses the send wording: "${es}"`);
  // the amount placeholder carries its own "$" (fmtMoneyExact / fmtMoneyTotal)
  for (const lang of ["en", "es"] as const) {
    const s = dict(lang)["outstanding.upcoming"];
    assert(!s.includes("${amt}"), `${lang} adds its own "$": "${s}"`);
  }
});

// ---------- q3-12: the Active jobs card ----------

Deno.test("REQ-1093 (LOOP-007 q3, q3-12): es — the Active jobs row shows $5,125.50 and 'Vence <day> <mon>' (day-first)", async () => {
  const { jobs } = await mount("es");
  assertEquals(jobs.length, 1, "one active job row");
  const row = jobs[0];
  assertEquals(
    { amount: row.amount, due: row.due },
    { amount: "$5,125.50", due: `Vence ${houseDay(JOB_DUE, "es")}` },
    "the job total to the cent and the due date day-first in es",
  );
});

Deno.test("REQ-1093 (LOOP-007 q3, q3-12): en — the Active jobs row shows $5,125.50 and 'Due <Mon> <day>'", async () => {
  const { jobs } = await mount("en");
  assertEquals(jobs.length, 1, "one active job row");
  const row = jobs[0];
  assertEquals(
    { amount: row.amount, due: row.due },
    { amount: "$5,125.50", due: `Due ${houseDay(JOB_DUE, "en")}` },
    "the job total to the cent and the due date month-first in en",
  );
});

Deno.test("REQ-1093 (LOOP-007 q3, q3-11/q3-12): DashboardPage.tsx no longer rounds a document amount to whole dollars", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/DashboardPage.tsx", import.meta.url),
  );
  assert(!src.includes("Math.round(total)"), "jobToRow rounds the job total");
  assert(
    !src.includes("Math.round(upcomingBill.amountCents"),
    "the upcoming line rounds the balance",
  );
});
