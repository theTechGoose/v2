/**
 * REQ-600 — demo-loop cycle 4, issue M5 (run r857a9d67): "Customer card has
 * no way to add phone/email; batch invoice can't be sent; address arrow dead".
 *
 *  - the /customers card panel (front-end/islands/ClientsBoard.tsx) rendered
 *    the Phone and Email rows only when a value existed and had no edit
 *    control, so a customer made from Field → Add task (name + address) could
 *    never get a contact;
 *  - the Address row drew an arrow with no href or handler;
 *  - the batch send's "Add an email or phone to {name}" fix linked to bare
 *    /customers, and /customers had no way to open one card from the URL.
 *
 * Pure logic: front-end/lib/customer-card-edit.ts; wiring: the island sources.
 */
import * as fs from "fs";
import * as path from "path";

// Lazy accessor so a missing module reds only the tests that use it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ce = () => require("../../front-end/lib/customer-card-edit");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-600 (cycle 4, M5) customer-card-edit — the card's contact edits", () => {
  it("REQ-600 openIdFromSearch reads ?open=<id>, else null", () => {
    const { openIdFromSearch } = ce();
    expect(openIdFromSearch("?open=abc-123")).toBe("abc-123");
    expect(openIdFromSearch("?segment=new&open=c%2F1")).toBe("c/1");
    expect(openIdFromSearch("?open=")).toBeNull();
    expect(openIdFromSearch("?segment=new")).toBeNull();
    expect(openIdFromSearch("")).toBeNull();
    expect(openIdFromSearch(undefined)).toBeNull();
  });

  it("REQ-600 customerFixHref points at the customer's own card", () => {
    const { customerFixHref } = ce();
    expect(customerFixHref("c-42")).toBe("/customers?open=c-42");
    expect(customerFixHref("a b")).toBe("/customers?open=a%20b");
    expect(customerFixHref(undefined)).toBe("/customers");
    expect(customerFixHref("")).toBe("/customers");
  });

  it("REQ-600 cardFieldPatch runs the customer form's own rule (REQ-278/352)", () => {
    const { cardFieldPatch } = ce();
    expect(cardFieldPatch("phone", "(512) 555-3150")).toEqual({
      patch: { phoneNumber: "(512) 555-3150" },
    });
    expect(cardFieldPatch("phone", "512-555")).toEqual({
      error: "customer.invalidPhone",
    });
    expect(cardFieldPatch("email", " joe@example.com ")).toEqual({
      patch: { email: "joe@example.com" },
    });
    expect(cardFieldPatch("email", "joe@")).toEqual({
      error: "customer.invalidEmail",
    });
    expect(cardFieldPatch("address", " 12 Elm St ")).toEqual({
      patch: { address: "12 Elm St" },
    });
    // blank clears the field — not a format error
    expect(cardFieldPatch("phone", "  ")).toEqual({ patch: { phoneNumber: "" } });
  });

  it("REQ-600 apiFieldErrorKey maps the backend's refusal key to its field", () => {
    const { apiFieldErrorKey } = ce();
    expect(apiFieldErrorKey("customer.invalidPhone")).toBe(
      "customer.invalidPhone",
    );
    expect(apiFieldErrorKey("customer.invalidEmail")).toBe(
      "customer.invalidEmail",
    );
    expect(apiFieldErrorKey("boom")).toBeNull();
    expect(apiFieldErrorKey(undefined)).toBeNull();
  });
});

describe("REQ-600 (cycle 4, M5) wiring — the card can be edited and deep-linked", () => {
  const board = read("front-end/islands/ClientsBoard.tsx");
  const page = read("front-end/islands/ClientsPage.tsx");
  const batches = read("front-end/islands/FieldBatchesPage.tsx");

  it("REQ-600 the Phone and Email rows render even when empty", () => {
    expect(board).not.toMatch(/\{c\.phoneNumber && \(/);
    expect(board).not.toMatch(/\{c\.email && \(/);
    // one in-place editor per row, each always rendered
    for (const cy of ["edit", "input", "save"]) {
      expect(board).toContain("`ccard2-" + cy + "-${field}`");
    }
    for (const f of ["phone", "email", "address"]) {
      expect(board).toMatch(new RegExp(`<EditRow\\s+field="${f}"`));
    }
  });

  it("REQ-600 the card saves through clientsClient.update with the shared rule", () => {
    expect(board).toContain("clientsClient.update");
    expect(board).toContain("cardFieldPatch");
    expect(board).toContain("apiFieldErrorKey");
  });

  it("REQ-600 the Address row is no dead <div> with an arrow", () => {
    expect(board).not.toMatch(
      /<div class="ccard2__panel-row">\s*<span class="ccard2__panel-row-icon">\s*<I d=\{ICN\.pin\}/,
    );
  });

  it("REQ-600 /customers?open=<id> opens that card", () => {
    expect(board + page).toContain("openIdFromSearch");
  });

  it("REQ-600 the batch send's fix opens the customer's card", () => {
    expect(batches).not.toContain('href="/customers"');
    expect(batches).toContain("customerFixHref(f.customerId)");
  });

  it("REQ-600 en and es carry the card's edit copy", () => {
    for (const k of [
      "clientsBoard.panel.addPhone",
      "clientsBoard.panel.addEmail",
      "clientsBoard.panel.addAddress",
      "clientsBoard.panel.saveError",
    ]) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
    }
  });
});
