/**
 * REQ-529 (demo-loop cycle 3, issues p8-pair2-c + p8-pair8-b) — the worker card's "Covers / Cubre"
 * row: the label never runs into its value (the `.sub__items div` row has a gap, baseline
 * alignment, and a right-aligned value), and the no-zone value reads as a value after the label
 * ("Covers no zone yet — …"), not as a capitalised standalone sentence.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>:]/g, "\\$&").replace(
    /\s+/g,
    "\\s*",
  );
  const m = css.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`, "m"));
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const d of m[1].split(";")) {
    const [k, ...v] = d.split(":");
    if (k.trim()) out[k.trim()] = v.join(":").trim();
  }
  return out;
}

describe("REQ-529 (demo cycle 3, p8-pair2-c / p8-pair8-b) the worker card's Covers row", () => {
  const css = read("front-end/static/field.css");

  test("the label/value row keeps a gap between them and aligns on the baseline", () => {
    const row = rule(css, ".sub__items div");
    expect(row["justify-content"]).toBe("space-between");
    expect(row["gap"]).toBe("12px");
    expect(row["align-items"]).toBe("baseline");
  });

  test("the value side is right-aligned so a wrapped value hugs the right edge", () => {
    const value = rule(css, ".sub__items div > :last-child:not(:first-child)");
    expect(value["text-align"]).toBe("right");
  });

  test("coversNone reads as a value after 'Covers' / 'Cubre' — lowercase, no full stop, en + es", () => {
    expect(en["field.wk.covers"]).toBe("Covers");
    expect(es["field.wk.covers"]).toBe("Cubre");
    expect(en["field.wk.coversNone"]).toBe(
      "no area for repeat visits yet — assign one in Assignments",
    );
    expect(es["field.wk.coversNone"]).toBe(
      "ningún área de visitas repetidas aún — asígnale una en Asignaciones",
    );
    for (const v of [en["field.wk.coversNone"], es["field.wk.coversNone"]]) {
      expect(v[0]).toBe(v[0].toLowerCase());
      expect(v.endsWith(".")).toBe(false);
    }
  });

  test("the island renders the label and the value as the row's two children", () => {
    const src = read("front-end/islands/FieldWorkersPage.tsx");
    expect(src).toMatch(
      /<div class="sub__items">\s*<div>\s*<span>\{t\("field\.wk\.covers"\)\}<\/span>\s*<span style="[^"]*justify-content:flex-end/,
    );
  });
});
