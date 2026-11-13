/**
 * REQ-699 (demo-loop cycle 5, M20) — a signed quote with a recurring payment
 * term becomes one Field subscription: what it bills, how often, from when,
 * where, and how the office reads it back.
 */
import { assertEquals } from "#std/assert";
import {
  type QuoteForSubscription,
  subscriptionBilling,
  subscriptionPlan,
} from "./mod.ts";
import type { Subscription } from "@field/dto/field.ts";

const term = (stepId: string, value: string) => ({
  stepId,
  label: stepId,
  value,
});

/** pair 2's quote (fleet-1 stdout:395–433), as signed */
const pair2 = (
  o: Partial<QuoteForSubscription> = {},
): QuoteForSubscription => ({
  id: "q-1",
  number: "Q-001",
  customerId: "c-1",
  jobName: "Corte de césped",
  summary: "Corte de césped y poda de setos",
  serviceAddress: "845 Palm Ave, Orlando, FL 32803",
  terms: [
    term("start_date", "Next week"),
    term("wraps", "2 hours"),
    term("payment_terms", "Monthly · $180/mo"),
  ],
  ...o,
});

Deno.test("REQ-699 M20 subscriptionPlan: pair 2's monthly quote → monthly, $180 a period, from the start term, linked to Q-001", () => {
  assertEquals(subscriptionPlan(pair2(), { today: "2026-11-12" }), {
    quoteId: "q-1",
    quoteNumber: "Q-001",
    customerId: "c-1",
    address: "845 Palm Ave, Orlando, FL 32803",
    taskTypeName: "Corte de césped",
    priceCents: 18_000,
    cadence: "monthly",
    startDate: "2026-11-19",
    recurring: { cadence: "monthly", amountCents: 18_000 },
  });
});

Deno.test("REQ-699 subscriptionPlan: weekly and every-2-weeks set the interval; the end date rides along", () => {
  const weekly = subscriptionPlan(
    pair2({ terms: [term("payment_terms", "Weekly · $45/wk")] }),
    { today: "2026-11-12" },
  )!;
  assertEquals(
    [weekly.cadence, weekly.intervalWeeks, weekly.priceCents, weekly.startDate],
    ["weekly", 1, 4_500, "2026-11-12"],
  );
  const bi = subscriptionPlan(
    pair2({
      terms: [
        term("start_date", "2026-12-01"),
        term("payment_terms", "Every 2 weeks · $90/2 wks · until 2027-06-30"),
      ],
    }),
    { today: "2026-11-12" },
  )!;
  assertEquals(
    [bi.cadence, bi.intervalWeeks, bi.priceCents, bi.startDate, bi.endDate],
    ["biweekly", 2, 9_000, "2026-12-01", "2027-06-30"],
  );
});

Deno.test("REQ-699 subscriptionPlan: the start is never before the signing day; TBD starts the day it is signed", () => {
  const start = (value: string) =>
    subscriptionPlan(
      pair2({
        terms: [
          term("start_date", value),
          term("payment_terms", "Monthly · $180/mo"),
        ],
      }),
      { today: "2026-11-12" },
    )!.startDate;
  assertEquals(start("TBD"), "2026-11-12");
  assertEquals(start("2026-10-01"), "2026-11-12");
  assertEquals(start("Right away"), "2026-11-12");
  // the quote's own ISO start wins over the term
  assertEquals(
    subscriptionPlan(pair2({ startDate: "2026-12-05" }), {
      today: "2026-11-12",
    })!
      .startDate,
    "2026-12-05",
  );
});

Deno.test("REQ-699 subscriptionPlan: the job address, else the customer's; the job's name, else its summary", () => {
  assertEquals(
    subscriptionPlan(pair2({ serviceAddress: "  " }), {
      today: "2026-11-12",
      customerAddress: "12 Oak St, Orlando, FL",
    })!.address,
    "12 Oak St, Orlando, FL",
  );
  assertEquals(
    subscriptionPlan(pair2({ serviceAddress: undefined }), {
      today: "2026-11-12",
    })!
      .address,
    "",
  );
  assertEquals(
    subscriptionPlan(pair2({ jobName: undefined }), { today: "2026-11-12" })!
      .taskTypeName,
    "Corte de césped y poda de setos",
  );
});

Deno.test("REQ-699 subscriptionPlan: nothing for a one-off payment term, no terms, or no customer", () => {
  const none = (q: QuoteForSubscription) =>
    subscriptionPlan(q, { today: "2026-11-12" });
  assertEquals(none(pair2({ terms: [term("payment_terms", "50/50")] })), null);
  assertEquals(none(pair2({ terms: [term("payment_terms", "Net 15")] })), null);
  assertEquals(none(pair2({ terms: undefined })), null);
  assertEquals(none(pair2({ customerId: undefined })), null);
});

const sub = (o: Partial<Subscription> = {}): Subscription => ({
  id: "s-1",
  userId: "u-1",
  customerId: "c-1",
  address: "845 Palm Ave",
  lat: 0,
  lng: 0,
  items: [{ taskTypeId: "t-1", priceCents: 18_000 }],
  cadence: "monthly",
  startDate: "2026-11-19",
  quoteId: "q-1",
  quoteNumber: "Q-001",
  active: true,
  createdAt: "2026-11-12T12:00:00.000Z",
  updatedAt: "2026-11-12T12:00:00.000Z",
  ...o,
});

Deno.test("REQ-699 M20 subscriptionBilling: a quote's subscription reads 'Monthly · $180/mo' / 'Mensual · $180/mes'", () => {
  assertEquals(subscriptionBilling(sub()), {
    en: "Monthly · $180/mo",
    es: "Mensual · $180/mes",
  });
  assertEquals(subscriptionBilling(sub({ endDate: "2027-06-30" })), {
    en: "Monthly · $180/mo · until Jun 30, 2027",
    es: "Mensual · $180/mes · hasta el 30 jun 2027",
  });
  // a period's price is every visit in it: two weekdays a week at $45
  assertEquals(
    subscriptionBilling(
      sub({
        cadence: "weekly",
        intervalWeeks: 1,
        days: [1, 4],
        items: [{ taskTypeId: "t-1", priceCents: 4_500 }],
      }),
    )?.en,
    "Weekly · $90/wk",
  );
  assertEquals(
    subscriptionBilling(
      sub({
        cadence: "biweekly",
        intervalWeeks: 2,
        items: [{ taskTypeId: "t-1", priceCents: 9_000 }],
      }),
    )?.es,
    "Cada 2 semanas · $90/2 semanas",
  );
});

Deno.test("REQ-699 subscriptionBilling: a hand-made subscription, or a schedule a cadence can't say, keeps its own schedule text", () => {
  assertEquals(subscriptionBilling(sub({ quoteId: undefined })), undefined);
  assertEquals(
    subscriptionBilling(sub({ cadence: "weekly", intervalWeeks: 3 })),
    undefined,
  );
  assertEquals(subscriptionBilling(sub({ items: [] })), undefined);
});

Deno.test("REQ-787 subscriptionBilling: an annual visit is never read as a weekly charge (no recurring term can say it, so its schedule text speaks)", () => {
  assertEquals(
    subscriptionBilling(sub({ cadence: "annual", month: 3, daysOfMonth: [5] })),
    undefined,
  );
});
