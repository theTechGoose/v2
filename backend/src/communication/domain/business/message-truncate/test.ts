import { assertEquals } from "#std/assert";
import { truncateContent } from "./mod.ts";

Deno.test("truncateContent: returns content unchanged when within limit", () => {
  assertEquals(truncateContent({ content: "hi" }, 10), "hi");
});

Deno.test("truncateContent: trims and appends ellipsis when too long", () => {
  assertEquals(truncateContent({ content: "abcdefghij" }, 5), "abcd…");
});

Deno.test("truncateContent: handles tiny maxLength without ellipsis math errors", () => {
  assertEquals(truncateContent({ content: "abcdef" }, 1), "a");
});
