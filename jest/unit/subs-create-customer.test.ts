/**
 * REQ-1068 (LOOP-007 cycle 2, q2-57) — /field/subscriptions "New repeat visit": the customer
 * box offers "+ Add "<name>" as a customer" (SearchSelect onCreate, as REQ-283 did on
 * /field/tasks), which POSTs /customers through clientsClient.create and picks the new id.
 * Before the fix the box had no onCreate, so a new name read only "No matches.".
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-1068 (q2-57) the New repeat visit customer box can add a customer", () => {
  const page = read("front-end/islands/FieldSubscriptionsPage.tsx");
  // the customer SearchSelect: from the subs-customer wrapper to its closing </div>
  const start = page.indexOf('data-cy="subs-customer"');
  const box = page.slice(start, page.indexOf("</div>", start));

  test("REQ-1068: the customer SearchSelect gets onCreate and a createLabel", () => {
    expect(start).toBeGreaterThan(-1);
    expect(box).toMatch(/<SearchSelect/);
    expect(box).toMatch(/onCreate=\{/);
    expect(box).toMatch(/createLabel=\{/);
    expect(box).toMatch(/field\.subs\.addCustomer/);
  });

  test("REQ-1068: creating the customer goes through clientsClient.create (the existing POST /customers)", () => {
    expect(page).toMatch(/clientsClient\.create\(/);
  });

  test("REQ-1068: both languages carry field.subs.addCustomer with the {name} slot and a customer-added flash", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const d of [en, es]) {
      expect(typeof d["field.subs.addCustomer"]).toBe("string");
      expect(d["field.subs.addCustomer"]).toContain("{name}");
      expect(typeof d["field.subs.customerAdded"]).toBe("string");
    }
  });
});

/**
 * REQ-1152 (LOOP-007 cycle 3, q3-84 / q3-85) — after a repeat visit saves, the island mirrors
 * the visit's address onto its local customer row when that customer had none (as REQ-340
 * does on /field/tasks, FieldTasksPage.tsx), so a second New repeat visit for the same customer
 * prefills the address without a reload. reload() refetches only the subscriptions.
 */
describe("REQ-1152 (q3-84) New repeat visit mirrors the saved address onto the local customer row", () => {
  const page = read("front-end/islands/FieldSubscriptionsPage.tsx");
  const at = page.indexOf("fieldClient.createSubscription(");
  // from the create call to the end of submit (its catch)
  const after = page.slice(at, page.indexOf("} catch (err)", at));

  test("REQ-1152: after createSubscription, setCustomers fills the address of a customer who had none", () => {
    expect(at).toBeGreaterThan(-1);
    expect(after).toMatch(/setCustomers\(/);
    expect(after).toMatch(/!\s*\w+\.address\?\.trim\(\)/);
  });
});
