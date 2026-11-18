/**
 * REQ-921 — services are the only thing a business offers: every invoice
 * line (new and edit) and every repeat-visit line is "service dropdown +
 * price", with "+" to add a row and "−" to remove one. New invoice no longer
 * asks "What's it for?" or "Details".
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/service-lines");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const CATALOG = [
  { id: "t2", name: "Mowing" },
  { id: "t1", name: "Edging" },
  { id: "t3", name: "Old thing", archived: true as const },
];

describe("REQ-921 service-line helpers", () => {
  it("REQ-921 the dropdown lists live services A→Z; an archived one only when the row already holds it", () => {
    const { serviceChoices } = mod();
    expect(serviceChoices(CATALOG).map((s: { id: string }) => s.id)).toEqual([
      "t1",
      "t2",
    ]);
    expect(serviceChoices(CATALOG, "t3").map((s: { id: string }) => s.id))
      .toEqual(["t1", "t2", "t3"]);
  });

  it("REQ-921 picking a service sets the row's name; an unknown pick clears it", () => {
    const { pickService, emptyServiceRow } = mod();
    const r = pickService({ ...emptyServiceRow(), price: "50" }, "t2", CATALOG);
    expect(r).toEqual({ serviceId: "t2", name: "Mowing", price: "50" });
    expect(pickService(r, "", CATALOG)).toEqual({
      serviceId: "",
      name: "",
      price: "50",
    });
  });

  it("REQ-921 rows become one-of-each invoice lines at their price in cents", () => {
    const { serviceRowsToLines } = mod();
    expect(serviceRowsToLines([
      { serviceId: "t2", name: "Mowing", price: "80" },
      { serviceId: "t1", name: "Edging", price: "$1,249.99" },
    ])).toEqual([
      { description: "Mowing", quantity: 1, price: 8000 },
      { description: "Edging", quantity: 1, price: 124999 },
    ]);
  });

  it("REQ-921 a row without a service or without a price is refused, by key", () => {
    const { serviceRowsError } = mod();
    expect(serviceRowsError([{ serviceId: "", name: "", price: "5" }])).toBe(
      "serviceLines.err.pick",
    );
    expect(serviceRowsError([{ serviceId: "t1", name: "Edging", price: "" }]))
      .toBe("serviceLines.err.price");
    expect(serviceRowsError([{ serviceId: "t1", name: "Edging", price: "1" }]))
      .toBeNull();
  });

  it("REQ-921 the invoice's name is the services billed, each once", () => {
    const { jobNameFromServices } = mod();
    expect(jobNameFromServices([
      { serviceId: "t2", name: "Mowing", price: "1" },
      { serviceId: "t1", name: "Edging", price: "1" },
      { serviceId: "t2", name: "Mowing", price: "2" },
    ])).toBe("Mowing, Edging");
  });
});

describe("REQ-921 the islands use the service dropdown", () => {
  const inv = read("front-end/islands/InvoicesPage.tsx");
  const subs = read("front-end/islands/FieldSubscriptionsPage.tsx");

  it("REQ-921 New invoice has no 'What's it for' / 'Details' fields and no free-text, qty or unit line inputs", () => {
    expect(inv).not.toMatch(/data-cy="new-invoice-jobname"/);
    expect(inv).not.toMatch(/data-cy="new-invoice-description"/);
    expect(inv).not.toMatch(/new-invoice-line-desc-/);
    expect(inv).not.toMatch(/new-invoice-line-qty-/);
    expect(inv).not.toMatch(/new-invoice-line-unit-/);
  });

  it("REQ-921 New invoice and Edit invoice lines are a service <select> + price with add/remove", () => {
    expect(inv).toMatch(/<ServiceSelect[\s\S]{0,300}data-cy=\{`new-invoice-line-service-\$\{i\}`\}/);
    expect(inv).toMatch(/data-cy=\{`new-invoice-line-price-\$\{i\}`\}/);
    expect(inv).toMatch(/data-cy=\{`new-invoice-line-remove-\$\{i\}`\}/);
    expect(inv).toMatch(/data-cy="new-invoice-line-add"/);
    expect(inv).toMatch(/<ServiceSelect[\s\S]{0,300}data-cy=\{`invoice-edit-line-service-\$\{i\}`\}/);
    expect(inv).not.toMatch(/invoice-edit-line-desc-/);
  });

  it("REQ-921 a repeat visit's services come from a <select>, never 'Create \"…\"' on the fly", () => {
    expect(subs).toMatch(/<ServiceSelect[\s\S]{0,300}data-cy="subs-service"/);
    expect(subs).not.toMatch(/subs-type-create/);
    expect(subs).not.toMatch(/data-cy="subs-type-q"/);
  });

  it("REQ-921 ServiceSelect is the house search picker (SearchSelect) over the catalogue — no native <select>, no create row", () => {
    const c = read("front-end/components/ServiceSelect.tsx");
    expect(c).toMatch(/import SearchSelect from "\.\.\/islands\/SearchSelect\.tsx"/);
    expect(c).toMatch(/<SearchSelect/);
    expect(c).not.toMatch(/<select/);
    expect(c).not.toMatch(/onCreate=/);
    expect(c).toMatch(/serviceChoices\(catalog/);
    expect(c).toMatch(/"serviceLines\.pick"/);
  });

  it("REQ-921 both dictionaries carry the service-line copy", () => {
    for (
      const k of [
        "serviceLines.service",
        "serviceLines.price",
        "serviceLines.pick",
        "serviceLines.add",
        "serviceLines.remove",
        "serviceLines.none",
        "serviceLines.manage",
        "serviceLines.err.pick",
        "serviceLines.err.price",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
  });
});
