/**
 * REQ-1146 (LOOP-007 q3, q3-77) — Browser Back steps back through the customer page's tabs.
 * Each tab click on /customers/<id> must ADD a history entry (pushState), and the island must
 * follow Back/Forward (a popstate listener that re-reads ?tab=). Today setTab() uses
 * replaceState, so Back skips every earlier tab and leaves the customer page.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(path.join(ROOT, "front-end/islands/CustomerWorkspace.tsx"), "utf8");

/** the body of `function setTab(...) { ... }` */
function setTabBody(): string {
  const start = src.indexOf("function setTab(");
  if (start < 0) throw new Error("setTab not found in CustomerWorkspace.tsx");
  let i = src.indexOf("{", start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error("setTab body not closed");
}

describe("REQ-1146 (LOOP-007 q3, q3-77) customer workspace tabs and browser history", () => {
  test("REQ-1146: a tab click adds a history entry (pushState), never replaces the current one", () => {
    const body = setTabBody();
    expect(body).toMatch(/history\.pushState\(/);
    expect(body).not.toMatch(/history\.replaceState\(/);
  });

  test("REQ-1146: the island follows Back/Forward — a popstate listener re-reads the tab from the URL", () => {
    expect(src).toMatch(/addEventListener\(\s*["']popstate["']/);
    expect(src).toMatch(/removeEventListener\(\s*["']popstate["']/);
    expect(src).toMatch(/setTabState\(\s*tabFromUrl\(\)\s*\)/);
  });
});
