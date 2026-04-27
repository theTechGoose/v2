import { assertEquals } from "#std/assert";
import { formatDisplayName } from "./mod.ts";

Deno.test("formatDisplayName: name only when no email", () => {
  assertEquals(formatDisplayName({ name: "Acme" }), "Acme");
});

Deno.test("formatDisplayName: name <email> when email present", () => {
  assertEquals(
    formatDisplayName({ name: "Acme", email: "ops@acme.test" }),
    "Acme <ops@acme.test>",
  );
});
