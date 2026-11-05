/**
 * REQ-152 — the subscription form's customer field is the SearchSelect (REQ-136), not a native
 * drop-down: the island imports and mounts it for the customer, no `<select name="customer">`
 * remains, the route links the search-select stylesheet, and SearchSelect takes `disabled` so the
 * edit form can lock the customer.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-152 the subscription form's customer field is the search-and-pick", () => {
  test("the island mounts SearchSelect for the customer and no native customer select remains", () => {
    const src = read("front-end/islands/FieldSubscriptionsPage.tsx");
    expect(src).toMatch(/import SearchSelect from "\.\.\/islands\/SearchSelect\.tsx"|import SearchSelect from "\.\/SearchSelect\.tsx"/);
    expect(src).toMatch(/<SearchSelect/);
    expect(src).toMatch(/customerOptions\(/);
    expect(src).not.toMatch(/<select\s+name="customer"/);
    expect(src).toMatch(/data-cy="subs-customer"/);
  });

  test("the route links the search-select stylesheet", () => {
    const src = read("front-end/routes/field/subscriptions.tsx");
    expect(src).toMatch(/href="\/search-select\.css"/);
  });

  test("SearchSelect takes `disabled` and locks its box", () => {
    const src = read("front-end/islands/SearchSelect.tsx");
    expect(src).toMatch(/disabled\?: boolean/);
    expect(src).toMatch(/disabled=\{disabled\}/);
  });
});
