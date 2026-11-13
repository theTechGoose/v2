/**
 * REQ-192 — the timeclock feature's wiring on the front end: the Timesheet entry in the Roles
 * folder, the strings in both dictionaries, the route that mounts the island, the client, the
 * worker's clock card on their screen.
 */
import * as fs from "fs";
import * as path from "path";
import { folderPathTo, viewAt } from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;

describe("REQ-192 the timeclock feature", () => {
  test("Timesheet sits in the Roles folder between Workers and Editors and opens /field/timesheet", () => {
    expect(viewAt(NAV, ["manage"]).items.map((n) => n.id)).toEqual([
      "workers",
      "timesheet",
      "admins",
    ]);
    expect(folderPathTo(NAV, "timesheet")).toEqual(["manage"]);
    const node = viewAt(NAV, ["manage"]).items.find((n) =>
      n.id === "timesheet"
    ) as { href?: string; icon?: string };
    expect(node.href).toBe("/field/timesheet");
    expect(node.icon).toBe("clock");
  });

  test("both dictionaries carry the nav entry, the worker's clock strings and the timesheet strings", () => {
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    expect(en["nav.timesheet"]).toBe("Timesheet");
    expect(es["nav.timesheet"]).toBe("Horas");
    for (
      const k of [
        "clock.in",
        "clock.out",
        "clock.today",
        "clock.week",
        "clock.noShifts",
        "clock.open",
        "clock.on",
        "clock.off",
        "clock.onSince",
        "clock.offSince",
        "clock.never",
        "clock.showHours",
        "clock.hideHours",
        "clock.day",
        "clock.colIn",
        "clock.colOut",
        "clock.hours",
        "ts.docTitle",
        "ts.eyebrow",
        "ts.title",
        "ts.sub",
        "ts.prevWeek",
        "ts.nextWeek",
        "ts.thisWeek",
        "ts.total",
        "ts.anomaly.missing_in",
        "ts.anomaly.missing_out",
        "ts.log",
        "ts.void",
        "ts.voidReason",
        "ts.add",
        "ts.reason",
        "ts.manual",
        "ts.voided",
        "ts.empty",
        "ts.shift",
        "ts.start",
        "ts.end",
      ]
    ) {
      expect({ k, en: en[k] }).toMatchObject({ en: expect.any(String) });
      expect({ k, es: es[k] }).toMatchObject({ es: expect.any(String) });
    }
    expect(en["clock.in"]).toBe("Clock in");
    expect(en["clock.out"]).toBe("Clock out");
  });

  test("/field/timesheet mounts the TimesheetPage island inside the dashboard shell with the timesheet tab active", () => {
    const route = read("front-end/routes/field/timesheet.tsx");
    expect(route).toMatch(
      /import TimesheetPage from "\.\.\/\.\.\/islands\/TimesheetPage\.tsx"/,
    );
    expect(route).toMatch(/<DashSidebar active="timesheet" \/>/);
    expect(route).toMatch(/<TimesheetPage \/>/);
    // REQ-192 AMENDMENT (reconciled with demo-fixes' REQ-367): the tab title
    // is a DocTitle carrying both languages, so it follows the EN/ES switch
    expect(route).toMatch(/<DocTitle lang=\{lang\} title=\{\(l\) => tFor\(l, "ts\.docTitle"\)\} \/>/);
  });

  test("the worker's screen shows the clock card once signed in; the card calls the worker endpoints", () => {
    const screen = read("front-end/islands/WorkerScreen.tsx");
    expect(screen).toMatch(
      /import WorkerClock from "\.\.\/components\/timeclock\/WorkerClock\.tsx"/,
    );
    expect(screen).toMatch(/<WorkerClock/);
    const card = read("front-end/components/timeclock/WorkerClock.tsx");
    expect(card).toMatch(/timeclockWorker\.status\(/);
    expect(card).toMatch(/timeclockWorker\.punch\(/);
    expect(card).toMatch(/data-cy="clock-button"/);
    // AMENDMENT 2 — a slim bar: the state line, the one button, the hours behind one tap with headers
    expect(card).toMatch(/data-cy="clock-state"/);
    expect(card).toMatch(/data-cy="clock-hours"/);
    expect(card).toMatch(/aria-expanded=\{hours\}/);
    expect(card).toMatch(/<th>\{t\("clock\.day"\)\}<\/th>/);
    const client = read("front-end/clients/timeclock.ts");
    expect(client).toMatch(/"\/timeclock\/worker\/status"/);
    expect(client).toMatch(/"\/timeclock\/worker\/punch"/);
    expect(client).toMatch(/"\/timeclock\/report"/);
    expect(client).toMatch(/"\/timeclock\/punches"/);
    expect(client).toMatch(/\/void`/);
    expect(client).toMatch(/"\/timeclock\/shifts"/);
  });
});
