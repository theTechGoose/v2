/**
 * REQ-1000 — LOOP-007 cycle 1, issue q1-86 "Timesheet first load shows 'No punches this week'
 * while a worker is clocked in". The TimesheetPage island starts with report=null and punches=[]
 * and fetches in a useEffect after mount, with no "loaded yet" flag — so the server render (and
 * the first client render, which starts from the same state) paints "Punches 0 / No punches this
 * week." as if the week really were empty. Not loaded must never read as loaded-and-empty.
 *
 * The render before any fetch is what is checked here: renderToString runs no effects, exactly
 * the state the tester saw. (deno-dom cannot mount a precompiled island, so the "delayed fetch,
 * then the row" half and "a truly empty week still says so" run in a real browser:
 * e2e/timeclock/timesheet-first-load.e2e.test.ts.)
 *
 *   cd front-end && deno test -A lib/timesheet-first-load.test.tsx
 */
import { assert } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import TimesheetPage from "../islands/TimesheetPage.tsx";
import { langSignal, t } from "./i18n.ts";

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1000 (LOOP-007 q1-86) [${lang}]: before the week is fetched the punch log shows neither 'No punches this week' nor a count of 0`, () => {
    langSignal.value = lang;
    const html = renderToString(<TimesheetPage />);
    const doc = new DOMParser().parseFromString(html, "text/html")!;
    const panel = doc.querySelector("[data-cy=ts-log-panel]") as Element;
    assert(panel, "the punch-log panel is rendered");
    const noPunches = t("ts.noPunches");
    assert(
      !panel.textContent.includes(noPunches),
      `not loaded yet, but the log panel already says "${noPunches}": ${panel.innerHTML}`,
    );
    const count = panel.querySelector(".count");
    assert(
      count === null || count.textContent.trim() !== "0",
      `not loaded yet, but the log count already reads 0: ${panel.innerHTML}`,
    );
  });
}
