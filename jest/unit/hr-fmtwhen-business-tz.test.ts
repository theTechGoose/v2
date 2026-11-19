/**
 * REQ-1154 (LOOP-007 cycle 3, q3-86; AMENDMENT of REQ-944): "HR hire page
 * prints times in UTC". `fmtWhen` in front-end/lib/hr.ts formatted an instant
 * with no `timeZone`, so /hr/hires/<id> (data loaded client-side) printed the
 * browser's clock — UTC on QA's VM — while /worker and /field/timesheet print
 * the business's zone. Every instant the HR hire page prints is the business's
 * wall time, whatever zone the browser (or this process) is in. The jest
 * process zone is the host's (Intl caches it, so it cannot be forced to UTC
 * here); the guard below makes sure it differs from the business zone, so a
 * zone-less fmtWhen cannot pass by accident.
 */
import * as fs from "fs";
import * as path from "path";
import { fmtWhen } from "../../front-end/lib/hr";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const norm = (s: string) => s.replace(/[\s  ]+/g, " ").trim();

const SENT = "2026-11-19T12:33:00Z";
const ZONE = "America/Chicago";

/** the business-zone rendering, the same shape fmtWhen prints */
function want(lang: "en" | "es"): string {
  const locale = lang === "es" ? "es-MX" : "en-US";
  const d = new Date(SENT);
  return norm(
    `${
      d.toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        timeZone: ZONE,
      })
    } · ${
      d.toLocaleTimeString(locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: ZONE,
      })
    }`,
  );
}

describe("REQ-1154 (LOOP-007 q3, q3-86): the HR hire page prints instants in the business's time zone", () => {
  it("REQ-1154 guard: this process's own zone is not the business zone", () => {
    expect(new Date(SENT).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })).not.toBe("6:33 AM");
  });

  it("REQ-1154 fmtWhen(sentAt, 'en', 'America/Chicago') prints 'Nov 19 · 6:33 AM', not the UTC 12:33 PM", () => {
    // deno-lint-ignore no-explicit-any
    const got = norm((fmtWhen as any)(SENT, "en", ZONE));
    expect(got).toBe("Nov 19 · 6:33 AM");
    expect(got).toBe(want("en"));
    expect(got).not.toContain("12:33");
  });

  it("REQ-1154 fmtWhen(sentAt, 'es', 'America/Chicago') prints the Central clock in Spanish", () => {
    // deno-lint-ignore no-explicit-any
    const got = norm((fmtWhen as any)(SENT, "es", ZONE));
    expect(got).toBe(want("es"));
    expect(got).toMatch(/\b6:33\b/);
    expect(got).not.toContain("12:33");
  });

  it("REQ-1154 the day follows the business zone too (00:30Z on Nov 20 is still Nov 19 in Chicago)", () => {
    // deno-lint-ignore no-explicit-any
    const got = norm((fmtWhen as any)("2026-11-20T00:30:00Z", "en", ZONE));
    expect(got).toBe("Nov 19 · 6:30 PM");
  });

  it("REQ-1154 /hr/hires/[id] hands the business zone (user.businessTimezone) to HrHireDetailPage", () => {
    const route = read("front-end/routes/hr/hires/[id].tsx");
    expect(route).toMatch(
      /<HrHireDetailPage[^>]*timeZone=\{\s*user\?*\.businessTimezone\s*\}/,
    );
  });

  it("REQ-1154 every fmtWhen call in HrHireDetailPage passes the zone", () => {
    const island = read("front-end/islands/HrHireDetailPage.tsx");
    const calls = island.match(/fmtWhen\(([^()]|\([^()]*\))*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    const zoneless = calls.filter((c) => !/,\s*lang\s*,\s*[\w.?]+\s*\)$/.test(c));
    expect(zoneless).toEqual([]);
  });
});
