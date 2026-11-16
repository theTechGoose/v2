/**
 * REQ-055 — the settings page lost its stylesheet when a second <link rel="stylesheet"> was
 * added to its <Head>: Fresh's Head keeps ONE element per tag unless each carries its own
 * `key`, so the page rendered with /plan-cards.css alone and no /dashboard.css. The repo's
 * pattern is `key="css-<name>"` on every stylesheet link; this pins it for every route.
 */
import * as fs from "fs";
import * as path from "path";

const ROUTES = path.resolve(__dirname, "../../front-end/routes");
const FRONT = path.resolve(__dirname, "../../front-end");
// REQ-858 (dm4 m7 + setup-4) — a component or island renders <Head> as much as a route does
// (AdminGuideGate is the /admin gate's whole page), so the guard reads all three.
const DIRS = ["routes", "components", "islands"].map((d) => path.join(FRONT, d));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".tsx") ? [p] : [];
  });
}

describe("REQ-055 every stylesheet link in a route's Head carries its own key", () => {
  it("REQ-055 a route with several stylesheet links keys each one, or Fresh keeps only the last", () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap(walk)) {
      const src = fs.readFileSync(file, "utf8");
      const links = src.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) ?? [];
      if (links.length < 2) continue;
      for (const link of links) {
        if (!/\bkey="[^"]+"/.test(link)) offenders.push(`${path.relative(FRONT, file)}: ${link}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("REQ-858 (dm4 m7) the app shell's own stylesheet links are keyed, so no page's lone unkeyed link swallows them", () => {
    // Fresh's head cacheKey for <link> leaves out href: an unkeyed shell link and any page's
    // unkeyed <Head> link share "link::stylesheet", and the shell's is swapped for the page's.
    const src = fs.readFileSync(path.join(ROUTES, "_app.tsx"), "utf8");
    const links = src.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) ?? [];
    expect(links.some((l) => l.includes("/motion.css"))).toBe(true);
    expect(links.filter((l) => !/\bkey="[^"]+"/.test(l))).toEqual([]);
  });

  it("REQ-055 the settings and welcome routes link /plan-cards.css beside their own sheet", () => {
    for (const rel of ["settings/index.tsx", "welcome.tsx"]) {
      const src = fs.readFileSync(path.join(ROUTES, rel), "utf8");
      const links = src.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) ?? [];
      expect(links.some((l) => l.includes("/plan-cards.css"))).toBe(true); // REQ-158: href={asset("/plan-cards.css")}
      expect(links.length).toBe(2);
    }
  });
});
