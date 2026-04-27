import { assertEquals } from "#std/assert";
import { isSigned } from "./mod.ts";

Deno.test("isSigned: false when neither signedAt nor status=signed", () => {
  assertEquals(isSigned({}), false);
  assertEquals(isSigned({ status: "draft" }), false);
});

Deno.test("isSigned: true when signedAt is present", () => {
  assertEquals(isSigned({ signedAt: "2026-04-26T00:00:00Z" }), true);
});

Deno.test("isSigned: true when status === 'signed'", () => {
  assertEquals(isSigned({ status: "signed" }), true);
});
