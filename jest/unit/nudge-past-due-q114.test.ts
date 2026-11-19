/**
 * REQ-938 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 1, issue q1-14:
 * "Overdue nudge and reminder send nothing for an invoice issued already past
 * due".
 *
 * INV-002 was due Nov 1 and nudged Nov 19 (18 days). `manualReminderDay`
 * rounds UP to the next step, so 15-29 days past due picks day 30 — the
 * owner-only alert that messages nobody. The card then says "Already nudged
 * today" (nudgeNote maps the escalated reply to alreadySent) although nothing
 * went out (REQ-556).
 */
import { manualReminderDay } from "../../shared/quote-flow/reminder-settings";
import { nudgeNote } from "../../shared/documents/delivery-truth";

describe("REQ-938 (LOOP-007 q1-14) a manual nudge on an invoice well past due reaches the customer", () => {
  test("REQ-938 18 days past due → the day-14 customer reminder, never the owner-only day 30", () => {
    expect(manualReminderDay("2026-11-01", "2026-11-19")).toBe(14);
  });

  test("REQ-938 every past-due nudge picks a customer step already reached, never day 30", () => {
    // 4 days late has reached step 3, not step 7
    expect(manualReminderDay("2026-11-15", "2026-11-19")).toBe(3);
    for (let d = 15; d <= 45; d++) {
      const due = new Date(Date.UTC(2026, 10, 19) - d * 864e5)
        .toISOString().slice(0, 10);
      expect([d, manualReminderDay(due, "2026-11-19")]).toEqual([d, 14]);
    }
  });

  test("REQ-938 (REQ-556) an escalated reply that reached nobody never says 'Already nudged'", () => {
    const note = nudgeNote(
      { channels: [], escalated: true } as unknown as Parameters<
        typeof nudgeNote
      >[0],
    );
    expect(note.key).not.toBe("invoicesPage.nudge.alreadySent");
    expect(note.key).not.toBe("invoicesPage.nudge.sent");
  });
});
