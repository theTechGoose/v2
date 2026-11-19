// REQ-992 (LOOP-007 cycle 1, q1-74): the customer DTO gate refuses an absurd
// state or ZIP with a 400 naming a dictionary key, the way REQ-278 refuses a
// bad phone — so the assistant and import writers can't store
// "Texasssss ABCDE" either. Blank parts stay valid.
import { assertEquals } from "#std/assert";
import { parseCreateCustomer, parseUpdateCustomer } from "./customer.ts";

function thrown(fn: () => unknown): { status?: number; message: string } {
  try {
    fn();
  } catch (e) {
    return e as { status?: number; message: string };
  }
  throw new Error("expected a throw — the bad address part was accepted");
}

for (const zip of ["ABCDE", "7870", "78704-12"]) {
  Deno.test(`REQ-992 q1-74 parseCreateCustomer refuses ZIP ${zip} with 400 customer.invalidZip`, () => {
    const err = thrown(() => parseCreateCustomer({ name: "Ann", state: "TX", zip }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidZip");
  });
  Deno.test(`REQ-992 q1-74 parseUpdateCustomer refuses ZIP ${zip} with 400 customer.invalidZip`, () => {
    const err = thrown(() => parseUpdateCustomer({ zip }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidZip");
  });
}

for (const state of ["Texasssss", "ZZ"]) {
  Deno.test(`REQ-992 q1-74 parseCreateCustomer refuses state ${state} with 400 customer.invalidState`, () => {
    const err = thrown(() => parseCreateCustomer({ name: "Ann", state, zip: "78704" }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidState");
  });
  Deno.test(`REQ-992 q1-74 parseUpdateCustomer refuses state ${state} with 400 customer.invalidState`, () => {
    const err = thrown(() => parseUpdateCustomer({ state }));
    assertEquals(err.status, 400);
    assertEquals(err.message, "customer.invalidState");
  });
}

Deno.test("REQ-992 q1-74 a real or blank state and ZIP still parse", () => {
  for (const [state, zip] of [["TX", "78704"], ["Texas", "78704-1234"], ["", ""]]) {
    parseCreateCustomer({ name: "Ann", state, zip });
    parseUpdateCustomer({ state, zip });
  }
  parseCreateCustomer({ name: "Ann" });
});
