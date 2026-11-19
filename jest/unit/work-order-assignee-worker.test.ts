/**
 * REQ-1010 (LOOP-007 cycle 1, q1-96) — the work order's Assignee is a picker over the account's
 * workers, so an assigned work order can reach that worker's /worker day. Amends REQ-210 / REQ-609.
 * QA typed "Mike Carter" into a free-text Assignee; nothing linked it to Mike, so his day was empty.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** the JSX element that carries a data-cy, from its opening `<tag` to that attribute */
function elementWith(src: string, cy: string): string | null {
  const at = src.indexOf(`data-cy="${cy}"`);
  if (at < 0) return null;
  const open = src.lastIndexOf("<", at);
  return src.slice(open, at + cy.length + 10);
}

const FORMS: Array<[string, string]> = [
  ["front-end/islands/WorkOrdersPage.tsx", "wo-new-assignee"],
  ["front-end/islands/WorkOrderPage.tsx", "wo-edit-assignee"],
];

describe("REQ-1010 (LOOP-007 q1-96) work order Assignee picks one of the account's workers", () => {
  test.each(FORMS)("%s: the Assignee (%s) is a <select>, not a free-text input", (file, cy) => {
    const el = elementWith(read(file), cy);
    expect(el).not.toBeNull();
    expect(el!.startsWith("<select")).toBe(true);
  });

  test.each(FORMS)("%s loads the workers list and sends assigneeWorkerId", (file) => {
    const src = read(file);
    expect(src).toMatch(/fieldClient|workersClient|\/field\/workers/);
    expect(src).toMatch(/assigneeWorkerId/);
  });

  test("the work-orders client carries assigneeWorkerId on the order and the input", () => {
    const src = read("front-end/clients/work-orders.ts");
    const order = src.slice(src.indexOf("export interface WorkOrder {"), src.indexOf("export interface WorkOrderInput"));
    const input = src.slice(src.indexOf("export interface WorkOrderInput"));
    expect(order).toMatch(/assigneeWorkerId\?: string/);
    expect(input).toMatch(/assigneeWorkerId\?: string/);
  });

  test("workOrders.vsTasks no longer says work orders never reach a worker; it says an assigned one shows on their day (en + es)", () => {
    expect(en["workOrders.vsTasks"]).toMatch(/assign/i);
    expect(en["workOrders.vsTasks"]).toMatch(/worker/i);
    expect(es["workOrders.vsTasks"]).toMatch(/asign/i);
    expect(es["workOrders.vsTasks"]).toMatch(/trabajador/i);
  });
});
