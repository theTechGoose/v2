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
    // REQ-300 AMENDMENT — reconciled with develop on demo-fixes: the New
    // customer dialog is develop's shared CustomerFormDialog (REQ-625)
    const form = read("front-end/components/CustomerForm.tsx");
    // the backdrop's close is guarded by the draft, not only by the save in flight
    // (REQ-354 AMENDMENT on demo-fixes: it is the shared <Backdrop>'s onClose now)
    expect(form).toMatch(/<Backdrop[\s\S]{0,200}onClose=\{\(\) => !busy && !dirty && onClose\(\)\}/);
    expect(form).toMatch(/data-cy="customer-form-backdrop"/);
  });
});
