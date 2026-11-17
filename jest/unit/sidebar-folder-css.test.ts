/**
 * REQ-738 — demo-loop cycle 5, issue p13: on /assistant the folder chevrons sat inline right
 * after the label ("Billing >") instead of right-aligned. REQ-156's `.nav-item__chev` rules lived
 * only in static/dashboard.css, and /assistant links assistant-page.css instead. The folder rules
 * now ride with the DashSidebar island itself (lib/sb-drawer.ts, like SB_DRAWER_CSS), so every
 * page that mounts the sidebar gets them, whatever stylesheet it links.
 */
import * as fs from "fs";
import * as path from "path";
import { SB_FOLDER_CSS } from "../../front-end/lib/sb-drawer";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** the declarations of the first `selector { … }` block in `css` (whitespace-collapsed) */
function block(css: string, selector: string): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`));
  return m?.[1].replace(/\s+/g, " ").trim();
}

describe("REQ-738 the sidebar's folder rules ride with the island (cycle 5, p13)", () => {
  test("the island's CSS right-aligns the chevron, hides it when collapsed, and quiets the Back row", () => {
    const chev = block(SB_FOLDER_CSS, ".nav-item__chev");
    expect(chev).toBeDefined();
    expect(chev).toMatch(/margin-left:\s*auto/);
    expect(chev).toMatch(/place-items:\s*center/);
    expect(block(SB_FOLDER_CSS, ".sb--collapsed .nav-item__chev")).toMatch(
      /display:\s*none/,
    );
    expect(block(SB_FOLDER_CSS, ".nav-item--back")).toMatch(
      /font-size:\s*13px/,
    );
  });

  test("DashSidebar renders the folder CSS in its own <style>", () => {
    const src = read("front-end/islands/DashSidebar.tsx");
    expect(src).toMatch(
      /import\s*\{[^}]*SB_FOLDER_CSS[^}]*\}\s*from\s*"\.\.\/lib\/sb-drawer\.ts"/,
    );
    expect(src).toMatch(/<style>\{SB_FOLDER_CSS\}<\/style>/);
  });

  test("every route that mounts DashSidebar gets the chevron rule — none depends on dashboard.css for it", () => {
    const routesDir = path.join(ROOT, "front-end/routes");
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
      );
    const mounting = walk(routesDir).filter((f) =>
      /\.tsx$/.test(f) && /<DashSidebar\b/.test(fs.readFileSync(f, "utf8"))
    );
    expect(mounting.length).toBeGreaterThan(0);
    expect(mounting.map((f) => path.relative(ROOT, f))).toContain(
      "front-end/routes/assistant/index.tsx",
    );
    // one source of truth: the page stylesheets no longer carry their own copy
    expect(read("front-end/static/dashboard.css")).not.toMatch(
      /\.nav-item__chev\s*\{/,
    );
    expect(read("front-end/static/assistant-page.css")).not.toMatch(
      /\.nav-item__chev\s*\{/,
    );
  });
});
