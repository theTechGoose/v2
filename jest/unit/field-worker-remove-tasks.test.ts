/**
 * REQ-1162 (LOOP-007 q3, q3-94) — "Removing a worker strands their upcoming tasks; the task
 * shows no worker but 'ASSIGNED'". Amends REQ-421/REQ-1015: DELETE /field/workers/:id now
 * refuses with 409 `worker_has_tasks` (detail { count, ... }) while the worker still has
 * upcoming assigned tasks. The page must word that refusal (en + es), never fall back to the
 * generic "Something went wrong". Server side: backend/src/field/entrypoints/field.int.test.ts
 * ("REQ-1162 …"); browser: e2e/field-worker-errors/field-worker-errors.e2e.test.ts ("REQ-1162 …").
 */
import { ApiError } from "../../front-end/lib/api";
import { workerError } from "../../front-end/lib/field-worker-errors";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const refused = (body: unknown) =>
  new ApiError(409, body, "DELETE /field/workers/x failed: 409");

describe("REQ-1162 (LOOP-007 q3-94) removing a worker who still has upcoming tasks is refused in words", () => {
  test("409 worker_has_tasks maps to field.wk.err.hasTasks with the task count", () => {
    const e = workerError(
      refused({
        code: "worker_has_tasks",
        message: "worker still has upcoming tasks",
        detail: { count: 1, dates: ["2026-11-20"], customers: ["Grace Whitfield"] },
      }),
      "en",
    );
    expect(e.key).toBe("field.wk.err.hasTasks");
    expect(e.field).toBeNull();
    expect(e.vars?.count).toBe("1");
  });

  test("field.wk.err.hasTasks is worded in en AND es, carries {count}, and the two differ", () => {
    const k = "field.wk.err.hasTasks";
    expect(typeof en[k]).toBe("string");
    expect(typeof es[k]).toBe("string");
    expect(en[k]).not.toBe(es[k]);
    expect(en[k]).toContain("{count}");
    expect(es[k]).toContain("{count}");
    expect(en[k]).toMatch(/task/i);
    expect(es[k]).toMatch(/tarea/i);
  });
});
