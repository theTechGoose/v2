/**
 * REQ-158 — cache busting: no route or component links a static stylesheet or script by a
 * bare path; each goes through Fresh's asset() so the URL carries the build id, and every file
 * that calls asset() imports it from fresh/runtime.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const FE = path.join(ROOT, "front-end");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const STATIC = new Set(
  fs.readdirSync(path.join(FE, "static")).filter((f) => /\.(css|js)$/.test(f)).map((f) => "/" + f),
);
const files = [...walk(path.join(FE, "routes")), ...walk(path.join(FE, "components")), ...walk(path.join(FE, "islands"))]
  .filter((f) => !f.includes("ui-breakdown"));

describe("REQ-158 cache busting", () => {
  test("no static .css/.js is linked by a bare path", () => {
    const bare: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js))"/g)) {
        if (STATIC.has(m[1])) bare.push(`${path.relative(ROOT, f)}: ${m[1]}`);
      }
    }
    expect(bare).toEqual([]);
  });

  test("every file that calls asset() imports it from fresh/runtime", () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (/\basset\(/.test(src) && !/import \{[^}]*\basset\b[^}]*\} from "fresh\/runtime"/.test(src)) {
        missing.push(path.relative(ROOT, f));
      }
    }
    expect(missing).toEqual([]);
  });

  test("the static files the pages link all exist (the busted URL must still resolve)", () => {
    const linked = new Set<string>();
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/asset\("(\/[^"]+\.(?:css|js))"\)/g)) linked.add(m[1]);
    }
    const dangling = [...linked].filter((p) => !STATIC.has(p));
    expect(dangling).toEqual([]);
    expect(linked.size).toBeGreaterThan(10);
  });
});
