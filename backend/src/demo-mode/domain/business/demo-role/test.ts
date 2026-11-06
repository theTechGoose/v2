// REQ-153 — who a session is in a demo: the demo's super admin (impersonating or not) presents,
// the target user on their own session views, anyone else is nobody; an ended demo has no roles.
import { assertEquals } from "#std/assert";
import { roleFor } from "./mod.ts";

const demo = {
  id: "d1",
  targetUserId: "ana",
  presenterUserId: "hans",
  createdAt: "2026-11-05T00:00:00Z",
};

Deno.test("REQ-153 roleFor — the super admin impersonating the target is the presenter", () => {
  assertEquals(
    roleFor(
      { userId: "ana", impersonatorId: "hans" },
      { superAdmin: false },
      demo,
    ),
    "presenter",
  );
});

Deno.test("REQ-153 roleFor — the super admin on their own session is the presenter too", () => {
  assertEquals(
    roleFor({ userId: "hans" }, { superAdmin: true }, demo),
    "presenter",
  );
});

Deno.test("REQ-153 roleFor — the target user on their own session is the viewer", () => {
  assertEquals(
    roleFor({ userId: "ana" }, { superAdmin: false }, demo),
    "viewer",
  );
});

Deno.test("REQ-153 roleFor — a stranger, another admin impersonating, or a demoted presenter is nobody", () => {
  assertEquals(roleFor({ userId: "carl" }, { superAdmin: false }, demo), null);
  assertEquals(
    roleFor(
      { userId: "ana", impersonatorId: "other" },
      { superAdmin: false },
      demo,
    ),
    null,
  );
  assertEquals(roleFor({ userId: "hans" }, { superAdmin: false }, demo), null);
});

Deno.test("REQ-153 roleFor — an ended demo has no roles", () => {
  assertEquals(
    roleFor({ userId: "ana" }, { superAdmin: false }, {
      ...demo,
      endedAt: "2026-11-05T01:00:00Z",
    }),
    null,
  );
});
