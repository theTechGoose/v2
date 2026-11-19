/**
 * REQ-1062 (LOOP-007 q2, q2-51) — "'Still covers Zone A' error stays on the worker card after
 * unrelated actions".
 *
 * RCA: FieldWorkersPage keeps one `rowErr` slot for the page; REQ-1015's `askRemove` fills it
 * with the coversZones refusal, and only the worker row's own actions clear it. `reload()` (run
 * after saving/removing a crew or an absence), `openCrew` and `openAway` leave it, so the alert
 * stays under the worker after the owner moved on. Browser proof:
 * e2e/field-worker-errors/field-worker-errors.e2e.test.ts ("REQ-1062 …").
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/FieldWorkersPage.tsx"),
  "utf8",
);

/** the body of `function <name>(` / `async function <name>(` up to its closing `\n  }\n` */
function fnBody(name: string): string {
  const at = src.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`));
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("\n  }\n", at));
}

describe("REQ-1062 (LOOP-007 q2-51) the coversZones row error does not outlive the Remove click", () => {
  test.each(["reload", "openCrew", "openAway"])(
    "%s clears the worker row error (setRowErr(null))",
    (name) => {
      expect(fnBody(name)).toMatch(/setRowErr\(\s*null\s*\)/);
    },
  );
});
