/**
 * REQ-283 (demo M38) — the one-off "Add task" form names what is missing instead of
 * "Something went wrong — try again.", and its customer box offers to add a name that is
 * not a customer yet.
 */
import { assertEquals } from "@std/assert";
import { addTaskProblem, addTaskServerProblem, centsOf } from "./field.ts";
import { createOffer } from "./search-select.ts";

const ok = { customerId: "c1", typeName: "Mulch", price: "120" };

Deno.test("REQ-283 addTaskProblem — a complete form has no problem", () => {
  assertEquals(addTaskProblem(ok), null);
});

Deno.test("REQ-283 addTaskProblem — no customer picked is named as such", () => {
  assertEquals(addTaskProblem({ ...ok, customerId: "" }), {
    field: "customer",
    key: "field.tk.needCustomer",
  });
});

Deno.test("REQ-283 addTaskProblem — a blank service is named as such", () => {
  assertEquals(addTaskProblem({ ...ok, typeName: "   " }), {
    field: "type",
    key: "field.tk.needType",
  });
});

Deno.test("REQ-283 addTaskProblem — a missing or bad price is named as such", () => {
  for (const price of ["", "  ", "-5", "abc"]) {
    assertEquals(addTaskProblem({ ...ok, price }), {
      field: "price",
      key: "field.tk.badPrice",
    }, price);
  }
});

Deno.test("REQ-283 addTaskProblem — the customer is named first when everything is missing", () => {
  assertEquals(
    addTaskProblem({ customerId: "", typeName: "", price: "" })?.field,
    "customer",
  );
});

Deno.test("REQ-283 centsOf — dollars to cents, null when not a price", () => {
  assertEquals(centsOf("120"), 12000);
  assertEquals(centsOf("120.5"), 12050);
  assertEquals(centsOf(""), null);
  assertEquals(centsOf("-1"), null);
});

const opts = [{ id: "1", label: "Ana Torres" }, { id: "2", label: "Bob Ray" }];

Deno.test("REQ-283 createOffer — an unknown name is offered, trimmed", () => {
  assertEquals(createOffer(opts, "  Jim Baker "), "Jim Baker");
});

Deno.test("REQ-283 createOffer — a blank box offers nothing", () => {
  assertEquals(createOffer(opts, ""), null);
  assertEquals(createOffer(opts, "   "), null);
});

Deno.test("REQ-283 createOffer — a name that is already a customer (any case, accents) offers nothing", () => {
  assertEquals(createOffer(opts, "ana torres"), null);
  assertEquals(createOffer(opts, "ÁNA  TORRES"), null);
});

Deno.test("REQ-283 createOffer — a partial match of an existing customer still offers the new name", () => {
  assertEquals(createOffer(opts, "Ana"), "Ana");
});

Deno.test("REQ-283 addTaskServerProblem — the server's 'workerId required' (a customer with no staffed zone) names the worker field", () => {
  assertEquals(addTaskServerProblem("workerId required"), {
    field: "worker",
    key: "field.tk.needWorker",
  });
});

Deno.test("REQ-283 addTaskServerProblem — any other server answer is not mapped", () => {
  assertEquals(addTaskServerProblem("date must be YYYY-MM-DD"), null);
  assertEquals(addTaskServerProblem(undefined), null);
});
