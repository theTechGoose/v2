import { assertEquals } from "#std/assert";
import { splitJoinedItems } from "./mod.ts";

/**
 * REQ-443 (demo-loop cycle 3, m46): "Polish this line?" turned
 * "(trench + patch)" into "(trench" / "Patch)". REQ-332's splitJoinedItems
 * split on every "+"/"plus", including one inside parentheses. Only a
 * top-level joiner with a real item on each side splits a bullet.
 */

Deno.test("REQ-443 m46 splitJoinedItems: a '+' inside parentheses never splits", () => {
  const text = "New drain line thru slab to island (trench + patch)";
  assertEquals(splitJoinedItems(text), [text]);
});

Deno.test("REQ-443 m46 splitJoinedItems: 'plus' inside parentheses or brackets never splits", () => {
  for (
    const text of [
      "Regrade the yard (labor plus fill dirt)",
      "Frame the closet [studs + drywall] and paint",
    ]
  ) {
    assertEquals(splitJoinedItems(text), [text]);
  }
});

Deno.test("REQ-443 m46 splitJoinedItems: a top-level joiner still splits, ignoring nested ones", () => {
  assertEquals(
    splitJoinedItems("4 recesed lights + City of Austin permit"),
    ["4 recesed lights", "City of Austin permit"],
  );
  assertEquals(
    splitJoinedItems("Trench to island (dig + patch) + City permit"),
    ["Trench to island (dig + patch)", "City permit"],
  );
  assertEquals(
    splitJoinedItems("new vanity plus faucet"),
    ["new vanity", "faucet"],
  );
});

Deno.test("REQ-443 m46 splitJoinedItems: a joiner without a real item on both sides does not split", () => {
  for (const text of ["+ City permit", "Drywall patch +", "Drywall + ---"]) {
    assertEquals(splitJoinedItems(text), [text]);
  }
});
