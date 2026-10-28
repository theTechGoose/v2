/**
 * REQ-124 — Raphael, 2026-10-28: "i need to add this" — the Google tag
 * (gtag.js) snippet for the property G-RN3H6L5263 — "and make sure google
 * analytics works".
 *
 * The pure half: shared/google-tag/tag.ts owns the measurement id, which
 * loader loads (Google's on the real deploy, the app's own fake on the gate
 * and a dev box — REQ-318: the fakes, so test traffic never lands in the
 * property), and the inline snippet exactly as Google prescribes it. The app
 * shell carries it on EVERY page — site analytics, not the ad funnel.
 */
import * as fs from "fs";
import * as path from "path";
import {
  FAKE_GTAG_LOADER,
  GA_MEASUREMENT_ID,
  googleTagBootScript,
  googleTagConfig,
  googleTagLoaderSrc,
  REAL_GTAG_LOADER,
} from "../../shared/google-tag/tag";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-124 the Google tag (gtag.js) on every page", () => {
  it("REQ-124 the measurement id is the one Raphael pasted and the snippet is Google's: dataLayer, gtag(), js then config", () => {
    expect(GA_MEASUREMENT_ID).toBe("G-RN3H6L5263");
    const boot = googleTagBootScript(GA_MEASUREMENT_ID);
    expect(boot).toContain("window.dataLayer = window.dataLayer || [];");
    expect(boot).toContain("function gtag(){dataLayer.push(arguments);}");
    expect(boot).toContain("gtag('js', new Date());");
    expect(boot).toContain("gtag('config', 'G-RN3H6L5263');");
    expect(boot.indexOf("gtag('js'")).toBeLessThan(boot.indexOf("gtag('config'"));
    // nothing else runs in the snippet
    expect(boot).not.toMatch(/fetch\(|XMLHttpRequest|document\./);
  });

  it("REQ-124 Google's loader on the real deploy; the app's own fake on the gate and a dev box; the id rides the loader url either way", () => {
    expect(REAL_GTAG_LOADER).toBe("https://www.googletagmanager.com/gtag/js");
    expect(FAKE_GTAG_LOADER).toBe("/google-tag-fake.js");
    const real = googleTagConfig({ DENO_DEPLOY: "true" });
    expect(real).toEqual({
      mode: "real",
      id: GA_MEASUREMENT_ID,
      loader: REAL_GTAG_LOADER,
    });
    expect(googleTagConfig({ DENO_DEPLOYMENT_ID: "abc123" }).mode).toBe("real");
    expect(googleTagLoaderSrc(real)).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-RN3H6L5263",
    );
    const fake = googleTagConfig({});
    expect(fake).toEqual({
      mode: "fake",
      id: GA_MEASUREMENT_ID,
      loader: FAKE_GTAG_LOADER,
    });
    expect(googleTagConfig({ DENO_DEPLOY: "  " }).mode).toBe("fake");
    expect(googleTagLoaderSrc(fake)).toBe("/google-tag-fake.js?id=G-RN3H6L5263");
    // the fake exists, marks the document, and never talks to Google
    const fakeFile = "front-end/static/google-tag-fake.js";
    expect(fs.existsSync(path.join(ROOT, fakeFile))).toBe(true);
    const js = read(fakeFile);
    expect(js).toMatch(/data-google-tag-loaded/);
    expect(js).not.toMatch(/googletagmanager|google-analytics/);
  });

  it("REQ-124 the app shell carries it on every page: _app imports GoogleTag and renders it in the head with no path gate; the component renders the async loader and the snippet", () => {
    const app = read("front-end/routes/_app.tsx");
    expect(app).toMatch(
      /import GoogleTag from "\.\.\/components\/GoogleTag\.tsx"/,
    );
    expect(app).toMatch(/<GoogleTag \/>/);
    const comp = read("front-end/components/GoogleTag.tsx");
    expect(comp).toMatch(/googleTagLoaderSrc\(/);
    expect(comp).toMatch(/googleTagBootScript\(/);
    expect(comp).toMatch(/<script\s+async/);
    expect(comp).toMatch(/data-google-tag=\{CONFIG\.mode\}/);
    expect(comp).not.toMatch(/isPixelPage|path/);
  });
});
