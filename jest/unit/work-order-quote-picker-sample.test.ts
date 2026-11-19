/**
 * REQ-1058 (LOOP-007 cycle 2, q2-47) — the New work order Quote picker never offers the
 * onboarding sample quote. Amends REQ-210, follows REQ-360 ("the onboarding sample quote never
 * passes for real data") and REQ-474 (the New invoice quote picker already drops `isSample`).
 *
 * QA, /work-orders → New work order → Quote: the options were "No quote" and
 * "#43DE4E2D · Paver Patio Installation" — the sample, unbadged, under its raw hex id (REQ-256
 * gives it no Q- number, so `label()` falls back to `#<id prefix>`).
 *
 * The test runs the modal's own `const quotes = …` statement (front-end/islands/WorkOrdersPage.tsx,
 * NewWorkOrderModal) over [sample, real] — with any helper it imports from shared/ or
 * front-end/lib resolved for real — so a fix that moves the rule into a shared helper still runs.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const ISLAND = path.join(ROOT, "front-end/islands/WorkOrdersPage.tsx");

/** the modal's `const quotes = <expr>;` statement, from `const quotes =` to the `;` that ends it */
function quotesExpr(src: string): string {
  const modal = src.slice(src.indexOf("function NewWorkOrderModal("));
  const at = modal.indexOf("const quotes =");
  if (at < 0) throw new Error("NewWorkOrderModal has no `const quotes =` statement");
  let depth = 0;
  for (let i = at + "const quotes =".length; i < modal.length; i++) {
    const c = modal[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) return modal.slice(at + "const quotes =".length, i);
  }
  throw new Error("unterminated `const quotes =` statement");
}

/** named imports of the island that come from shared/ or front-end/lib (pure modules) */
function pureImports(src: string): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  const re = /import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  for (const m of src.matchAll(re)) {
    const spec = m[2];
    // relative imports of pure modules only (import-map `#` aliases are not resolvable from jest)
    if (!spec.startsWith(".") || !/(^|\/)(shared|lib)\//.test(spec)) continue;
    let mod: Record<string, unknown>;
    try {
      mod = require(path.resolve(path.dirname(ISLAND), spec.replace(/\.tsx?$/, "")));
    } catch {
      continue;
    }
    for (const raw of m[1].split(",")) {
      const name = raw.replace(/^\s*type\s+/, "").trim();
      if (!name || /^type\s/.test(raw.trim())) continue;
      const [orig, alias] = name.split(/\s+as\s+/);
      if (orig in mod) scope[(alias ?? orig).trim()] = mod[orig.trim()];
    }
  }
  return scope;
}

type Q = { id: string; customerId?: string; isSample?: boolean; number?: string; jobName?: string };

function pickerQuotes(quotes: Q[], customerId: string): Q[] {
  const src = fs.readFileSync(ISLAND, "utf8");
  const expr = quotesExpr(src);
  const scope = { ...pureImports(src), lists: { quotes, invoices: [], customers: [] }, customerId };
  const names = Object.keys(scope);
  // strip TS-only syntax the expression might carry (`as X`, `(q: Quote)`)
  const js = expr.replace(/\s+as\s+[A-Za-z_][\w.<>[\]]*/g, "").replace(/\((\w+)\s*:\s*[\w.<>[\]]+\)/g, "($1)");
  // deno-lint-ignore no-new-func
  return new Function(...names, `return (${js});`)(...names.map((n) => (scope as Record<string, unknown>)[n])) as Q[];
}

const SAMPLE: Q = { id: "43de4e2d-1111-4222-8333-944445555666", isSample: true, jobName: "Paver Patio Installation" };
const REAL: Q = { id: "a1b2c3d4-0000-4000-8000-000000000001", customerId: "c-tom", number: "Q-001", jobName: "Roof Leak Repair" };
const OTHER: Q = { id: "b1b2c3d4-0000-4000-8000-000000000002", customerId: "c-ann", number: "Q-002", jobName: "Gutter Clean" };

describe("REQ-1058 (LOOP-007 q2-47) New work order Quote picker never offers the onboarding sample", () => {
  test("REQ-1058: with no customer picked, the sample quote is not an option (real quotes are)", () => {
    const ids = pickerQuotes([SAMPLE, REAL, OTHER], "").map((q) => q.id);
    expect(ids).not.toContain(SAMPLE.id);
    expect(ids).toEqual([REAL.id, OTHER.id]);
  });

  test("REQ-1058: a sample that carries the picked customer's id is still not an option", () => {
    const ids = pickerQuotes([{ ...SAMPLE, customerId: "c-tom" }, REAL, OTHER], "c-tom").map((q) => q.id);
    expect(ids).toEqual([REAL.id]);
  });

  test("REQ-1058: picking a customer still narrows the list to their quotes", () => {
    expect(pickerQuotes([SAMPLE, REAL, OTHER], "c-ann").map((q) => q.id)).toEqual([OTHER.id]);
  });
});
