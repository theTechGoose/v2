/**
 * REQ-150 — the worker's PIN field has an eye that shows and hides the PIN: the two labels exist
 * in both languages, the island reads them, and the field is a password field until the eye is
 * pressed (the `type` follows the toggle's state).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-150 the worker's PIN eye", () => {
  test("the two labels exist in both languages and differ", () => {
    expect(en["worker.showPin"]).toBe("Show PIN");
    expect(en["worker.hidePin"]).toBe("Hide PIN");
    expect(es["worker.showPin"]).toBe("Mostrar PIN");
    expect(es["worker.hidePin"]).toBe("Ocultar PIN");
  });

  test("the island reads them on a pressed button inside the field, and the field's type follows it", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    expect(src).toMatch(/t\("worker\.showPin"\)/);
    expect(src).toMatch(/t\("worker\.hidePin"\)/);
    expect(src).toMatch(/data-cy="w-pin-eye"/);
    expect(src).toMatch(/aria-pressed=\{showPin\}/);
    expect(src).toMatch(/type=\{showPin \? "text" : "password"\}/);
    expect(src).toMatch(/ICN\.eye/);
  });
});
