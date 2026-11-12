/**
 * REQ-521 — demo-loop cycle 3, demo issue m54: "Add task with no workers: no hint or link; the
 * browser's 'Please fill out this field.' lands on Service, not Customer".
 *
 * Cause (RCA at cc5d4b0e): the Customer box is a SearchSelect whose only form element is a hidden
 * input — never validated by the browser — while Service and Price carried native `required`. An
 * empty Save ran the browser's constraint validation first, so the bubble landed on Service and
 * `addTaskProblem` (customer → service → price) never ran. The Worker select had no empty state.
 *
 * Fix: the Add-task form is `noValidate`, so `addTaskProblem` decides — the first message is on
 * Customer. With no workers on the account, a hint under the Worker select links to /field/workers.
 */
import * as fs from "fs";
import * as path from "path";
import { addTaskProblem } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/FieldTasksPage.tsx");

/** the Add-task <form …> opening tag */
const addFormTag = (() => {
  const at = island.indexOf('data-cy="tk-add-form"');
  return island.slice(
    island.lastIndexOf("<form", at),
    island.indexOf(">", at) + 1,
  );
})();

describe("REQ-521 (demo m54, cycle 3) — an empty Add task names Customer first", () => {
  test("addTaskProblem on an empty form → customer, with needCustomer", () => {
    expect(addTaskProblem({ customerId: "", typeName: "", price: "" })).toEqual(
      {
        field: "customer",
        key: "field.tk.needCustomer",
      },
    );
  });

  test("the Add-task form is noValidate, so the browser never answers before addTaskProblem", () => {
    expect(addFormTag).toMatch(/\bnoValidate\b/);
    expect(addFormTag).toMatch(/onSubmit=\{submitAdd\}/);
  });
});

describe("REQ-521 (demo m54, cycle 3) — no workers → a hint with a link to /field/workers", () => {
  test("the island renders tk-add-no-workers only when the loaded worker list is empty, linking to /field/workers", () => {
    const at = island.indexOf('data-cy="tk-add-no-workers"');
    expect(at).toBeGreaterThan(-1);
    const block = island.slice(Math.max(0, at - 400), at + 600);
    expect(block).toMatch(/workers\.length === 0/);
    expect(block).toMatch(/href="\/field\/workers"/);
    expect(block).toMatch(/t\("field\.tk\.noWorkers"\)/);
    expect(block).toMatch(/t\("field\.tk\.addWorkerLink"\)/);
  });

  test("en and es carry the hint and the link text", () => {
    expect(en["field.tk.noWorkers"]).toBe("No workers yet.");
    expect(en["field.tk.addWorkerLink"]).toBe("Add a worker");
    expect(es["field.tk.noWorkers"]).toBe("Aún no hay trabajadores.");
    expect(es["field.tk.addWorkerLink"]).toBe("Agrega un trabajador");
  });
});
