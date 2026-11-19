/**
 * REQ-1064 (LOOP-007 q2-53): fmtServiceDates — the one helper /i/:id, the
 * invoice email, the invoice PDF and the search sub-line share.
 */
import { fmtServiceDates } from "../../shared/documents/service-dates";

const fmt = (d: string) => `<${d.slice(0, 10)}>`;

describe("REQ-1064 fmtServiceDates", () => {
  test("REQ-1064 same day reads once", () => {
    expect(fmtServiceDates("2026-11-19", "2026-11-19", fmt)).toBe(
      "<2026-11-19>",
    );
  });
  test("REQ-1064 a bare day and a full ISO stamp of it are one day", () => {
    expect(fmtServiceDates("2026-11-19T00:00:00.000Z", "2026-11-19", fmt)).toBe(
      "<2026-11-19>",
    );
  });
  test("REQ-1064 two days that format the same read once", () => {
    expect(fmtServiceDates("2026-11-19", "2026-11-20", () => "Nov")).toBe(
      "Nov",
    );
  });
  test("REQ-1064 two different days join with the en dash by default", () => {
    expect(fmtServiceDates("2026-11-19", "2026-11-21", fmt)).toBe(
      "<2026-11-19> – <2026-11-21>",
    );
  });
  test("REQ-1064 a caller-chosen separator", () => {
    expect(fmtServiceDates("2026-11-19", "2026-11-21", fmt, " → ")).toBe(
      "<2026-11-19> → <2026-11-21>",
    );
  });
  test("REQ-1064 only one end set: that day", () => {
    expect(fmtServiceDates("2026-11-19", undefined, fmt)).toBe("<2026-11-19>");
    expect(fmtServiceDates("", "2026-11-21", fmt)).toBe("<2026-11-21>");
    expect(fmtServiceDates(null, null, fmt)).toBeUndefined();
  });
});
