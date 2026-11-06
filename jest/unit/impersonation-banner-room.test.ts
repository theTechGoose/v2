/**
 * REQ-184 — the impersonation banner makes room for itself: it sits in the page's flow (sticky at
 * the top, not fixed over the content), publishes its height as --pm-banner-h, and the dashboard
 * shell, its mobile top bar and the mobile sidebar drawer all start below it — so the staff never
 * loses the top of the customer's page under the red bar.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-184 — the banner makes room for itself", () => {
  const banner = read("front-end/islands/ImpersonationBanner.tsx");
  const css = read("front-end/static/dashboard.css");

  test("the banner is in the flow (sticky), not fixed over the page", () => {
    expect(banner).toMatch(/position:sticky;top:0/);
    expect(banner).not.toMatch(/position:fixed/);
  });

  test("it publishes its height as --pm-banner-h while shown and clears it when gone", () => {
    expect(banner).toMatch(/setProperty\(\s*"--pm-banner-h"/);
    expect(banner).toMatch(/ResizeObserver/);
    expect(banner).toMatch(/removeProperty\(\s*"--pm-banner-h"\s*\)/);
  });

  test("the shell, the mobile top bar and the mobile sidebar drawer start below it", () => {
    expect(css).toMatch(
      /\.app\s*\{[^}]*height:\s*calc\(var\(--app-vh,\s*100dvh\)\s*-\s*var\(--pm-banner-h,\s*0px\)\)/s,
    );
    const mobile = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(mobile).toMatch(/\.sb\s*\{[^}]*top:\s*var\(--pm-banner-h,\s*0px\)/s);
    expect(mobile).toMatch(
      /\.topbar\s*\{[^}]*top:\s*var\(--pm-banner-h,\s*0px\)/s,
    );
  });
});
