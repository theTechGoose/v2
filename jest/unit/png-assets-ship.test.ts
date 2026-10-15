/**
 * REQ-075 — Raphael, 2026-10-15: "okay deploy it to prod." On prod and on every routed preview
 * every PNG under front-end/static answered 404 (the login card's /logo-monster.png, /logo.png,
 * /favicon.png) while /logo.svg and /favicon.ico served, and the same tree served them all
 * locally. The repo's .gitignore carried `*.png`; Deno Deploy packages the built tree by the
 * repo's ignore rules, so the tracked PNGs never left the build. A preview deployed without
 * that rule served every PNG (revision 4v6sw627r1bh).
 *
 * These pin that no ignore rule covers a tracked PNG and that every PNG a page references is a
 * tracked file under front-end/static.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const STATIC = join(ROOT, "front-end", "static");

function tracked(pattern: string): string[] {
  return execFileSync("git", ["ls-files", "--", pattern], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("REQ-075 the PNG assets ship: no ignore rule covers a tracked PNG", () => {
  const pngs = tracked("front-end/static/*.png");

  test("the static PNGs are tracked", () => {
    expect(pngs).toEqual(expect.arrayContaining([
      "front-end/static/logo-monster.png",
      "front-end/static/logo.png",
      "front-end/static/favicon.png",
    ]));
  });

  test("git check-ignore matches none of them — Deno Deploy packages by the repo's ignore rules", () => {
    // exit 1 = nothing is ignored; exit 0 lists the ignored paths
    const r = spawnSync("git", ["check-ignore", "--no-index", ...pngs], { cwd: ROOT, encoding: "utf8" });
    expect({ ignored: r.stdout.trim(), status: r.status }).toEqual({ ignored: "", status: 1 });
  });

  test("every PNG a page references is a tracked file under front-end/static", () => {
    const refs = new Set<string>();
    for (const file of walk(join(ROOT, "front-end", "routes")).concat(walk(join(ROOT, "front-end", "components")))) {
      for (const m of readFileSync(file, "utf8").matchAll(/["'](\/[\w./-]+\.png)["']/g)) refs.add(m[1]);
    }
    expect(refs.size).toBeGreaterThan(0);
    const missing = [...refs].filter((ref) => !existsSync(join(STATIC, ref.slice(1))) || !pngs.includes(`front-end/static${ref}`));
    expect(missing).toEqual([]);
  });
});
