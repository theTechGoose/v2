/**
 * REQ-508 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle 3, issue m20 ("Heavy polling; the browser calls POST /api/cron/run-nudges on every
 * /invoices load").
 *
 * RCA: REQ-022 made the /invoices island POST /api/cron/run-nudges on every mount as a stand-in
 * for a scheduler. The sweep now runs on the server (REQ-074's isolate timer), so the page sends
 * no such request. And the worker screen's 5 s refresh no longer reloads right after an action
 * already reloaded the day.
 */
import * as fs from "fs";
import * as path from "path";
import { refreshTickDue } from "../../front-end/lib/refresh-tick";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-508 (demo cycle 3, m20): the nudge sweep is not a page view", () => {
  it("REQ-508 the /invoices island never calls /api/cron/run-nudges", () => {
    expect(read("front-end/islands/InvoicesPage.tsx")).not.toMatch(
      /cron\/run-nudges/,
    );
  });

  it("REQ-508 no front-end code calls the cron endpoints", () => {
    const hits: string[] = [];
    for (
      const dir of [
        "front-end/islands",
        "front-end/lib",
        "front-end/clients",
        "front-end/routes",
      ]
    ) {
      const walk = (d: string) => {
        for (
          const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
        ) {
          const rel = path.join(d, e.name);
          if (e.isDirectory()) walk(rel);
          else if (
            /\.(ts|tsx)$/.test(e.name) && !/test\.tsx?$/.test(e.name) &&
            /\/cron\/run-/.test(read(rel))
          ) hits.push(rel);
        }
      };
      walk(dir);
    }
    expect(hits).toEqual([]);
  });
});

describe("REQ-508 (demo cycle 3, m20): the worker screen's refresh skips the tick after an action's reload", () => {
  const EVERY = 5000;
  it("REQ-508 a tick right after a reload is skipped; a regular 5 s tick still runs", () => {
    expect(refreshTickDue(10_000, 12_000, EVERY)).toBe(false); // act() reloaded 2 s ago
    expect(refreshTickDue(10_000, 15_000, EVERY)).toBe(true); // the last tick's own load, 5 s ago
    expect(refreshTickDue(0, 1_000_000, EVERY)).toBe(true);
  });

  it("REQ-508 WorkerScreen stamps every load and gates its interval on refreshTickDue", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    expect(src).toMatch(/lastLoadRef\.current = Date\.now\(\)/);
    expect(src).toMatch(
      /refreshTickDue\(lastLoadRef\.current, Date\.now\(\), REFRESH_MS\)/,
    );
  });
});
