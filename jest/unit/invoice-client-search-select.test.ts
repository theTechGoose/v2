/**
 * REQ-801 — the new-invoice form's client field is the SearchSelect (REQ-136), the same
 * search-and-pick the repeat-visit form uses, not a native drop-down: the island mounts it for
 * the client with the "+ New client" row, no `<select data-cy="new-invoice-client">` remains,
 * the route links the search-select stylesheet, and both languages carry the placeholder.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-801 the new-invoice client field is the search-and-pick", () => {
  test("the island mounts SearchSelect for the client and no native client select remains", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/import SearchSelect from "\.\/SearchSelect\.tsx"/);
    expect(src).toMatch(
      /data-cy="new-invoice-client"[\s\S]{0,400}<SearchSelect/,
    );
    expect(src).not.toMatch(/<select\s+data-cy="new-invoice-client"/);
    // the "+ New client" choice is a row of the list, keyed on the sentinel
    expect(src).toMatch(
      /id: NEW_SENTINEL,\s*label: tFor\(lang, "invoicesPage\.new\.newClient"\)/,
    );
    // clearing the box un-picks the client (bill-to and service address reset)
    expect(src).toMatch(/onQuery=\{[\s\S]{0,200}pickCustomer\(""\)/);
  });

  test("the invoices route links the search-select stylesheet", () => {
    const src = read("front-end/routes/invoices/index.tsx");
    expect(src).toMatch(/href=\{asset\("\/search-select\.css"\)\}/);
  });

  test("both languages carry the search placeholder", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      expect(typeof dict["invoicesPage.new.clientSearch"]).toBe("string");
      expect(dict["invoicesPage.new.clientSearch"].length).toBeGreaterThan(3);
    }
  });
});
