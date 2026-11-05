/** REQ-146 — the pure rules of account admins: where a sign-in lands, how an account is labelled, what an invite refuses. */
import { assertEquals } from "#std/assert";
import { accountLabel, inviteCheck, pickSignInAccount } from "./mod.ts";

Deno.test("REQ-146 pickSignInAccount — no memberships: the person's own account, not acting", () => {
  assertEquals(pickSignInAccount("u-self", []), { userId: "u-self", actorId: undefined });
});

Deno.test("REQ-146 pickSignInAccount — a membership opens the session IN that account, the person as the actor; the earliest invite wins", () => {
  const later = { id: "a2", userId: "owner-2", phoneNumber: "+15125550002", createdAt: "2026-11-05T10:00:00.000Z" };
  const earlier = { id: "a1", userId: "owner-1", phoneNumber: "+15125550002", createdAt: "2026-11-04T10:00:00.000Z" };
  assertEquals(pickSignInAccount("u-self", [later, earlier]), { userId: "owner-1", actorId: "u-self" });
});

Deno.test("REQ-146 accountLabel — the business name, else the owner's name, else the phone", () => {
  assertEquals(accountLabel({ phoneNumber: "+15125550001", name: "Raphael" }, "Monster RG"), "Monster RG");
  assertEquals(accountLabel({ phoneNumber: "+15125550001", name: "Raphael" }, undefined), "Raphael");
  assertEquals(accountLabel({ phoneNumber: "+15125550001", name: "  " }, "  "), "+15125550001");
  assertEquals(accountLabel({ phoneNumber: "+15125550001", name: "Nuevo usuario" }, undefined), "+15125550001", "the sign-up placeholder is no name");
});

Deno.test("REQ-146 inviteCheck — the owner's own number is refused, any other E.164 passes", () => {
  assertEquals(inviteCheck("+15125550001", "+15125550001"), "own_number");
  assertEquals(inviteCheck("+15125550001", "+15125550002"), null);
});
