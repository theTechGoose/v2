/**
 * REQ-1165 (LOOP-007 cycle 3, q3-98) — a worker whose access the owner removed
 * ("Quitar acceso") signs in on /worker with the right cell and PIN and is told
 * "Trabajador o PIN incorrecto." Two faults:
 *  - the copy names a "worker" field, but the form asks for the cell
 *    (worker.cell "Tu celular" / "Your cell");
 *  - there is no removed-access state: the server 401s exactly like a typo and
 *    the island maps every 401 to worker.bad.
 * The server half is backend/src/field/entrypoints/field.int.test.ts
 * ("REQ-1165 …"); the browser proof is
 * e2e/field-worker-errors/field-worker-errors.e2e.test.ts ("REQ-1165 …").
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-1165 (q3-98) worker sign-in errors name the cell and tell a removed worker so", () => {
  test("REQ-1165 worker.bad names the cell (the form's field), not the worker", () => {
    expect(en["worker.bad"]).toBe("Wrong cell or PIN.");
    expect(es["worker.bad"]).toBe("Celular o PIN incorrecto.");
    expect(en["worker.bad"]).not.toMatch(/worker/i);
    expect(es["worker.bad"]).not.toMatch(/trabajador/i);
  });

  test("REQ-1165 worker.removed tells the worker the access was removed, in en and es", () => {
    expect(en["worker.removed"]).toBe(
      "Your access was removed. Ask your office.",
    );
    expect(es["worker.removed"]).toBe(
      "Tu acceso fue quitado. Habla con tu oficina.",
    );
  });

  test("REQ-1165 the island maps a 403 worker_removed sign-in refusal to worker.removed, before the generic 401 → worker.bad", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    const start = src.indexOf("function login(");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("function logout(", start));
    expect(body).toMatch(/worker_removed/);
    expect(body).toMatch(/403/);
    expect(body).toMatch(/t\("worker\.removed"\)/);
    expect(body.indexOf("worker.removed")).toBeLessThan(
      body.indexOf("worker.bad"),
    );
  });
});
