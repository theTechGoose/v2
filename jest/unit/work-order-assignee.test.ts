/**
 * REQ-1022 (LOOP-007 q2-12) — /work-orders and the WO page show the assignee marked out on the
 * WO's day with who covers, or flagged out when nobody does; otherwise the stored assignee.
 */
import { assigneeLabel } from "../../front-end/lib/work-order-assignee";
import * as fs from "fs";
import * as path from "path";

const lang = (l: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../lang", `${l}.json`), "utf8")) as Record<string, string>;
const tFor = (l: string) => (key: string, params: Record<string, string> = {}) =>
  (lang(l)[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);

describe("REQ-1022 assigneeLabel", () => {
  const t = tFor("en");
  it("REQ-1022 covered: names the absent assignee and the cover", () => {
    expect(assigneeLabel({ assignee: "Jake Fowler", coverAssignee: "Miguel Torres" }, t))
      .toBe("Jake Fowler → covered by Miguel Torres");
    expect(assigneeLabel({ assignee: "Jake Fowler", coverAssignee: "Miguel Torres" }, tFor("es")))
      .toBe("Jake Fowler → lo cubre Miguel Torres");
  });
  it("REQ-1022 out with nobody covering (defer / skip / cover out too): flagged", () => {
    for (const assigneeOut of ["defer", "skip", "uncovered"] as const) {
      expect(assigneeLabel({ assignee: "Jake Fowler", assigneeOut }, t)).toMatch(/^Jake Fowler is out that day/);
    }
  });
  it("REQ-1022 not out: the stored assignee, or nothing", () => {
    expect(assigneeLabel({ assignee: "Jake Fowler" }, t)).toBe("Jake Fowler");
    expect(assigneeLabel({}, t)).toBeUndefined();
  });
});
