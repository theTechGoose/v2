/**
 * REQ-183 — Raphael, 2026-11-05: "install this" — Emily Keck's Google Tag
 * Manager install instructions (the container snippet "as high as possible
 * inside <head>, on every page", the noscript iframe "right after the
 * opening <body> tag, on every page"). The thread carries the placeholder
 * GTM-XXXXXXX, so the container id comes from GTM_ID.
 *
 * The pure half: shared/google-tag-manager/gtm.ts owns which id (GTM_ID,
 * validated), which loader (Google's on the real deploy with an id, nothing
 * on the real deploy without one, the app's own fake on the gate and a dev
 * box — REQ-318: the fakes) and the snippet exactly as Google prescribes it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  FAKE_GTM_ID,
  FAKE_GTM_LOADER,
  gtmConfig,
  gtmHeadScript,
  gtmNoscriptSrc,
  isGtmId,
  REAL_GTM_LOADER,
} from "../../shared/google-tag-manager/gtm";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const GOOGLE_SNIPPET =
  "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\n" +
  "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\n" +
  "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n" +
  "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n" +
  "})(window,document,'script','dataLayer','GTM-ABC1234');";

describe("REQ-183 Google Tag Manager on every page, behind GTM_ID", () => {
  it("REQ-183 the snippet is Google's, verbatim, with the container id and the loader in it; the noscript iframe url", () => {
    const real = gtmConfig({ GTM_ID: "GTM-ABC1234", DENO_DEPLOY: "true" })!;
    expect(gtmHeadScript(real)).toBe(GOOGLE_SNIPPET);
    const fake = gtmConfig({ GTM_ID: "GTM-ABC1234" })!;
    expect(gtmHeadScript(fake)).toBe(
      GOOGLE_SNIPPET.replace(
        "https://www.googletagmanager.com/gtm.js",
        "/gtm-fake.js",
      ),
    );
    expect(gtmNoscriptSrc("GTM-ABC1234")).toBe(
      "https://www.googletagmanager.com/ns.html?id=GTM-ABC1234",
    );
  });

  it("REQ-183 which loader: Google's on the real deploy with GTM_ID, nothing on the real deploy without it, the fake elsewhere; an id that is not GTM-… is unset", () => {
    expect(REAL_GTM_LOADER).toBe("https://www.googletagmanager.com/gtm.js");
    expect(FAKE_GTM_LOADER).toBe("/gtm-fake.js");
    expect(FAKE_GTM_ID).toBe("GTM-FAKE000");
    expect(gtmConfig({ GTM_ID: "GTM-ABC1234", DENO_DEPLOY: "true" })).toEqual({
      mode: "real",
      id: "GTM-ABC1234",
      loader: REAL_GTM_LOADER,
    });
    expect(gtmConfig({ GTM_ID: " GTM-ABC1234 ", DENO_DEPLOYMENT_ID: "x1" }))
      .toEqual({
        mode: "real",
        id: "GTM-ABC1234",
        loader: REAL_GTM_LOADER,
      });
    // the real deploy without an id: nothing — never a placeholder in prod
    expect(gtmConfig({ DENO_DEPLOY: "true" })).toBeNull();
    expect(gtmConfig({ GTM_ID: "", DENO_DEPLOY: "true" })).toBeNull();
    expect(gtmConfig({ GTM_ID: "GTM-XXXXXXX", DENO_DEPLOY: "true" }))
      .toBeNull();
    // the gate and a dev box: the fake, under the id when set, the placeholder when not
    expect(gtmConfig({})).toEqual({
      mode: "fake",
      id: FAKE_GTM_ID,
      loader: FAKE_GTM_LOADER,
    });
    expect(gtmConfig({ GTM_ID: "GTM-ABC1234" })).toEqual({
      mode: "fake",
      id: "GTM-ABC1234",
      loader: FAKE_GTM_LOADER,
    });
    expect(gtmConfig({ DENO_DEPLOY: "  " })!.mode).toBe("fake");
    // validation: GTM- plus letters/digits, nothing that could reach the inline script
    expect(isGtmId("GTM-ABC1234")).toBe(true);
    expect(isGtmId("GTM-5X")).toBe(true);
    for (
      const bad of [
        "GTM-XXXXXXX",
        "G-RN3H6L5263",
        "GTM-",
        "gtm-abc1234",
        "GTM-AB'); alert(1);//",
        "",
        "GTM-ABC 123",
      ]
    ) {
      expect(isGtmId(bad)).toBe(false);
    }
    expect(gtmConfig({ GTM_ID: "GTM-AB'); alert(1);//" })).toEqual({
      mode: "fake",
      id: FAKE_GTM_ID,
      loader: FAKE_GTM_LOADER,
    });
  });

  it("REQ-183 the app shell carries it on every page: first script in the head, the noscript first in the body; the fake exists and never talks to Google", () => {
    const app = read("front-end/routes/_app.tsx");
    expect(app).toMatch(
      /import GoogleTagManager, \{\s*GoogleTagManagerNoscript,?\s*\} from "\.\.\/components\/GoogleTagManager\.tsx"/,
    );
    // as high as possible inside <head>: right after the charset meta, before every other tag
    expect(app).toMatch(
      /<head>\s*<meta charset="utf-8" \/>\s*(\{[\s\S]*?\}\s*)?<GoogleTagManager \/>/,
    );
    // right after the opening <body> tag
    expect(app).toMatch(
      /<body>\s*(\{[\s\S]*?\}\s*)?<GoogleTagManagerNoscript \/>/,
    );
    const comp = read("front-end/components/GoogleTagManager.tsx");
    expect(comp).toMatch(/gtmHeadScript\(/);
    expect(comp).toMatch(/gtmNoscriptSrc\(/);
    expect(comp).toMatch(/data-gtm=\{CONFIG\.mode\}/);
    expect(comp).toMatch(/<noscript>\s*<iframe/);
    expect(comp).toMatch(/height="0"\s+width="0"/);
    expect(comp).not.toMatch(/isPixelPage|path/);
    expect(read(".env.example")).toMatch(/^GTM_ID=/m);
    const fakeFile = "front-end/static/gtm-fake.js";
    expect(fs.existsSync(path.join(ROOT, fakeFile))).toBe(true);
    const js = read(fakeFile);
    expect(js).toMatch(/data-gtm-loaded/);
    expect(js).not.toMatch(/googletagmanager|google-analytics/);
  });
});
