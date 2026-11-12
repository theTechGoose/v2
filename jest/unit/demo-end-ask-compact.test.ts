/**
 * REQ-548 (demo-loop cycle 4, issue p4-p3e) — End's question on the phone's compact pill never
 * shortens the guide's name. At 390 px the pill is one nowrap row, so when End turned into
 * "End for everyone? [Yes, end it] Keep going" the guide's name — the only item allowed to shrink
 * (`cut`) — was ellipsised to "A..". Now, while End asks on the compact pill, the pill wraps and
 * the question takes its own row (flex-basis:100%), as the opened details already do.
 */
import * as fs from "fs";
import * as path from "path";
import { pillWraps } from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-548 (cycle 4, p4-p3e) End's question gets its own row on the compact pill", () => {
  test("REQ-548 pillWraps: the compact pill wraps while End asks (and while opened); never otherwise", () => {
    expect(pillWraps({ compact: true, open: false, asking: true })).toBe(true);
    expect(pillWraps({ compact: true, open: true, asking: false })).toBe(true);
    expect(pillWraps({ compact: true, open: true, asking: true })).toBe(true);
    // REQ-228: a long name is cut, not wrapped — the resting pill stays one row
    expect(pillWraps({ compact: true, open: false, asking: false })).toBe(
      false,
    );
    // the desktop pill has room for the question on its one row
    expect(pillWraps({ compact: false, open: false, asking: true })).toBe(
      false,
    );
    expect(pillWraps({ compact: false, open: true, asking: false })).toBe(
      false,
    );
  });

  test("REQ-548 EndDemo tells its host when it asks, and can put its question on its own row", () => {
    const end = read("front-end/components/demo-mode/EndDemo.tsx");
    expect(end).toMatch(/onAsking\?:\s*\(asking: boolean\) => void/);
    expect(end).toMatch(/ownRow\?:\s*boolean/);
    // the host hears every change of the question, in the same update as the question itself
    expect(end).toMatch(
      /onChange:\s*\(next\)\s*=>\s*\{\s*setS\(next\);\s*onAskingRef\.current\?\.\(next\.asking\);?\s*\}/,
    );
    // on its own row: the whole width, and its words may wrap rather than push anything
    expect(end).toMatch(
      /data-cy="demo-end-ask"[\s\S]*?ownRow\s*\?\s*";flex-basis:100%;white-space:normal;min-width:0"/,
    );
  });

  test("REQ-548 the customer's pill wraps by pillWraps and gives End's question its own row when compact", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    expect(o).toMatch(/pillWraps\(\{\s*compact,\s*open,\s*asking\s*\}\)/);
    expect(o).toMatch(
      /<EndDemo\s+onEnd=\{end\}\s+ownRow=\{compact\}\s+onAsking=\{setAsking\}\s*\/>/,
    );
  });
});
