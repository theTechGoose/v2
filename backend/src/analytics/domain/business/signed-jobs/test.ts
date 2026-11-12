/**
 * REQ-562 — demo-loop cycle 4, issues M38 + m21: a signed 50/50 job with its
 * deposit paid and its balance invoice scheduled read "0 signed jobs" on
 * /clients (accepted quotes − paid invoices = 1 − 1) while the dashboard's
 * ACTIVE JOBS said 1, and the brand-new customer wore "Regular". One rule for
 * both: a signed job is in flight until every non-void invoice linked to it,
 * scheduled ones included, is paid.
 */
import { assertEquals } from "#std/assert";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import {
  completedJobsInYear,
  countJobs,
  countPaidJobs,
  isJobComplete,
  isSignedJob,
} from "./mod.ts";

const quote = (over: Partial<Quote>): Quote =>
  ({
    id: "q-1",
    summary: "Deck",
    status: "accepted",
    acceptedAt: "2026-11-01T00:00:00Z",
    ...over,
  }) as Quote;
const inv = (over: Partial<Invoice>): Invoice =>
  ({
    id: crypto.randomUUID(),
    quoteId: "q-1",
    status: "sent",
    amount: 1_425_00,
    dueDate: "2026-12-01",
    ...over,
  }) as Invoice;

Deno.test("REQ-562 (cycle 4, M38) isJobComplete — a paid deposit with the balance still scheduled is not complete", () => {
  assertEquals(
    isJobComplete([inv({ status: "paid" }), inv({ status: "scheduled" })]),
    false,
  );
});

Deno.test("REQ-562 (cycle 4, M38) isJobComplete — every non-void invoice paid is complete; void ones don't hold it open; no invoice yet is not complete", () => {
  assertEquals(
    isJobComplete([inv({ status: "paid" }), inv({ status: "paid" })]),
    true,
  );
  assertEquals(
    isJobComplete([inv({ status: "paid" }), inv({ status: "void" })]),
    true,
  );
  assertEquals(isJobComplete([inv({ status: "void" })]), false);
  assertEquals(isJobComplete([]), false);
});

Deno.test("REQ-562 (cycle 4, M38) isSignedJob — the pipeline's won rule, the onboarding sample excluded", () => {
  assertEquals(isSignedJob(quote({})), true);
  assertEquals(
    isSignedJob(quote({ status: "sent", acceptedAt: undefined })),
    false,
  );
  assertEquals(isSignedJob(quote({ isSample: true } as Partial<Quote>)), false);
});

Deno.test("REQ-562 (cycle 4, M38) countJobs — Linda's 50/50: deposit paid, balance scheduled → 1 active, 0 completed", () => {
  assertEquals(
    countJobs([quote({})], [
      inv({ status: "paid" }),
      inv({ status: "scheduled" }),
    ]),
    { active: 1, completed: 0 },
  );
});

Deno.test("REQ-562 (cycle 4, m21) countJobs — a signed job with no invoice is active; two fully paid jobs are 2 completed; standalone paid invoices count one job each", () => {
  assertEquals(countJobs([quote({})], []), { active: 1, completed: 0 });
  assertEquals(
    countJobs(
      [quote({ id: "a" }), quote({ id: "b" })],
      [
        inv({ quoteId: "a", status: "paid" }),
        inv({ quoteId: "a", status: "paid" }),
        inv({ quoteId: "b", status: "paid" }),
      ],
    ),
    { active: 0, completed: 2 },
  );
  assertEquals(
    countJobs([], [
      inv({ quoteId: undefined, status: "paid" }),
      inv({ quoteId: undefined, status: "paid" }),
    ]),
    { active: 0, completed: 2 },
  );
});

Deno.test("REQ-562 (cycle 4, m21) countPaidJobs — two paid installments of one quote are one paid job; a standalone invoice is its own", () => {
  assertEquals(
    countPaidJobs([
      inv({ status: "paid" }),
      inv({ status: "paid" }),
      inv({ quoteId: undefined, status: "paid" }),
    ]),
    2,
  );
});

Deno.test("REQ-698 (cycle 5, m14) completedJobsInYear — a paid deposit with the balance scheduled is no paid job; a fully paid job counts once with its whole amount; last year's job does not", () => {
  const at = "2026-11-12T18:00:00.000Z";
  assertEquals(
    completedJobsInYear([
      { id: "i1", quoteId: "q1", status: "paid", paidAt: at, amount: 725_00 },
      { id: "i2", quoteId: "q1", status: "scheduled", amount: 725_00 },
      { id: "i3", quoteId: "q2", status: "paid", paidAt: at, amount: 500_00 },
      { id: "i4", quoteId: "q2", status: "paid", paidAt: at, amount: 500_00 },
      { id: "i5", quoteId: "q2", status: "void", amount: 99_00 },
      {
        id: "i6",
        quoteId: "q3",
        status: "paid",
        paidAt: "2025-12-30T00:00:00.000Z",
        amount: 300_00,
      },
      { id: "i7", status: "paid", paidAt: at, amount: 200_00 },
    ] as never, 2026),
    { count: 2, cents: 1_200_00 },
  );
});
