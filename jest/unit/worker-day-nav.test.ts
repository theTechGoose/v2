/**
 * REQ-362 — demo-loop cycle 1, demo issue M35: "Worker view can't look ahead: only '← Ayer', no
 * tomorrow". The /worker day navigator offered one link — "← Yesterday" on today, "Viewing <day> ·
 * Today →" on any other day — so a worker could never see tomorrow's round, although
 * GET /field/worker/tasks?date= serves any day. The navigator's links and the preview rule live in
 * front-end/lib/field.ts (`workerDayNav`), bound into islands/WorkerScreen.tsx. A day after today is
 * a read-only preview (REQ-141: no acting on the future): its check buttons are locked and a hint
 * says the services can be checked off on the day.
 */
import * as fs from "fs";
import * as path from "path";
import { workerDayNav } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/WorkerScreen.tsx");

describe("REQ-362 workerDayNav — the /worker day navigator looks back AND ahead", () => {
  test("on today: ← Yesterday and Tomorrow →, no Today link, not a preview", () => {
    expect(workerDayNav("2026-11-12", "2026-11-12")).toEqual({
      prev: { href: "/worker?date=2026-11-11", key: "worker.yesterday" },
      today: null,
      next: { href: "/worker?date=2026-11-13", key: "worker.tomorrow" },
      preview: false,
    });
  });

  test("on tomorrow: ← previous day · Today · next day →, and it is a preview", () => {
    expect(workerDayNav("2026-11-13", "2026-11-12")).toEqual({
      prev: { href: "/worker?date=2026-11-12", key: "worker.prevDay" },
      today: "/worker",
      next: { href: "/worker?date=2026-11-14", key: "worker.nextDay" },
      preview: true,
    });
  });

  test("on a past day: both directions and Today; not a preview", () => {
    const nav = workerDayNav("2026-11-10", "2026-11-12");
    expect(nav.prev.href).toBe("/worker?date=2026-11-09");
    expect(nav.next.href).toBe("/worker?date=2026-11-11");
    expect(nav.today).toBe("/worker");
    expect(nav.preview).toBe(false);
  });

  test("crosses a month and a year boundary", () => {
    expect(workerDayNav("2026-12-31", "2026-12-31").next.href).toBe(
      "/worker?date=2027-01-01",
    );
    expect(workerDayNav("2026-03-01", "2026-03-01").prev.href).toBe(
      "/worker?date=2026-02-28",
    );
  });

  test("the navigator's and the preview's strings are in both dictionaries", () => {
    for (
      const k of [
        "worker.tomorrow",
        "worker.prevDay",
        "worker.nextDay",
        "worker.preview",
      ]
    ) {
      expect([k, typeof en[k]]).toEqual([k, "string"]);
      expect([k, typeof es[k]]).toEqual([k, "string"]);
      expect(en[k]).not.toBe(es[k]);
    }
  });
});

describe("REQ-362 WorkerScreen renders the navigator and locks a future day", () => {
  test("the island draws the day links from workerDayNav (prev, today, next)", () => {
    expect(island).toMatch(/workerDayNav\(/);
    expect(island).toMatch(/data-cy="w-day-prev"/);
    expect(island).toMatch(/data-cy="w-day-next"/);
    expect(island).toMatch(/data-cy="w-day-today"/);
    // no hard-coded one-way link left behind
    expect(island).not.toMatch(/shiftIso\(today, -1\)/);
  });

  test("a preview day shows the hint and locks the check buttons", () => {
    expect(island).toMatch(/data-cy="w-preview"/);
    expect(island).toMatch(/t\("worker\.preview"\)/);
    expect(island).toMatch(/disabled=\{s\.locked \|\| preview/);
  });
});
