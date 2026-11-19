/**
 * REQ-1149 (LOOP-007 cycle 3, q3-80; amends REQ-924(a), extends REQ-331) — two customers named
 * "Lupe Garza" read as two identical sidebar rows, and the /customers New customer form made the
 * second one without a word. The island wiring:
 *  - CustomersNav renders the row's `tag` (customer-nav.ts gives same-name rows their number) next
 *    to the name and in the row's accessible name, and its row cache key moves past v2 so cached
 *    rows without tags are not reused;
 *  - CustomerForm's create path runs the shared REQ-331 check (`findExistingCustomer`) before
 *    `clientsClient.create`, shows an inline duplicate notice (`cf-duplicate`) with "Create anyway"
 *    (`cf-create-anyway`, which sends `allowDuplicate`), never a native dialog.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-1149 (LOOP-007 q3, q3-80) same-name customers are told apart", () => {
  const nav = read("front-end/components/CustomersNav.tsx");
  const form = read("front-end/components/CustomerForm.tsx");

  test("REQ-1149: the sidebar row renders its tag beside the name and in its accessible name", () => {
    expect(nav).toMatch(/\{\s*r\.tag\s*\}|r\.tag\s*&&/);
    expect(nav).toMatch(/data-cy="nav-customer-tag"/);
    // the aria label for two Lupe Garzas must differ too
    expect(nav).toMatch(/named\([^)]*r\.tag/);
  });

  test("REQ-1149: the row cache key is bumped past v2 so tagless cached rows are not shown", () => {
    expect(nav).not.toMatch(/"pm:customers-nav:v2"/);
  });

  test("REQ-1149: the New customer form checks findExistingCustomer before create and offers Create anyway", () => {
    expect(form).toMatch(/import[^;]*findExistingCustomer[^;]*customer-dedupe/);
    expect(form).toMatch(/findExistingCustomer\(/);
    expect(form).toMatch(/data-cy="cf-duplicate"/);
    expect(form).toMatch(/data-cy="cf-create-anyway"/);
    expect(form).toMatch(/allowDuplicate/);
    expect(form).not.toMatch(/\bconfirm\(/);
  });
});
