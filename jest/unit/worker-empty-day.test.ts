/**
 * REQ-1035 (+ REQ-1011) — LOOP-007 cycle 2, QA issues q2-17 and q2-50: an empty day on /worker
 * says it is empty once.
 *  q2-17: a foreman's empty day shows the summary "0% Sin tareas hoy / Nada programado.", then a
 *         "Mis tareas" header with a "0/0" count chip (renderSection's unconditional
 *         `<span class="count">`), then a third message `worker.noneCrew` "Sin tareas este día.".
 *  q2-50: a worker's empty future day shows the REQ-362 preview hint ("you can check these off
 *         on the day" — over nothing), the summary "No tasks this day / Nothing scheduled.", and
 *         a second `w-empty` card "No tasks this day." with a sparkle icon that reads as loading.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SRC = read("front-end/islands/WorkerScreen.tsx");

/** the source of `function renderSection(...)` up to the next top-level statement */
function renderSectionSrc(): string {
  const start = SRC.indexOf("function renderSection(");
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("\n  const liveTasks", start);
  return SRC.slice(start, end > start ? end : start + 2000);
}

describe("REQ-1035 (LOOP-007 q2-17, q2-50) an empty /worker day states it once", () => {
  test("REQ-1035 / REQ-1011 (q2-17): renderSection's count chip is drawn only when the section has live rows — never '0/0'", () => {
    const sec = renderSectionSrc();
    const at = sec.indexOf('class="count"');
    expect(at).toBeGreaterThan(-1);
    // the JSX right before the chip must gate it on there being live rows
    const before = sec.slice(Math.max(0, at - 160), at);
    expect(before).toMatch(/liveRows\.length\s*(>\s*0\s*)?(&&|\?)/);
  });

  test("REQ-1035 (q2-17): the foreman's empty 'Mis tareas' section adds no second empty card under the summary", () => {
    // either the "mine" section is skipped when it has no rows, or renderSection draws no
    // fixed any-day `worker.noneCrew` card (the summary already says "Sin tareas hoy")
    const call = SRC.indexOf('renderSection(mine, t("worker.mine")');
    expect(call).toBeGreaterThan(-1);
    const guardedCall =
      /(mine\w*|Counts?)[^;{}]{0,80}(&&|\?)\s*renderSection\(mine,/
        .test(SRC.slice(Math.max(0, call - 200), call + 40));
    const noFixedCard = !renderSectionSrc().includes('t("worker.noneCrew")');
    expect(guardedCall || noFixedCard).toBe(true);
  });

  test("REQ-1035 (q2-50): the REQ-362 preview hint is gated on the day having tasks, not only on the date", () => {
    const at = SRC.indexOf('data-cy="w-preview"');
    expect(at).toBeGreaterThan(-1);
    const before = SRC.slice(Math.max(0, at - 220), at);
    const cond = before.slice(before.lastIndexOf("{"));
    const previewDef = SRC.match(/const preview\s*=([^;]*);/)?.[1] ?? "";
    const counts = /dayCounts|liveTasks\.length|tasks\.length|Counts\.live/;
    // e.g. `{preview && dayCounts.live + dayCounts.deferred > 0 && (` — today it is
    // `{preview && (` with `const preview = !!nav?.preview;`
    expect(`${cond} | const preview =${previewDef}`).toMatch(counts);
  });

  test("REQ-1035 (q2-50): the empty state carries no sparkle (loading-like) icon", () => {
    const at = SRC.indexOf('data-cy="w-empty"');
    if (at === -1) return; // the card was dropped — the summary is the one empty message
    const card = SRC.slice(at, at + 300);
    expect(card).not.toMatch(/ICN\.sparkle/);
  });

  test("REQ-1035 (q2-50): a worker's empty body does not repeat the summary's 'none' message", () => {
    // the summary (REQ-196) already prints workerTodayKey(0, …) "No tasks this day" + "Nothing
    // scheduled."; the body's `worker.none` card "No tasks this day." says it a second time —
    // unless the summary is hidden on an empty day, the body must not render worker.none
    const bodyRendersNone = SRC.includes('t("worker.none")');
    const summaryAlways = /data-cy="w-summary"/.test(SRC) &&
      !/(liveTasks\.length|dayCounts)[^;{}]{0,80}&&\s*\(\s*<div\s+class=\{`summary/
        .test(SRC);
    expect(bodyRendersNone && summaryAlways).toBe(false);
  });
});
