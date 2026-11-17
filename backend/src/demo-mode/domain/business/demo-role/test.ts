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

// REQ-214 — several presenters: any listed super admin presents (own session or impersonating
// the target); an admin not on the list is nobody; a demo written before the list still works.
import { presenterIdFor, presentersOf } from "./mod.ts";
import { PRESENTER_COLORS } from "#demo-mode/protocol.ts";

const two = {
  ...demo,
  id: "d2",
  presenters: [
    { userId: "hans", name: "Hans", color: PRESENTER_COLORS[0] },
    { userId: "lia", name: "Lia", color: PRESENTER_COLORS[1] },
  ],
};

Deno.test("REQ-214 presenterIdFor — the second presenter impersonating the target presents as themselves", () => {
  assertEquals(
    presenterIdFor(
      { userId: "ana", impersonatorId: "lia" },
      { superAdmin: false },
      two,
    ),
    "lia",
  );
  assertEquals(
    roleFor(
      { userId: "ana", impersonatorId: "lia" },
      { superAdmin: false },
      two,
    ),
    "presenter",
  );
  assertEquals(
    presenterIdFor(
      { userId: "ana", impersonatorId: "hans" },
      { superAdmin: false },
      two,
    ),
    "hans",
  );
});

Deno.test("REQ-214 presenterIdFor — a listed super admin on their own session presents; demoted, or not listed, they are nobody", () => {
  assertEquals(
    presenterIdFor({ userId: "lia" }, { superAdmin: true }, two),
    "lia",
  );
  assertEquals(
    presenterIdFor({ userId: "lia" }, { superAdmin: false }, two),
    null,
  );
  assertEquals(
    presenterIdFor({ userId: "carl" }, { superAdmin: true }, two),
    null,
  );
  assertEquals(
    presenterIdFor(
      { userId: "ana", impersonatorId: "carl" },
      { superAdmin: false },
      two,
    ),
    null,
  );
  assertEquals(
    roleFor({ userId: "ana" }, { superAdmin: false }, two),
    "viewer",
  );
  assertEquals(
    presenterIdFor({ userId: "lia" }, { superAdmin: true }, {
      ...two,
      endedAt: "2026-11-05T01:00:00Z",
    }),
    null,
  );
});

Deno.test("REQ-214 a demo written before the list has its one presenter, in the first colour", () => {
  assertEquals(presentersOf(demo), [
    { userId: "hans", name: "", color: PRESENTER_COLORS[0] },
  ]);
  assertEquals(
    presenterIdFor({ userId: "hans" }, { superAdmin: true }, demo),
    "hans",
  );
  assertEquals(presentersOf(two), two.presenters);
});
