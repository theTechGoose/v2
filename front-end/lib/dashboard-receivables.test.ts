/**
 * REQ-473 (demo-loop cycle 3, issue M8): the dashboard's "Money owed to you"
 * panel read "$-0 — No invoices yet" and an active job read "Deposit · No due
 * date" on an account whose only remaining bill was a SCHEDULED installment
 * on "Payment upon completion" terms.
 */
import { assert, assertEquals } from "@std/assert";
import { tickerFrame } from "./ticker-frame.ts";
import {
  jobPaidLabel,
  nextUpcomingBill,
  outstandingEmptyKey,
} from "./dashboard-receivables.ts";
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };

// ---------- (a) the Ticker never shows "-0" ----------

Deno.test("REQ-473 tickerFrame: a first rAF frame stamped BEFORE start (t<0) easing to 0 yields +0, never -0", () => {
  // The RCA's scratch run: start 1000, first frame 995.2, target 0.
  const v = tickerFrame(0, 1000, 995.2, 1400);
  assert(Object.is(v, 0), `expected +0, got ${Object.is(v, -0) ? "-0" : v}`);
  assertEquals(v.toLocaleString("en-US"), "0");
});

Deno.test("REQ-473 tickerFrame: t is clamped to [0,1] — an early frame shows 0, a late one the target", () => {
  assertEquals(tickerFrame(925, 1000, 990, 1400), 0);
  assertEquals(tickerFrame(925, 1000, 1000 + 5000, 1400), 925);
  const mid = tickerFrame(925, 1000, 1700, 1400);
  assert(mid > 0 && mid < 925, `mid-animation value ${mid}`);
});

Deno.test("REQ-473 Ticker island renders through tickerFrame (the clamp is wired, not just tested)", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/Ticker.tsx", import.meta.url),
  );
  assert(src.includes("tickerFrame("), "Ticker.tsx must call tickerFrame()");
});

// ---------- (b) the Outstanding list: open receivables + upcoming ----------

Deno.test("REQ-473 nextUpcomingBill: the earliest unpaid scheduled installment — its balance and the day it bills", () => {
  const up = nextUpcomingBill([
    { status: "paid", amount: 925_00, dueDate: "2026-11-12" },
    {
      status: "scheduled",
      amount: 925_00,
      dueDate: "2026-12-26",
      scheduledFor: "2026-11-26",
    },
    {
      status: "scheduled",
      amount: 500_00,
      dueDate: "2027-01-30",
      scheduledFor: "2026-12-30",
    },
  ]);
  assertEquals(up, { amountCents: 925_00, date: "2026-11-26" });
});

Deno.test("REQ-473 nextUpcomingBill: none when nothing is scheduled (paid / void / zero-balance ignored); dueDate when no scheduledFor", () => {
  assertEquals(
    nextUpcomingBill([
      { status: "paid", amount: 925_00, dueDate: "2026-11-12" },
      { status: "void", amount: 100_00, dueDate: "2026-11-12" },
      { status: "scheduled", amount: 0, dueDate: "2026-11-30" },
    ]),
    null,
  );
  assertEquals(
    nextUpcomingBill([
      { status: "scheduled", amount: 300_00, dueDate: "2026-11-30" },
    ]),
    { amountCents: 300_00, date: "2026-11-30" },
  );
});

Deno.test("REQ-473 outstandingEmptyKey: 'No invoices yet' only when the account has ZERO invoices", () => {
  // The demo: INV-001 paid + INV-002 scheduled → an upcoming line, not "No invoices yet".
  assertEquals(
    outstandingEmptyKey(2, { amountCents: 925_00, date: "2026-11-26" }),
    null,
  );
  assertEquals(outstandingEmptyKey(1, null), "outstanding.empty.allPaid");
  assertEquals(outstandingEmptyKey(0, null), "outstanding.empty.noInvoices");
});

Deno.test("REQ-473 DashboardPage lists OPEN receivables (not the legacy 'pending' status) and scheduled installments", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/DashboardPage.tsx", import.meta.url),
  );
  assert(
    !src.includes('dashboardClient.invoices("pending")'),
    "the Outstanding list must not query the legacy 'pending' status",
  );
  assert(src.includes('dashboardClient.invoices("open")'));
  assert(src.includes('dashboardClient.invoices("scheduled")'));
  assert(src.includes("nextUpcomingBill("));
  assert(src.includes("jobPaidLabel("));
});

// ---------- (c) the job row's paid label follows the payment terms ----------

Deno.test("REQ-473 jobPaidLabel: 'Payment upon completion' with nothing paid reads 'Due on completion', not 'Deposit'", () => {
  assertEquals(
    jobPaidLabel(0, "Payment upon completion"),
    { key: "dashboardPage.job.dueOnCompletion" },
  );
  assertEquals(
    jobPaidLabel(0, "Net 30"),
    { key: "dashboardPage.job.dueOnCompletion" },
  );
});

Deno.test("REQ-473 jobPaidLabel: 'Deposit' only when the first milestone IS a deposit", () => {
  assertEquals(jobPaidLabel(0, "50 / 50"), {
    key: "dashboardPage.job.deposit",
  });
  assertEquals(jobPaidLabel(0, "Deposit + balance"), {
    key: "dashboardPage.job.deposit",
  });
  assertEquals(jobPaidLabel(0, "Due now"), { key: "dashboardPage.job.unpaid" });
  assertEquals(jobPaidLabel(0, null), { key: "dashboardPage.job.unpaid" });
});

Deno.test("REQ-473 jobPaidLabel: anything paid reads '$N paid' whatever the terms", () => {
  assertEquals(jobPaidLabel(925_00, "Payment upon completion"), {
    key: "dashboardPage.job.amountPaid",
    params: { amount: "$925" },
  });
});

Deno.test("REQ-473 en + es carry the new dashboard keys", () => {
  const dicts = [en, es] as unknown as Record<string, string>[];
  for (const d of dicts) {
    for (
      const k of [
        "dashboardPage.job.dueOnCompletion",
        "dashboardPage.job.unpaid",
        "outstanding.upcoming",
      ]
    ) assert(typeof d[k] === "string" && d[k].length > 0, `missing ${k}`);
    assert(d["outstanding.upcoming"].includes("{amt}"));
    assert(d["outstanding.upcoming"].includes("{date}"));
  }
  assertEquals(
    (es as unknown as Record<string, string>)[
      "dashboardPage.job.dueOnCompletion"
    ],
    "Pago al finalizar",
  );
});
