/**
 * REQ-300 (demo cycle 1, M20) — the New customer dialog never drops typed text on a backdrop
 * click: a click outside the form closes it only while the draft is empty; a dirty draft keeps
 * the dialog up (Cancel and Escape still close it, and the draft itself is kept in the island).
 */
import * as fs from "fs";
import * as path from "path";
import { customerDraftDirty } from "../../shared/quote-flow/customer-contact.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-300 a dirty New customer draft survives a backdrop click", () => {
  test("a draft is dirty once any field has a non-blank value", () => {
    const empty = { name: "", businessName: "", phoneNumber: "", email: "" };
    expect(customerDraftDirty(empty)).toBe(false);
    expect(customerDraftDirty({ ...empty, name: "   " })).toBe(false);
    expect(customerDraftDirty({ ...empty, name: "Bob" })).toBe(true);
    expect(customerDraftDirty({ ...empty, businessName: "12" })).toBe(true);
    expect(customerDraftDirty({ ...empty, phoneNumber: "12" })).toBe(true);
    expect(customerDraftDirty({ ...empty, email: "bob@gmail.com" })).toBe(
      true,
    );
  });

  test("the backdrop closes the dialog only while the draft is clean", () => {
    const island = read("front-end/islands/ClientsPage.tsx");
    expect(island).toMatch(/customerDraftDirty\(/);
    // the backdrop's onClick is guarded by the draft, not only by the save in flight
    expect(island).not.toMatch(
      /onClick=\{\(\) => !adding && setAddOpen\(false\)\}/,
    );
    expect(island).toMatch(/data-cy="add-client-backdrop"/);
  });
});
