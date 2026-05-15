import { assertEquals } from "#std/assert";
import { isNudgeDue } from "./mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

function inv(overrides: Partial<Invoice>): Invoice {
  return {
    id: "i-1",
    userId: "u-1",
    contractId: "c-1",
    dueDate: "2026-05-21",
    amount: 100_00,
    status: "scheduled",
    scheduledFor: "2026-05-14",
    installmentIndex: 2,
    installmentTotal: 3,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

const TODAY = new Date("2026-05-14T08:00:00Z"); // morning of the scheduled date.

Deno.test("isNudgeDue: fires on the scheduled day", () => {
  assertEquals(isNudgeDue(inv({}), TODAY), true);
});

Deno.test("isNudgeDue: fires the day BEFORE (one-day lookahead)", () => {
  const dayBefore = new Date("2026-05-13T20:00:00Z");
  assertEquals(isNudgeDue(inv({}), dayBefore), true);
});

Deno.test("isNudgeDue: silent two days before", () => {
  const twoBefore = new Date("2026-05-12T08:00:00Z");
  assertEquals(isNudgeDue(inv({}), twoBefore), false);
});

Deno.test("isNudgeDue: still fires after the scheduled day passes", () => {
  // The cron should keep nudging until the contractor acts (send/postpone).
  const past = new Date("2026-05-20T12:00:00Z");
  assertEquals(isNudgeDue(inv({}), past), true);
});

Deno.test("isNudgeDue: skips invoices that aren't scheduled", () => {
  assertEquals(isNudgeDue(inv({ status: "sent" }), TODAY), false);
  assertEquals(isNudgeDue(inv({ status: "paid" }), TODAY), false);
  assertEquals(isNudgeDue(inv({ status: "void" }), TODAY), false);
});

Deno.test("isNudgeDue: skips invoices missing scheduledFor", () => {
  assertEquals(isNudgeDue(inv({ scheduledFor: undefined }), TODAY), false);
});
