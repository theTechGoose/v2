import { assertEquals } from "#std/assert";
import { quoteQuota } from "./mod.ts";

// REQ-766 (demo-loop cycle 5v2, issue m17): Monster Free says "Up to five quotes and contracts a
// month" and the paid tiers say "Unlimited". The cap the plan's `limits.quotesPerMonth` names is the
// cap the app holds: a Free account's sixth quote of the calendar month (UTC) is refused.

const NOW = new Date("2026-11-12T15:00:00Z");
const made = (createdAt: string, extra: Record<string, unknown> = {}) => ({
  createdAt,
  ...extra,
});
const fiveThisMonth = [1, 2, 3, 4, 5].map((d) =>
  made(`2026-11-0${d}T10:00:00Z`)
);
const free = { planId: "free", status: "free" } as const;

Deno.test("REQ-766 m17 quoteQuota: a Free account with five quotes this month has reached its five", () => {
  assertEquals(quoteQuota(free, fiveThisMonth, NOW), {
    limit: 5,
    used: 5,
    reached: true,
  });
});

Deno.test("REQ-766 m17 quoteQuota: four this month leaves one", () => {
  assertEquals(quoteQuota(free, fiveThisMonth.slice(1), NOW), {
    limit: 5,
    used: 4,
    reached: false,
  });
});

Deno.test("REQ-766 m17 quoteQuota: last month's quotes and the onboarding sample don't count", () => {
  const quotes = [
    ...fiveThisMonth.slice(1),
    made("2026-10-31T23:59:59Z"),
    made("2026-11-02T00:00:00Z", { isSample: true }),
  ];
  assertEquals(quoteQuota(free, quotes, NOW), {
    limit: 5,
    used: 4,
    reached: false,
  });
});

Deno.test("REQ-766 m17 quoteQuota: the paid plans are unlimited, whatever their status", () => {
  for (const planId of ["monster", "assist", "assist-plus"]) {
    for (const status of ["pending", "active", "past_due"]) {
      assertEquals(
        quoteQuota({ planId, status }, [
          ...fiveThisMonth,
          made("2026-11-06T00:00:00Z"),
        ], NOW),
        null,
        `${planId}/${status}`,
      );
    }
  }
});

Deno.test("REQ-766 m17 quoteQuota: a downgrade to Free keeps the paid month unlimited, then caps", () => {
  const downgraded = {
    planId: "free",
    status: "active",
    paidThrough: "2026-11-30",
  };
  assertEquals(quoteQuota(downgraded, fiveThisMonth, NOW), null);
  assertEquals(
    quoteQuota(downgraded, fiveThisMonth, new Date("2026-12-01T10:00:00Z")),
    { limit: 5, used: 0, reached: false },
  );
});

Deno.test("REQ-766 m17 quoteQuota: no plan on record yet is not capped (the wizard picks the plan)", () => {
  assertEquals(quoteQuota(null, fiveThisMonth, NOW), null);
});
