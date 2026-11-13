/**
 * REQ-699 (demo-loop cycle 5, M20) — the agreement's payment schedule for a
 * recurring term: one row per period ("Monthly $180.00 · Billed every
 * month"), never the one-off "Final payment … On completion" a split reader
 * falls back to.
 */
import { assertEquals } from "@std/assert";
import { computeMilestones } from "../components/doc-parts.tsx";

const terms = (value: string) => [{
  stepId: "payment_terms",
  label: "Payment",
  value,
}];

Deno.test("REQ-699 M20 computeMilestones: a monthly term is one 'every month' row, en and es", () => {
  assertEquals(computeMilestones(18_000, terms("Monthly · $180/mo"), "en"), [
    { label: "Monthly", amount: 18_000, when: "Billed every month" },
  ]);
  assertEquals(
    computeMilestones(
      18_000,
      terms("Every 2 weeks · $90/2 wks · until 2027-06-30"),
      "es",
    ),
    [{
      label: "Cada 2 semanas",
      amount: 9_000,
      when: "Se cobra cada 2 semanas · hasta el 30 jun 2027",
    }],
  );
});

Deno.test("REQ-699 computeMilestones: the one-off terms are unchanged", () => {
  assertEquals(computeMilestones(18_000, terms("50/50"), "en").length, 2);
  assertEquals(
    computeMilestones(18_000, terms("Payment upon completion"), "en").length,
    1,
  );
});
