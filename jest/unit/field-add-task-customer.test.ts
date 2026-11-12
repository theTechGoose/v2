/**
 * REQ-283 (demo M38) — /field/tasks "Add task": a failed check names the field (no generic
 * "Something went wrong"), the field is marked aria-invalid, and the customer box offers
 * "+ Add "<name>" as a customer", which POSTs /customers and picks the new id.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const KEYS = [
  "field.tk.needCustomer",
  "field.tk.needType",
  "field.tk.badPrice",
  "field.tk.needWorker",
  "field.tk.addCustomer",
  "field.tk.customerAdded",
];

describe("REQ-283 Add task names what is missing and can add a customer", () => {
  const page = read("front-end/islands/FieldTasksPage.tsx");
  const ss = read("front-end/islands/SearchSelect.tsx");

  test("submitAdd uses addTaskProblem, not the generic error, for a client-side check", () => {
    const body = page.slice(page.indexOf("async function submitAdd"));
    const guard = body.slice(0, body.indexOf("fieldClient.createTask"));
    expect(guard).toMatch(/addTaskProblem\(/);
    expect(guard).not.toMatch(/field\.common\.error/);
  });

  test("the failing field is marked aria-invalid", () => {
    expect(page).toMatch(/aria-invalid=\{addBad === "type"/);
    expect(page).toMatch(/aria-invalid=\{addBad === "price"/);
    expect(page).toMatch(/aria-invalid=\{addBad === "worker"/);
    expect(page).toMatch(/addTaskServerProblem\(/);
    expect(page).toMatch(/invalid=\{addBad === "customer"/);
  });

  test("the customer box gets onCreate, which creates the customer through the clients client", () => {
    expect(page).toMatch(/onCreate=\{/);
    expect(page).toMatch(/clientsClient\.create\(/);
  });

  test("SearchSelect takes an optional onCreate and draws the create row", () => {
    expect(ss).toMatch(/onCreate\?: \(query: string\) => void/);
    expect(ss).toMatch(/createOffer\(/);
    expect(ss).toMatch(/data-cy="search-select-create"/);
  });

  test("both languages carry every new key", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const k of KEYS) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
  });
});
