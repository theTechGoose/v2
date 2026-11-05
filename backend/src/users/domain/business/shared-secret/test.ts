/** REQ-154 — the owner tools' shared-secret gate (the one /me/reset-by-phone has had): refused unless the secret is set, 16+ characters and exactly the one provided. */
import { assertEquals } from "#std/assert";
import { constantTimeEqual, secretAllows } from "./mod.ts";

Deno.test("REQ-154 secretAllows — refused when the secret is unset, short, or different; allowed on the exact value", () => {
  assertEquals(secretAllows(undefined, "anything-at-all-here"), false);
  assertEquals(secretAllows("", ""), false);
  assertEquals(
    secretAllows("short-secret", "short-secret"),
    false,
    "under 16 characters is never live",
  );
  assertEquals(
    secretAllows("a-long-enough-secret-1", "a-long-enough-secret-2"),
    false,
  );
  assertEquals(secretAllows("a-long-enough-secret-1", ""), false);
  assertEquals(
    secretAllows("a-long-enough-secret-1", "a-long-enough-secret-1"),
    true,
  );
});

Deno.test("REQ-154 constantTimeEqual — length-checked, same bytes", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
  assertEquals(constantTimeEqual("abc", "abd"), false);
  assertEquals(constantTimeEqual("abc", "ab"), false);
});
