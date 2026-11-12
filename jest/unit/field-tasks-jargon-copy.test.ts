/**
 * REQ-609 (demo cycle 4, issue m48) — Tasks vs work orders, zone/subscription jargon.
 * A one-off trade (a fence builder) read /field/tasks and asked "what's a zone and a
 * subscription?". The Tasks title/sub/empty state and the Workers "Covers" hint now lead with
 * one-off tasks and call subscriptions "repeat visits"; and /work-orders says, in one line, how a
 * work order differs from a task (a finished task never becomes a work order).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const TASK_KEYS = ["field.tk.title", "field.tk.sub", "field.tk.none"];

describe("REQ-609 (demo c4 m48) Tasks copy leads with one-off tasks, no zone/subscription jargon", () => {
  test("Tasks title/sub/empty never say zone, subscription or round (en + es)", () => {
    for (const k of TASK_KEYS) {
      expect([k, en[k]]).not.toEqual([
        k,
        expect.stringMatching(/zone|subscription|round/i),
      ]);
      expect([k, es[k]]).not.toEqual([
        k,
        expect.stringMatching(/zona|suscripci|ronda/i),
      ]);
    }
  });

  test("Tasks sub and empty state name one-off jobs first, and call subscriptions repeat visits", () => {
    for (const k of ["field.tk.sub", "field.tk.none"]) {
      expect(en[k]).toMatch(/Add task/);
      expect(es[k]).toMatch(/Agregar tarea/);
    }
    expect(en["field.tk.sub"]).toMatch(/repeat visits/i);
    expect(es["field.tk.sub"]).toMatch(/visitas repetidas/i);
    expect(en["field.tk.none"]).toMatch(/repeat visits/i);
    expect(es["field.tk.none"]).toMatch(/visitas repetidas/i);
    // the one-off path comes before the repeat-visit path
    for (
      const [v, oneOff, repeat] of [
        [en["field.tk.none"], "Add task", "repeat visits"],
        [es["field.tk.none"], "Agregar tarea", "visitas repetidas"],
        [en["field.tk.sub"], "Add task", "repeat visits"],
        [es["field.tk.sub"], "Agregar tarea", "visitas repetidas"],
      ]
    ) {
      expect(v.indexOf(oneOff)).toBeLessThan(v.toLowerCase().indexOf(repeat));
    }
  });

  test("Workers 'Covers' hint explains zones as areas of repeat visits, not bare 'zone'", () => {
    expect(en["field.wk.coversNone"]).toMatch(/repeat visits/i);
    expect(es["field.wk.coversNone"]).toMatch(/visitas repetidas/i);
    expect(en["field.wk.coversNone"]).not.toMatch(/^no zone yet/);
    // still a value after "Covers": lowercase, no full stop; still points to Assignments
    for (const v of [en["field.wk.coversNone"], es["field.wk.coversNone"]]) {
      expect(v[0]).toBe(v[0].toLowerCase());
      expect(v.endsWith(".")).toBe(false);
    }
    expect(en["field.wk.coversNone"]).toMatch(/Assignments/);
    expect(es["field.wk.coversNone"]).toMatch(/Asignaciones/);
  });

  test("Work orders page carries a one-line explainer of how it differs from Tasks (en + es)", () => {
    expect(en["workOrders.vsTasks"]).toMatch(/Tasks/);
    expect(es["workOrders.vsTasks"]).toMatch(/Tareas/);
    expect(en["workOrders.vsTasks"]).toMatch(/quote|invoice/i);
    expect(es["workOrders.vsTasks"]).toMatch(/cotizaci|factura/i);
    const src = read("front-end/islands/WorkOrdersPage.tsx");
    expect(src).toMatch(/data-cy="wo-vs-tasks"/);
    expect(src).toMatch(/t\("workOrders\.vsTasks"\)/);
    expect(src).toMatch(/href="\/field\/tasks"/);
  });
});
