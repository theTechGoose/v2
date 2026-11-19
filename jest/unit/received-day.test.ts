/**
 * REQ-943 (LOOP-007 cycle 1, q1-8) — the shared received-day rule POST/PUT
 * /payments and the "Payment received" form apply.
 */
import {
  isAfterLocalToday,
  localIsoDay,
  RECEIVED_AT_SLACK_MS,
  receivedAtProblem,
} from "../../shared/documents/received-day";

const NOW = new Date("2026-11-19T15:00:00Z");

test("REQ-943 (q1-8): a received instant after today + a day of slack is future_date", () => {
  expect(receivedAtProblem("2027-06-01T12:00:00Z", NOW)).toBe("future_date");
  expect(
    receivedAtProblem(
      new Date(NOW.getTime() + RECEIVED_AT_SLACK_MS + 1).toISOString(),
      NOW,
    ),
  ).toBe("future_date");
});

test("REQ-943 (q1-8): now, earlier, and noon-local today anywhere are fine", () => {
  expect(receivedAtProblem(NOW.toISOString(), NOW)).toBe(null);
  expect(receivedAtProblem("2026-01-02T12:00:00Z", NOW)).toBe(null);
  // noon today in UTC-12 is 00:00 UTC tomorrow: inside the slack
  expect(receivedAtProblem("2026-11-20T00:00:00Z", NOW)).toBe(null);
});

test("REQ-943 (q1-8): unparseable or missing is invalid_date", () => {
  for (const v of ["not a date", "", undefined, null, 42]) {
    expect(receivedAtProblem(v, NOW)).toBe("invalid_date");
  }
});

test("REQ-943 (q1-8): the form's local-day rule", () => {
  const now = new Date(2026, 10, 19, 23, 30);
  expect(localIsoDay(now)).toBe("2026-11-19");
  expect(isAfterLocalToday("2026-11-19", now)).toBe(false);
  expect(isAfterLocalToday("2026-11-18", now)).toBe(false);
  expect(isAfterLocalToday("2026-11-20", now)).toBe(true);
});
