/**
 * REQ-956 (LOOP-007 q1, q1-31) — the dashboard money bar's "estimates out"
 * bucket must hold every quote /quotes counts as out for response. A quote the
 * customer has opened is status "viewed" (sent → viewed on the first /q open);
 * the bucket kept only status === "sent", so the dashboard read "0 estimates
 * out" while /quotes read "1 quote waiting".
 */
import { buildMoneyBar } from "../../shared/receivables/money-bar.ts";
import { classifyQuoteForPipeline } from "../../shared/quote-flow/pipeline-stats.ts";

const NOW = new Date("2026-11-18T01:37:45Z");
const SENT_AT = "2026-11-17T22:00:00Z";

const estimatesOf = (quotes: Parameters<typeof buildMoneyBar>[0]["quotes"]) =>
  buildMoneyBar({
    quotes,
    jobs: [],
    invoices: [],
    customerNames: new Map(),
    now: NOW,
  }).buckets.find((b) => b.key === "estimates")!;

describe("REQ-956 (LOOP-007 q1-31) money bar estimates = quotes out for response", () => {
  test("REQ-956: a quote the customer has opened (status 'viewed') is still 1 estimate out, with its value", () => {
    const est = estimatesOf([{
      id: "q-002",
      status: "viewed",
      estimatedTotal: 380_000,
      customerName: "Dana",
      number: "Q-002",
      sentAt: SENT_AT,
    }]);
    expect(est.count).toBe(1);
    expect(est.cents).toBe(380_000);
    expect(est.items[0]).toMatchObject({ id: "q-002", kind: "quote" });
  });

  test("REQ-956: for every status, the estimates bucket agrees with /quotes' 'awaiting' class", () => {
    for (const status of ["draft", "sent", "viewed", "accepted", "declined"]) {
      const q = {
        id: `q-${status}`,
        status,
        estimatedTotal: 10_000,
        customerName: "X",
        ...(status === "draft" ? {} : { sentAt: SENT_AT }),
      };
      const out = classifyQuoteForPipeline(q as never) === "awaiting";
      expect({ status, inBucket: estimatesOf([q]).count === 1 })
        .toEqual({ status, inBucket: out });
    }
  });
});
