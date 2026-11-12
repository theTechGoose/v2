/**
 * REQ-625 — one full customer form (name, company, phone, email, street,
 * city, state, zip, notes) used by every "new customer" entry point — the
 * Clients page, the new invoice's "New client", the assistant's customer
 * step — and, prefilled, as the EDIT form reachable from the client panel
 * (PUT /customers/:id). Phone and email validation is lenient.
 *
 * Part 1 pins the pure rules (shared/customer-form); part 2 the wiring.
 */
import * as fs from "fs";
import * as path from "path";
import {
  CUSTOMER_FORM_FIELDS,
  customerCreatePayload,
  customerFormFrom,
  customerUpdatePayload,
  emptyCustomerForm,
  formatPhoneLenient,
  validateCustomerForm,
} from "../../shared/customer-form/mod";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-625 the customer form's rules", () => {
  test("the fields, in order — the QuickBooks customer shape plus notes", () => {
    expect(CUSTOMER_FORM_FIELDS).toEqual([
      "name",
      "businessName",
      "phone",
      "email",
      "street",
      "city",
      "state",
      "zip",
      "notes",
    ]);
    expect(Object.values(emptyCustomerForm()).every((v) => v === "")).toBe(
      true,
    );
  });

  test("a create sends every filled field, trimmed, and leaves the empty ones out", () => {
    const v = {
      ...emptyCustomerForm(),
      name: "  Maria Lopez ",
      businessName: "Lopez Properties",
      phone: "(512) 555-0101",
      street: "4410 Ranch Rd",
      city: "Austin",
      state: "TX",
      zip: "78735",
      notes: " Gate code 4411 ",
    };
    expect(customerCreatePayload(v)).toEqual({
      name: "Maria Lopez",
      businessName: "Lopez Properties",
      phoneNumber: "(512) 555-0101",
      street: "4410 Ranch Rd",
      city: "Austin",
      state: "TX",
      zip: "78735",
      notes: "Gate code 4411",
    });
  });

  test("an edit sends every field — an emptied one is a clear, the address parts always go together", () => {
    const v = { ...emptyCustomerForm(), name: "Maria", city: "Round Rock" };
    expect(customerUpdatePayload(v)).toEqual({
      name: "Maria",
      businessName: "",
      phoneNumber: "",
      email: "",
      street: "",
      city: "Round Rock",
      state: "",
      zip: "",
      notes: "",
    });
  });

  test("the edit form prefills from the stored parts", () => {
    expect(customerFormFrom({
      name: "Maria",
      businessName: "Lopez Properties",
      phoneNumber: "+1 512 555 0101",
      email: "m@l.example",
      address: "4410 Ranch Rd, Austin, TX 78735",
      street: "4410 Ranch Rd",
      city: "Austin",
      state: "TX",
      zip: "78735",
      notes: "dog",
    })).toEqual({
      name: "Maria",
      businessName: "Lopez Properties",
      phone: "+1 512 555 0101",
      email: "m@l.example",
      street: "4410 Ranch Rd",
      city: "Austin",
      state: "TX",
      zip: "78735",
      notes: "dog",
    });
  });

  test("a customer saved before the parts existed prefills by splitting its address — nothing lost", () => {
    const f = customerFormFrom({
      name: "Old",
      address: "12 Oak St, Austin, TX 78701",
    });
    expect([f.street, f.city, f.state, f.zip]).toEqual([
      "12 Oak St",
      "Austin",
      "TX",
      "78701",
    ]);
    const g = customerFormFrom({ name: "Old", address: "behind the church" });
    expect(g.street).toBe("behind the church");
  });

  test("validation: the name is required; every phone format with enough digits is accepted", () => {
    expect(validateCustomerForm(emptyCustomerForm())).toEqual({
      name: "required",
    });
    for (
      const phone of [
        "5125550101",
        "(512) 555-0101",
        "512.555.0101",
        "+1 512-555-0101",
        "+44 20 7946 0958",
        "+52 55 1234 5678",
        "555-0101",
        "512-555-0101 ext 22",
        "1 (512) 555 0101 x3",
      ]
    ) {
      expect(validateCustomerForm({ ...emptyCustomerForm(), name: "A", phone }))
        .toEqual({});
    }
    expect(
      validateCustomerForm({ ...emptyCustomerForm(), name: "A", phone: "55" }),
    )
      .toEqual({ phone: "invalid" });
  });

  test("validation: email is lenient but must look like one", () => {
    expect(
      validateCustomerForm({
        ...emptyCustomerForm(),
        name: "A",
        email: "Maria.Lopez+yard@mail.co.uk",
      }),
    )
      .toEqual({});
    expect(
      validateCustomerForm({
        ...emptyCustomerForm(),
        name: "A",
        email: "maria@",
      }),
    )
      .toEqual({ email: "invalid" });
  });

  test("the phone mask formats a US number as you type and never mangles an international one", () => {
    expect(formatPhoneLenient("5125550101")).toBe("(512) 555-0101");
    expect(formatPhoneLenient("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhoneLenient("+")).toBe("+");
    expect(formatPhoneLenient("512-555-0101 ext 22")).toBe(
      "512-555-0101 ext 22",
    );
    expect(formatPhoneLenient("")).toBe("");
  });
});

describe("REQ-625 one form, every entry point", () => {
  const form = read("front-end/components/CustomerForm.tsx");

  test("the component renders every field with a test hook, a label in both languages, and the lenient mask", () => {
    for (
      const cy of [
        "cf-name",
        "cf-business",
        "cf-phone",
        "cf-email",
        "cf-street",
        "cf-city",
        "cf-state",
        "cf-zip",
        "cf-notes",
      ]
    ) expect(form).toContain(`"${cy}"`);
    expect(form).toMatch(/data-cy=\{cy\}/);
    expect(form).toMatch(/formatPhoneLenient\(/);
    expect(form).toMatch(/validateCustomerForm\(/);
    // create → POST, edit → PUT /customers/:id
    expect(form).toMatch(/clientsClient\.create\(\s*customerCreatePayload\(/);
    expect(form).toMatch(/clientsClient\.update\([^)]*customerUpdatePayload\(/);
    // the action row: one solid primary, a ghost cancel
    expect(form).toContain('data-cy="cf-save"');
    expect(form).toContain('data-cy="cf-cancel"');
    expect(form).not.toMatch(/gradient/);
  });

  test("the Clients page's Add client uses the shared dialog", () => {
    const page = read("front-end/islands/ClientsPage.tsx");
    expect(page).toMatch(/from "\.\.\/components\/CustomerForm\.tsx"/);
    expect(page).toMatch(/<CustomerFormDialog[\s\S]{0,200}mode="create"/);
    expect(page).not.toMatch(/setAddPhone|setAddEmail/);
  });

  test("the Clients page's edit uses the same dialog, prefilled, and refreshes the board", () => {
    const page = read("front-end/islands/ClientsPage.tsx");
    expect(page).toMatch(/<CustomerFormDialog[\s\S]{0,300}mode="edit"/);
    expect(page).toMatch(/onEdit=/);
  });

  test("the new invoice's New client uses the shared fields and posts the full payload", () => {
    const inv = read("front-end/islands/InvoicesPage.tsx");
    expect(inv).toMatch(/from "\.\.\/components\/CustomerForm\.tsx"/);
    expect(inv).toMatch(/<CustomerFields/);
    expect(inv).toMatch(/clientsClient\.create\(\s*customerCreatePayload\(/);
  });

  test("the assistant's customer step keeps its look but uses the same fields and sends the parts", () => {
    const asst = read("front-end/islands/AsstChat.tsx");
    expect(asst).toMatch(/<CustomerFields[\s\S]{0,300}variant="asst"/);
    expect(asst).toMatch(/customerCreatePayload\(/);
    const client = read("front-end/clients/assistant.ts");
    expect(client).toMatch(/street\?: string/);
  });

  test("every key the form uses exists in both languages", () => {
    const keys = [
      ...new Set(
        [...form.matchAll(/"(customerForm\.[a-zA-Z_.]+)"/g)].map((m) => m[1]),
      ),
    ];
    expect(keys.length).toBeGreaterThan(12);
    for (const file of ["lang/en.json", "lang/es.json"]) {
      const dict = JSON.parse(read(file));
      for (const k of keys) {
        expect([file, k, typeof dict[k]]).toEqual([file, k, "string"]);
      }
    }
    const es = JSON.parse(read("lang/es.json"));
    expect(es["customerForm.street"]).not.toBe(
      JSON.parse(read("lang/en.json"))["customerForm.street"],
    );
  });
});
