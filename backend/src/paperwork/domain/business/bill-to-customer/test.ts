/**
 * REQ-696 — demo-loop cycle 5, issues M5 + M22: an invoice made in Nueva
 * factura with "Sin cliente" and only a BILL TO name ("Jorge Ruiz") had no
 * customerId, so the customers page never saw what Jorge owed and the
 * invoice list showed "—". The bill-to name is the customer: attach the
 * existing one (the shared REQ-331 same-customer rule) or create one.
 */
import { assertEquals } from "#std/assert";
import { billToCustomerPlan } from "./mod.ts";

const existing = [
  { id: "c-1", name: "María López", phoneNumber: "+15125550101" },
  { id: "c-2", name: "Bob", email: "bob@example.com" },
];

Deno.test("REQ-696 M5/M22 billToCustomerPlan — no bill-to name: nothing to attach or create", () => {
  assertEquals(billToCustomerPlan(undefined, existing), undefined);
  assertEquals(billToCustomerPlan({ name: "   " }, existing), undefined);
  assertEquals(
    billToCustomerPlan({ email: "x@example.com" }, existing),
    undefined,
  );
});

Deno.test("REQ-696 M5/M22 billToCustomerPlan — a new bill-to name creates the customer with its valid contact", () => {
  assertEquals(
    billToCustomerPlan(
      {
        name: "  Jorge Ruiz ",
        email: "jorge@example.com",
        phoneNumber: "(512) 555-0199",
        address: "12 Elm St",
        businessName: "Ruiz LLC",
      },
      existing,
    ),
    {
      create: {
        name: "Jorge Ruiz",
        email: "jorge@example.com",
        phoneNumber: "(512) 555-0199",
        address: "12 Elm St",
        businessName: "Ruiz LLC",
      },
    },
  );
});

Deno.test("REQ-696 M5/M22 billToCustomerPlan — a malformed contact is left off the new customer, never a failed issue", () => {
  assertEquals(
    billToCustomerPlan(
      { name: "Jorge Ruiz", email: "jorge@", phoneNumber: "123" },
      [],
    ),
    { create: { name: "Jorge Ruiz" } },
  );
});

Deno.test("REQ-696 M5/M22 billToCustomerPlan — the same customer (name accent/case-blind, or phone, or email) is attached, not duplicated", () => {
  assertEquals(billToCustomerPlan({ name: "maria lopez" }, existing), {
    attach: "c-1",
  });
  assertEquals(
    billToCustomerPlan({ name: "Robert", email: "BOB@example.com" }, existing),
    { attach: "c-2" },
  );
});
