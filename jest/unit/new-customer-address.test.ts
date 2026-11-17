/**
 * REQ-599 (demo-loop cycle 4, demo m30) — the /customers New customer modal
 * takes an optional address, with the same Mapbox autocomplete the onboarding
 * wizard uses, and saves it with the customer (before, it collected only
 * name / business / phone / email and the card then said "No address on file").
 */
import * as fs from "fs";
import * as path from "path";
import {
  customerDraftDirty,
  newCustomerPayload,
} from "../../shared/quote-flow/customer-contact.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const empty = {
  name: "",
  businessName: "",
  phoneNumber: "",
  email: "",
  address: "",
};

describe("REQ-599 m30: the New customer modal takes an address", () => {
  test("a draft with only an address typed is dirty (a backdrop click keeps it)", () => {
    expect(customerDraftDirty(empty)).toBe(false);
    expect(customerDraftDirty({ ...empty, address: "   " })).toBe(false);
    expect(customerDraftDirty({ ...empty, address: "12 Oak St" })).toBe(true);
  });

  test("the create payload carries the trimmed address, and omits a blank one", () => {
    expect(
      newCustomerPayload({
        ...empty,
        name: " Bob ",
        address: "  1600 Congress Ave, Austin, TX 78701 ",
      }),
    ).toEqual({ name: "Bob", address: "1600 Congress Ave, Austin, TX 78701" });
    expect(
      newCustomerPayload({
        name: "Bob",
        businessName: " Acme ",
        phoneNumber: "5125550199",
        email: "bob@gmail.com",
        address: "  ",
      }),
    ).toEqual({
      name: "Bob",
      businessName: "Acme",
      phoneNumber: "5125550199",
      email: "bob@gmail.com",
    });
  });

  test("en and es both label the field", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["clientsPage.address"]).toBe("Address (optional)");
    expect(es["clientsPage.address"]).toBe("Dirección (opcional)");
  });

  test("the island renders the autocomplete address field and sends it", () => {
    // REQ-599 AMENDMENT — reconciled with develop on demo-fixes: the New
    // customer form is develop's CustomerFormDialog (REQ-625); its street
    // line is the autocomplete, a picked address fills the parts
    const form = read("front-end/components/CustomerForm.tsx");
    expect(form).toMatch(/<AddressAutocomplete[\s\S]*?data-cy="cf-street"/);
    expect(form).toMatch(/clientsClient\.create\(\s*customerCreatePayload\(/);
    expect(form).toMatch(/onInput=\{\(v\) => onChange\(addressParts\(v\)\)\}/);
    const field = read("front-end/components/AddressAutocomplete.tsx");
    expect(field).toMatch(/suggestAddresses\(/);
    expect(field).toMatch(/role="combobox"/);
  });
});
