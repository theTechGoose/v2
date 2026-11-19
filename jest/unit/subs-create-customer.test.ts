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
