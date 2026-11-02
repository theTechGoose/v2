/**
 * REQ-127 — Raphael, 2026-11-02: "alex paid $99 … when he upgrades its trying to charge him 399
 * not 300 for the difference." / "upgrade charges the difference, downgrade has no refund".
 *
 * The ONE rule of a plan switch, read by the backend (what the due is) and drawn by the Billing
 * tab (what the card says it will do): shared/quote-flow/plan-switch.ts.
 */
import { addMonth, switchQuote } from "../../shared/quote-flow/plan-switch";

const NOW = "2026-11-02T15:00:00.000Z";
const active = (planId: string, nextBillAt?: string) => ({ planId, status: "active" as const, nextBillAt });

describe("REQ-127 plan switch", () => {
  test("REQ-127 an upgrade from an active plan is the difference of the two prices, billed at the new price from a month after activation", () => {
    expect(switchQuote(active("monster", "2026-11-20T15:00:00.000Z"), "assist-plus", NOW)).toEqual({
      kind: "upgrade",
      dueCents: 30000,
      monthlyCents: 39900,
      firstBillAt: null,
      fromPlanId: "monster",
    });
    expect(switchQuote(active("monster"), "assist", NOW).dueCents).toBe(10000);
    expect(switchQuote(active("assist"), "assist-plus", NOW).dueCents).toBe(20000);
  });

  test("REQ-127 a downgrade from an active plan charges nothing and refunds nothing: the cheaper billing starts the day the old one would have billed", () => {
    expect(switchQuote(active("assist-plus", "2026-11-20T15:00:00.000Z"), "monster", NOW)).toEqual({
      kind: "downgrade",
      dueCents: 0,
      monthlyCents: 9900,
      firstBillAt: "2026-11-20T15:00:00.000Z",
      fromPlanId: "assist-plus",
    });
    // the next bill unknown (the CRM never answered): a month from now, never today
    expect(switchQuote(active("assist-plus"), "monster", NOW).firstBillAt).toBe(addMonth(NOW));
  });

  test("REQ-127 from free, from a pending pick, from past due, and to or from the one-time test tier it is a first pick at full price", () => {
    const first = (current: Parameters<typeof switchQuote>[0], target: string, cents: number) => {
      const q = switchQuote(current, target, NOW);
      expect(q).toEqual({ kind: "first", dueCents: cents, monthlyCents: cents, firstBillAt: null, fromPlanId: null });
    };
    first(null, "monster", 9900);
    first({ planId: "free", status: "free" }, "assist-plus", 39900);
    first({ planId: "monster", status: "pending" }, "assist-plus", 39900);
    first({ planId: "monster", status: "past_due" }, "assist-plus", 39900);
    first(active("monster"), "test", 100);
    first({ planId: "test", status: "active" }, "monster", 9900);
  });

  test("REQ-127 back to free is its own kind: nothing charged (REQ-056/061 stop the billing, no refund)", () => {
    expect(switchQuote(active("monster", "2026-11-20T15:00:00.000Z"), "free", NOW)).toEqual({
      kind: "free",
      dueCents: 0,
      monthlyCents: 0,
      firstBillAt: null,
      fromPlanId: "monster",
    });
    expect(switchQuote(null, "free", NOW).kind).toBe("free");
  });

  test("REQ-127 the plan already active is 'same' — nothing to charge, nothing to start", () => {
    expect(switchQuote(active("monster"), "monster", NOW)).toEqual({ kind: "same", dueCents: 0, monthlyCents: 9900, firstBillAt: null, fromPlanId: "monster" });
  });

  test("REQ-127 a plan not on the list is refused by name", () => {
    expect(() => switchQuote(null, "platinum", NOW)).toThrow(/plan-unknown: platinum/);
  });

  test("addMonth — a calendar month later, same day and time; a day the next month lacks lands on its last", () => {
    expect(addMonth("2026-01-31T10:00:00.000Z")).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonth("2026-11-02T15:00:00.000Z")).toBe("2026-12-02T15:00:00.000Z");
  });
});
