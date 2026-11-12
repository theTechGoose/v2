/**
 * REQ-181 — the impersonation banner makes room for itself: it publishes its height as
 * `--banner-h` on <html> and pads the body, and every viewport-height shell subtracts it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  BANNER_VAR,
  clearBannerRoom,
  setBannerRoom,
} from "../../front-end/lib/banner-room";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function fakeStyle() {
  const vars = new Map<string, string>();
  return {
    vars,
    style: {
      setProperty: (k: string, v: string) => void vars.set(k, v),
      removeProperty: (k: string) => void vars.delete(k),
      getPropertyValue: (k: string) => vars.get(k) ?? "",
    },
  };
}

describe("REQ-181 the banner's room", () => {
  test("setBannerRoom publishes --banner-h on the root and pads the body by it; clearBannerRoom releases both", () => {
    const root = fakeStyle();
    const body = fakeStyle();
    setBannerRoom(root.style, body.style, 46);
    expect(BANNER_VAR).toBe("--banner-h");
    expect(root.vars.get("--banner-h")).toBe("46px");
    expect(body.vars.get("padding-top")).toBe("var(--banner-h, 0px)");
    setBannerRoom(root.style, body.style, 63.5); // the banner wrapped on a narrow window
    expect(root.vars.get("--banner-h")).toBe("64px");
    clearBannerRoom(root.style, body.style);
    expect(root.vars.has("--banner-h")).toBe(false);
    expect(body.vars.has("padding-top")).toBe(false);
  });

  test("a zero or negative height clears the room instead of publishing 0px", () => {
    const root = fakeStyle();
    const body = fakeStyle();
    setBannerRoom(root.style, body.style, 46);
    setBannerRoom(root.style, body.style, 0);
    expect(root.vars.has("--banner-h")).toBe(false);
    expect(body.vars.has("padding-top")).toBe(false);
  });

  test("the banner island measures itself and publishes through banner-room, and is tagged for the stories", () => {
    const src = read("front-end/islands/ImpersonationBanner.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/banner-room\.ts"/);
    expect(src).toMatch(/setBannerRoom\(/);
    expect(src).toMatch(/clearBannerRoom\(/);
    expect(src).toMatch(/ResizeObserver/);
    // REQ-269: the bar's markup lives in its (translated) view component
    expect(src).toMatch(/<ImpersonationBannerView\b/);
    expect(read("front-end/components/ImpersonationBannerView.tsx")).toMatch(
      /data-cy="imp-banner"/,
    );
  });

  test("every viewport-height shell subtracts --banner-h", () => {
    const dash = read("front-end/static/dashboard.css");
    const asst = read("front-end/static/assistant-page.css");
    const sub =
      /height:\s*calc\(var\(--app-vh,\s*100dvh\)\s*-\s*var\(--banner-h,\s*0px\)\)/g;
    expect(dash.match(sub)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(asst.match(sub)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // no shell left on the bare viewport height
    expect(dash).not.toMatch(/height:\s*var\(--app-vh,\s*100dvh\);/);
    expect(asst).not.toMatch(/height:\s*var\(--app-vh,\s*100dvh\);/);
    // the phone chat overlay starts under the banner and is shorter by it
    expect(asst).toMatch(/top:\s*var\(--banner-h,\s*0px\);/);
    expect(asst).toMatch(
      /height:\s*calc\(var\(--vvh,\s*100dvh\)\s*-\s*var\(--banner-h,\s*0px\)\)/,
    );
    // the phone's sticky top bar pins under the banner, not under it
    expect(dash).toMatch(
      /position:\s*sticky;\s*top:\s*var\(--banner-h,\s*0px\);/,
    );
  });

  test("REQ-181 AMENDMENT: the mobile sidebar drawer is fixed too, so it starts under the banner", () => {
    const css = read("front-end/static/dashboard.css");
    const mobile = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(mobile).toMatch(/\.sb\s*\{[^}]*top:\s*var\(--banner-h,\s*0px\)/s);
    expect(css).not.toMatch(/pm-banner-h/);
  });
});
