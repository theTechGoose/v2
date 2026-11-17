/**
 * REQ-290 — demo cycle 1, issues m17 + p12: the dashboard coach overlay blurs nothing (the dark
 * SVG fill is the whole dimming, so the spotlighted sidebar item is sharp), the stage's mirror
 * frame neutralises any backdrop-filter so a scaled stage paints no ghost checklist, and the
 * dismiss hint is a capitalised sentence in both languages.
 */
import * as fs from "fs";
import * as path from "path";
import { MIRROR_SRCDOC } from "../../front-end/lib/demo-mode/mirror-replay";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-290 the coach overlay never uses a backdrop-filter (p12: the spotlighted item was blurred)", () => {
  test("AssistantCoachmark.tsx declares no backdrop-filter, prefixed or not", () => {
    const src = read("front-end/islands/AssistantCoachmark.tsx");
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/backdrop-filter/i);
  });
});

describe("REQ-290 the stage's mirror frame neutralises backdrop-filter (m17: a mirrored ghost checklist under the overlay)", () => {
  test("MIRROR_SRCDOC carries a stage-only `* { backdrop-filter:none !important }` rule in its head", () => {
    const head = MIRROR_SRCDOC.slice(0, MIRROR_SRCDOC.indexOf("</head>"));
    expect(head).toMatch(/<style>[^<]*<\/style>/);
    const style = head.match(/<style>([^<]*)<\/style>/)![1];
    expect(style).toMatch(
      /\*\s*\{[^}]*(?<![-\w])backdrop-filter\s*:\s*none\s*!important/,
    );
    expect(style).toMatch(
      /\*\s*\{[^}]*-webkit-backdrop-filter\s*:\s*none\s*!important/,
    );
  });
  test("the rule is allowed by the frame's CSP (style-src keeps 'unsafe-inline')", () => {
    expect(MIRROR_SRCDOC).toMatch(/style-src [^;"]*'unsafe-inline'/);
  });
});

describe("REQ-290 the dismiss hint is a sentence (p12: 'tap anywhere…' lowercase)", () => {
  const en = JSON.parse(read("lang/en.json"));
  const es = JSON.parse(read("lang/es.json"));
  test("en: 'Tap anywhere to dismiss'", () => {
    expect(en["assistantCoachmark.dismissHint"]).toBe(
      "Tap anywhere to dismiss",
    );
  });
  test("es: 'Toca en cualquier lugar para cerrar'", () => {
    expect(es["assistantCoachmark.dismissHint"]).toBe(
      "Toca en cualquier lugar para cerrar",
    );
  });
  test("en and es stay in sync on the coachmark keys", () => {
    const keys = (d: Record<string, string>) =>
      Object.keys(d).filter((k) => k.startsWith("assistantCoachmark.")).sort();
    expect(keys(es)).toEqual(keys(en));
  });
});
