import { assertEquals } from "#std/assert";
import { alreadyFiredOn, composeReminderCopy, daysOverdue, pickNextDay } from "./mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

function inv(overrides: Partial<Invoice>): Invoice {
  return {
    id: "i-1",
    userId: "u-1",
    contractId: "c-1",
    dueDate: "2026-05-01",
    amount: 100_00,
    status: "sent",
    createdAt: "2026-04-25T00:00:00Z",
    updatedAt: "2026-04-25T00:00:00Z",
    ...overrides,
  };
}

// 30 full days have elapsed from end-of-May-1 to noon-June-1
// (June 1 23:59:59 would be 31; noon is half a day shy).
const NOW = new Date("2026-06-01T12:00:00Z");

Deno.test("daysOverdue: positive for past dueDate, zero for missing", () => {
  assertEquals(daysOverdue(inv({}), NOW), 30);
  assertEquals(daysOverdue(inv({ dueDate: undefined }), NOW), 0);
});

Deno.test("pickNextDay: picks the largest unfired step that's elapsed", () => {
  // 31 days past due, no history → Day 30 escalation.
  assertEquals(pickNextDay(inv({}), NOW), 30);
  // Already fired 30 → undefined (we never re-fire).
  assertEquals(
    pickNextDay(
      inv({ reminderHistory: [{ day: 30, sentAt: NOW.toISOString(), channels: ["email"] }] }),
      NOW,
    ),
    undefined,
  );
});

Deno.test("pickNextDay: progressing through the cadence", () => {
  // 4 days past due, no history → Day 3.
  const fourPast = new Date("2026-05-05T12:00:00Z");
  assertEquals(pickNextDay(inv({}), fourPast), 3);
  // After Day 3 fires, at 8 days past → Day 7.
  const eightPast = new Date("2026-05-09T12:00:00Z");
  assertEquals(
    pickNextDay(
      inv({ reminderHistory: [{ day: 3, sentAt: "2026-05-04T12:00:00Z", channels: ["email", "sms"] }] }),
      eightPast,
    ),
    7,
  );
});

Deno.test("pickNextDay: muted invoices fire nothing", () => {
  assertEquals(pickNextDay(inv({ remindersMuted: true }), NOW), undefined);
});

Deno.test("pickNextDay: only fires for sent/viewed/claimed (not paid/void/scheduled)", () => {
  assertEquals(pickNextDay(inv({ status: "paid" }), NOW), undefined);
  assertEquals(pickNextDay(inv({ status: "void" }), NOW), undefined);
  assertEquals(pickNextDay(inv({ status: "scheduled" }), NOW), undefined);
  assertEquals(pickNextDay(inv({ status: "viewed" }), NOW), 30);
  assertEquals(pickNextDay(inv({ status: "claimed" }), NOW), 30);
});

Deno.test("pickNextDay: nothing within the first 3 days past due", () => {
  const twoPast = new Date("2026-05-03T12:00:00Z");
  assertEquals(pickNextDay(inv({}), twoPast), undefined);
});

Deno.test("alreadyFiredOn: exact-day lookup", () => {
  const i = inv({
    reminderHistory: [
      { day: 3, sentAt: "x", channels: [] },
      { day: 14, sentAt: "x", channels: [] },
    ],
  });
  assertEquals(alreadyFiredOn(i, 3), true);
  assertEquals(alreadyFiredOn(i, 7), false);
  assertEquals(alreadyFiredOn(i, 14), true);
  assertEquals(alreadyFiredOn(i, 30), false);
});

Deno.test("composeReminderCopy: Day 3 is the gentle 'quick check-in'", () => {
  const c = composeReminderCopy({
    day: 3,
    customerFirst: "Hans",
    senderFirst: "Riley",
    businessName: "Riley Roofing",
    invoice: inv({ amount: 18_000 }),
  });
  // Subject lands in the inbox row — frame as "quick check-in" so it
  // doesn't feel like a collection notice on day 3.
  assertEquals(c.emailSubject.includes("Quick check-in"), true);
  assertEquals(c.smsBody("http://x/s/abc").includes("$180"), true);
  assertEquals(c.smsBody("http://x/s/abc").includes("Hans"), true);
});

Deno.test("composeReminderCopy: Day 14 escalates personal tone", () => {
  const c = composeReminderCopy({
    day: 14,
    customerFirst: "Hans",
    senderFirst: "Riley",
    businessName: "Riley Roofing",
    invoice: inv({ amount: 18_000 }),
  });
  // Day 14 leans on the contractor's first name in the subject.
  assertEquals(c.emailSubject.includes("Riley"), true);
});

Deno.test("composeReminderCopy: handles missing customerFirst gracefully", () => {
  const c = composeReminderCopy({
    day: 7,
    customerFirst: undefined,
    senderFirst: undefined,
    businessName: "Acme",
    invoice: inv({ amount: 1_00, dueDate: undefined }),
  });
  // No "Hi <name>," prefix when we don't know the customer; body still
  // composes without throwing or showing "undefined".
  assertEquals(c.smsBody("").includes("undefined"), false);
  assertEquals(c.emailHtml("").includes("undefined"), false);
});
