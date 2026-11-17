/**
 * REQ-553 — demo-loop cycle 4, issue m22: "Cash-flow chart filled solid black".
 *
 * PSideFlow's gradient stops were written React-style (`stopColor`,
 * `stopOpacity`). The front-end's JSX runtime is plain Preact (not compat):
 * SSR happens to print `stop-color`, but the client render sets a literal
 * `stopColor` attribute, which SVG ignores — the stops fall back to black at
 * full opacity and the url(#cfArea) area is painted solid black. /payments
 * renders after a client fetch, so the client output is the one users see.
 *
 * Rule: no island or component writes an SVG presentation attribute in
 * camelCase; use the SVG name (stop-color, stroke-width, …).
 */
import * as fs from "fs";
import * as path from "path";

const FE = path.resolve(__dirname, "../../front-end");
const DIRS = ["islands", "components"].map((d) => path.join(FE, d));

/** SVG presentation attributes whose camelCase spelling Preact does not map. */
const CAMEL_SVG_ATTRS = [
  "stopColor",
  "stopOpacity",
  "strokeWidth",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeOpacity",
  "strokeMiterlimit",
  "fillOpacity",
  "fillRule",
  "clipRule",
  "clipPath",
  "textAnchor",
  "dominantBaseline",
  "alignmentBaseline",
  "floodColor",
  "floodOpacity",
  "lightingColor",
  "vectorEffect",
  "shapeRendering",
  "colorInterpolationFilters",
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".tsx") ? [p] : [];
  });
}

describe("REQ-553 (cycle 4, m22) SVG presentation attributes are written kebab-case", () => {
  it("REQ-553 no island or component sets a camelCase SVG presentation attribute in JSX", () => {
    const re = new RegExp(`\\s(${CAMEL_SVG_ATTRS.join("|")})=`, "g");
    const offenders: string[] = [];
    for (const file of DIRS.flatMap(walk)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(re)) {
          offenders.push(`${path.relative(FE, file)}:${i + 1} ${m[1]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("REQ-553 the /payments cash-flow gradient stops use stop-color / stop-opacity", () => {
    const src = fs.readFileSync(
      path.join(FE, "islands/PaymentsPage.tsx"),
      "utf8",
    );
    const grad = src.match(
      /<linearGradient id="cfArea"[\s\S]*?<\/linearGradient>/,
    );
    expect(grad).not.toBeNull();
    const stops = grad![0].match(/<stop\b[^>]*>/g) ?? [];
    expect(stops.length).toBe(2);
    for (const s of stops) {
      expect(s).toMatch(/\sstop-color="#FF6B6B"/);
      expect(s).toMatch(/\sstop-opacity="[\d.]+"/);
    }
  });
});
