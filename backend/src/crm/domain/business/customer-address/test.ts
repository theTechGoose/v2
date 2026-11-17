/**
 * REQ-625 — a customer's address is entered in parts (street, city, state,
 * zip — the shape A2Z's QuickBooks export carries) and is ALSO stored as the
 * one composed `address` string every existing reader uses (invoices' bill-to
 * and service address, quotes, field tasks and subscriptions, the CSV export,
 * search). These are the pure rules the store applies on every write.
 */
import { assertEquals } from "#std/assert";
import { addressWrite } from "./mod.ts";
import { composeAddress, splitAddress } from "#customer-address/mod.ts";

Deno.test("REQ-625 composeAddress — street, city, state zip", () => {
  assertEquals(
    composeAddress({
      street: " 12 Oak St ",
      city: "Austin",
      state: "TX",
      zip: "78701",
    }),
    "12 Oak St, Austin, TX 78701",
  );
});

Deno.test("REQ-625 composeAddress — missing parts leave no stray commas", () => {
  assertEquals(
    composeAddress({ street: "12 Oak St", zip: "78701" }),
    "12 Oak St, 78701",
  );
  assertEquals(composeAddress({ city: "Austin", state: "TX" }), "Austin, TX");
  assertEquals(composeAddress({ street: "  ", city: "" }), "");
  assertEquals(composeAddress({}), "");
});

Deno.test("REQ-625 splitAddress — reads a composed address back into its parts", () => {
  assertEquals(splitAddress("12 Oak St, Austin, TX 78701"), {
    street: "12 Oak St",
    city: "Austin",
    state: "TX",
    zip: "78701",
  });
  assertEquals(splitAddress("12 Oak St, Suite 4, Austin, TX 78701-1234"), {
    street: "12 Oak St, Suite 4",
    city: "Austin",
    state: "TX",
    zip: "78701-1234",
  });
});

Deno.test("REQ-625 splitAddress — free text it cannot read stays whole in street", () => {
  assertEquals(splitAddress("behind the church on Elm"), {
    street: "behind the church on Elm",
  });
  assertEquals(splitAddress(""), {});
  assertEquals(splitAddress(undefined), {});
});

Deno.test("REQ-625 addressWrite — a create with parts stores them and the composed address", () => {
  assertEquals(
    addressWrite(undefined, {
      street: "12 Oak St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    }),
    {
      street: "12 Oak St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      address: "12 Oak St, Austin, TX 78701",
    },
  );
});

Deno.test("REQ-625 addressWrite — an edit of one part recomposes from the stored others", () => {
  const stored = {
    street: "12 Oak St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    address: "12 Oak St, Austin, TX 78701",
  };
  assertEquals(addressWrite(stored, { city: "Round Rock", zip: "78664" }), {
    street: "12 Oak St",
    city: "Round Rock",
    state: "TX",
    zip: "78664",
    address: "12 Oak St, Round Rock, TX 78664",
  });
});

Deno.test("REQ-625 addressWrite — clearing every part clears the address", () => {
  const stored = { street: "12 Oak St", address: "12 Oak St" };
  assertEquals(
    addressWrite(stored, { street: "", city: "", state: "", zip: "" }),
    {
      street: "",
      city: "",
      state: "",
      zip: "",
      address: "",
    },
  );
});

Deno.test("REQ-625 addressWrite — a legacy free-text address write keeps working and drops stale parts", () => {
  const stored = {
    street: "12 Oak St",
    city: "Austin",
    address: "12 Oak St, Austin",
  };
  assertEquals(addressWrite(stored, { address: "9 Elm Rd, Dallas" }), {
    address: "9 Elm Rd, Dallas",
    street: undefined,
    city: undefined,
    state: undefined,
    zip: undefined,
  });
});

Deno.test("REQ-625 addressWrite — a write that touches no address field changes nothing", () => {
  assertEquals(addressWrite({ address: "1 Main" }, {}), {});
  assertEquals(addressWrite(undefined, {}), {});
});
