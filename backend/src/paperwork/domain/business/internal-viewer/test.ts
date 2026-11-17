import { assertEquals } from "#std/assert";
import { isInternalViewer } from "./mod.ts";

// REQ-225 (demo M18 / test-setup-claims-m3): only the end customer's load of a
// public document counts as an "open". The owner, an admin acting for the
// account, and staff behind an impersonation session (the demo stage's replica,
// "view as customer") are internal viewers.

Deno.test("REQ-225: no session — the end customer — is not an internal viewer", () => {
  assertEquals(isInternalViewer(null, "owner-1"), false);
});

Deno.test("REQ-225: the owner's own session is an internal viewer", () => {
  assertEquals(isInternalViewer({ userId: "owner-1" }, "owner-1"), true);
});

Deno.test("REQ-225: an admin acting for the owner's account is an internal viewer", () => {
  assertEquals(
    isInternalViewer({ userId: "owner-1", actorId: "admin-9" }, "owner-1"),
    true,
  );
});

Deno.test("REQ-225: any impersonation session (staff, demo replica) is an internal viewer", () => {
  assertEquals(
    isInternalViewer(
      { userId: "owner-1", impersonatorId: "staff-1" },
      "owner-1",
    ),
    true,
  );
  assertEquals(
    isInternalViewer({ userId: "other", impersonatorId: "staff-1" }, "owner-1"),
    true,
  );
});

Deno.test("REQ-225: another account's session (a contractor who is also a customer) still counts", () => {
  assertEquals(isInternalViewer({ userId: "someone-else" }, "owner-1"), false);
});
