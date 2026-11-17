import { assertEquals } from "#std/assert";
import { extractAddressOnly, splitOneLineStreet } from "./mod.ts";

// REQ-420 (demo-loop cycle 2, issue m28): the /welcome address step saves a
// whole one-line address typed into the Street box, with the state from the
// earlier state step — {street: "1200 E Cesar Chavez St, Austin, TX 78702",
// state: "TX"}. The save path splits it so the row holds real fields.

Deno.test("REQ-420 m28: splitOneLineStreet splits the demo's one-line street into street/city/state/ZIP", () => {
  assertEquals(
    splitOneLineStreet({
      street: "1200 E Cesar Chavez St, Austin, TX 78702",
      state: "TX",
    }),
    {
      street: "1200 E Cesar Chavez St",
      city: "Austin",
      state: "TX",
      postal: "78702",
    },
  );
});

Deno.test("REQ-420 m28: splitOneLineStreet keeps fields the caller sent and fills only the missing ones", () => {
  assertEquals(
    splitOneLineStreet({
      street: "1200 E Cesar Chavez St, Austin, TX 78702",
      city: "Austin",
      state: "TX",
      country: "US",
    }),
    {
      street: "1200 E Cesar Chavez St",
      city: "Austin",
      state: "TX",
      postal: "78702",
      country: "US",
    },
  );
});

Deno.test("REQ-420 m28: splitOneLineStreet handles a spelled-out state and a ZIP+4", () => {
  assertEquals(
    splitOneLineStreet({
      street: "1200 E Cesar Chavez St, Austin, Texas 78702-1234",
    }),
    {
      street: "1200 E Cesar Chavez St",
      city: "Austin",
      state: "TX",
      postal: "78702",
    },
  );
});

Deno.test("REQ-420 m28: splitOneLineStreet leaves a plain street (or a street + unit) untouched", () => {
  for (
    const street of [
      "1200 E Cesar Chavez St",
      "123 Main St, Suite 200",
      "123 Washington Ave, Suite 5",
      "PO Box 12",
    ]
  ) {
    assertEquals(splitOneLineStreet({ street, state: "TX" }), {
      street,
      state: "TX",
    });
  }
  assertEquals(splitOneLineStreet({ city: "Austin" }), { city: "Austin" });
});

Deno.test("REQ-420 m28: extractAddressOnly strips a spelled-out state, not just the code", () => {
  assertEquals(extractAddressOnly("123 Main St, Austin, Texas 78701"), {
    street: "123 Main St",
    city: "Austin",
    state: "TX",
    postal: "78701",
  });
  // The shapes the onboarding chat already relied on are unchanged.
  assertEquals(extractAddressOnly("123 Main St, Austin, TX 78701"), {
    street: "123 Main St",
    city: "Austin",
    state: "TX",
    postal: "78701",
  });
  assertEquals(extractAddressOnly("Austin, TX 78701"), {
    city: "Austin",
    state: "TX",
    postal: "78701",
  });
});
