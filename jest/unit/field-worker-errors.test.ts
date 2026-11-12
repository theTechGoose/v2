/**
 * REQ-421 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 2, issue m42 ("Duplicate worker phone error shown in
 * raw lowercase").
 *
 * RCA: POST /field/workers threw English developer strings ("a worker with that
 * cell already exists") and FieldWorkersPage's errMsg printed body.error word
 * for word — lowercase, English, the same in Spanish. The server now answers a
 * stable `code`; front-end/lib/field-worker-errors.ts maps it to a
 * field.wk.err.* key (en + es) and the box it belongs under. The server side is
 * backend/src/field/entrypoints/field.int.test.ts ("REQ-421 …"); the browser
 * proof is e2e/field-worker-errors/field-worker-errors.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { ApiError } from "../../front-end/lib/api";
import { workerError, zoneName } from "../../front-end/lib/field-worker-errors";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const refused = (status: number, body: unknown) =>
  new ApiError(status, body, `POST /field/workers failed: ${status}`);

describe("REQ-421 (demo m42) field worker refusals are worded, not raw", () => {
  test("a taken cell is worker_phone_taken → a worded message under the Phone box", () => {
    const e = workerError(
      refused(409, {
        status: 409,
        name: "FieldError",
        message: "that cell is already in use by a worker",
        code: "worker_phone_taken",
      }),
      "en",
    );
    expect(e).toEqual({ key: "field.wk.err.phoneTaken", field: "phone" });
  });

  test.each([
    ["name_required", "field.wk.err.nameRequired", "name"],
    ["name_too_long", "field.wk.err.nameTooLong", "name"],
    ["phone_10_digits", "field.wk.err.phone10", "phone"],
    ["pin_4_digits", "field.wk.err.pin4", "pin"],
    ["language_invalid", "field.wk.err.language", null],
  ])("%s → %s", (code, key, field) => {
    expect(workerError(refused(400, { code, message: "x" }), "en")).toEqual({
      key,
      field,
    });
  });

  test("a worker still covering zones names them, in the page's language", () => {
    const err = refused(409, {
      code: "worker_covers_zones",
      detail: { zones: ["Zona 1", "Zona 3"] },
    });
    expect(workerError(err, "en")).toEqual({
      key: "field.wk.err.coversZones",
      field: null,
      vars: { zones: "Zone 1, Zone 3" },
    });
    expect(workerError(err, "es").vars).toEqual({ zones: "Zona 1, Zona 3" });
    expect(zoneName("Zona 2", "en")).toBe("Zone 2");
  });

  test("the server's English never reaches the page: no code, an unknown code, or a network failure → the house fallback", () => {
    const fallback = { key: "field.common.error", field: null };
    expect(
      workerError(
        refused(409, { error: "a worker with that cell already exists" }),
        "es",
      ),
    ).toEqual(fallback);
    expect(workerError(refused(400, { code: "brand_new" }), "en")).toEqual(
      fallback,
    );
    expect(workerError(new TypeError("Failed to fetch"), "en")).toEqual(
      fallback,
    );
  });

  test("every field.wk.err.* key is in en AND es, worded, and the two differ", () => {
    const keys = [
      "phoneTaken",
      "nameRequired",
      "nameTooLong",
      "phone10",
      "pin4",
      "language",
      "coversZones",
    ].map((k) => `field.wk.err.${k}`);
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
      // a sentence: starts with a capital, not the server's lowercase string
      expect(en[k]).toMatch(/^[A-Z¿¡]/);
      expect(es[k]).toMatch(/^[A-ZÁÉÍÓÚÑ¿¡]/);
    }
    expect(en["field.wk.err.coversZones"]).toContain("{zones}");
    expect(es["field.wk.err.coversZones"]).toContain("{zones}");
    // neutral: the cell is unique across every account, so never "your crew"/"another account"
    expect(en["field.wk.err.phoneTaken"]).not.toMatch(/account|your crew/i);
    expect(es["field.wk.err.phoneTaken"]).not.toMatch(/cuenta|tu equipo/i);
  });

  test("FieldWorkersPage words errors through workerError and shows a field's error under its box", () => {
    const src = read("front-end/islands/FieldWorkersPage.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/field-worker-errors\.ts"/);
    expect(src).not.toMatch(/return b\.error/);
    expect(src).not.toMatch(/return b\.message/);
    expect(src).toMatch(/data-cy="wk-phone-error"/);
    // REQ-520 amended: the box's message (and aria-invalid) goes through boxErr, server refusal first
    expect(src).toMatch(/if \(addErr\?\.field === f\) return errMsg\(addErr\)/);
    expect(src).toMatch(/aria-invalid=\{phoneErr \? "true" : undefined\}/);
  });
});
