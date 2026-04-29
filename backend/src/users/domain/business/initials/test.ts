import { assertEquals } from "#std/assert";
import { computeInitials } from "./mod.ts";

Deno.test("computeInitials: 'Diego R.' → 'DR'", () => {
  assertEquals(computeInitials("Diego R."), "DR");
});

Deno.test("computeInitials: 'Diego Riley' → 'DR'", () => {
  assertEquals(computeInitials("Diego Riley"), "DR");
});

Deno.test("computeInitials: 'Diego R. Riley III' → 'DR' (suffix stripped)", () => {
  assertEquals(computeInitials("Diego R. Riley III"), "DR");
});

Deno.test("computeInitials: 'Maria Hernandez Jr.' → 'MH' (Jr stripped)", () => {
  assertEquals(computeInitials("Maria Hernandez Jr."), "MH");
});

Deno.test("computeInitials: single-word 'Diego' → 'DI'", () => {
  assertEquals(computeInitials("Diego"), "DI");
});

Deno.test("computeInitials: single-letter 'D' → 'D'", () => {
  assertEquals(computeInitials("D"), "D");
});

Deno.test("computeInitials: undefined → '?'", () => {
  assertEquals(computeInitials(undefined), "?");
});

Deno.test("computeInitials: empty string → '?'", () => {
  assertEquals(computeInitials(""), "?");
});

Deno.test("computeInitials: whitespace-only → '?'", () => {
  assertEquals(computeInitials("   "), "?");
});

Deno.test("computeInitials: lowercase input gets uppercased", () => {
  assertEquals(computeInitials("diego riley"), "DR");
});

Deno.test("computeInitials: handles internal extra spaces", () => {
  assertEquals(computeInitials("Diego   Riley"), "DR");
});
