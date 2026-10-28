/**
 * REQ-125 — Crazy Egg's request (JL Neilsen, support@crazyegg.com, forwarded
 * by Raphael 2026-10-28): "install the Crazy Egg tracking script on
 * https://documonster.com/landing2 … Paste the JavaScript tag into the <head>".
 *
 * The pure half: shared/crazy-egg/script.ts owns the page (/landing2 only —
 * the page Crazy Egg was asked to track), the real script url verbatim, and
 * the fake the gate and a dev box load instead (REQ-318: the fakes), so a
 * test run never records a session in the account.
 */
import * as fs from "fs";
import * as path from "path";
import {
  crazyEggConfig,
  CRAZY_EGG_SCRIPT,
  FAKE_CRAZY_EGG_SCRIPT,
  isCrazyEggPage,
} from "../../shared/crazy-egg/script";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-125 the Crazy Egg tracking script on /landing2", () => {
  it("REQ-125 the script is Crazy Egg's, verbatim: //script.crazyegg.com/pages/scripts/0110/3101.js, async", () => {
    expect(CRAZY_EGG_SCRIPT).toBe("//script.crazyegg.com/pages/scripts/0110/3101.js");
  });

  it("REQ-125 /landing2 and nothing else — not the front page, /landing, the wizard or the dashboard", () => {
    expect(isCrazyEggPage("/landing2")).toBe(true);
    expect(isCrazyEggPage("/landing2/")).toBe(true);
    for (const p of ["/", "/landing", "/landing2x", "/welcome", "/dashboard", "/login", "/landing2/other"]) {
      expect(isCrazyEggPage(p)).toBe(false);
    }
  });

  it("REQ-125 Crazy Egg's script on the real deploy; the app's own fake on the gate and a dev box", () => {
    expect(crazyEggConfig({ DENO_DEPLOY: "true" })).toEqual({ mode: "real", src: CRAZY_EGG_SCRIPT });
    expect(crazyEggConfig({ DENO_DEPLOYMENT_ID: "abc" }).mode).toBe("real");
    expect(crazyEggConfig({})).toEqual({ mode: "fake", src: FAKE_CRAZY_EGG_SCRIPT });
    expect(crazyEggConfig({ DENO_DEPLOY: " " }).mode).toBe("fake");
    expect(FAKE_CRAZY_EGG_SCRIPT).toBe("/crazy-egg-fake.js");
    const fakeFile = "front-end/static/crazy-egg-fake.js";
    expect(fs.existsSync(path.join(ROOT, fakeFile))).toBe(true);
    const js = read(fakeFile);
    expect(js).toMatch(/data-crazy-egg-loaded/);
    expect(js).not.toMatch(/crazyegg\.com/);
  });

  it("REQ-125 the app shell carries it, gated on the path: _app renders <CrazyEgg path={url.pathname} /> in the head; the component renders the async script with the mode on it", () => {
    const app = read("front-end/routes/_app.tsx");
    expect(app).toMatch(/import CrazyEgg from "\.\.\/components\/CrazyEgg\.tsx"/);
    expect(app).toMatch(/<CrazyEgg path=\{url\.pathname\} \/>/);
    const comp = read("front-end/components/CrazyEgg.tsx");
    expect(comp).toMatch(/isCrazyEggPage\(path\)/);
    expect(comp).toMatch(/<script\s+async/);
    expect(comp).toMatch(/data-crazy-egg=\{CONFIG\.mode\}/);
    expect(comp).toMatch(/type="text\/javascript"/);
  });
});
