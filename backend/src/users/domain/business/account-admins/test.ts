/** REQ-146 — the pure rules of account admins: where a sign-in lands, how an account is labelled, what an invite refuses. */
import { assertEquals } from "#std/assert";
import {
  accountLabel,
  actorName,
  inviteCheck,
  inviteName,
  personLanguage,
  pickSignInAccount,
  splitActingPatch,
} from "./mod.ts";

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

Deno.test("REQ-624 actorName — the signed-in person's own real name wins over the invite's", () => {
  assertEquals(actorName({ phoneNumber: "+18435550101", name: "Daughter Test" }, "Hija"), {
    name: "Daughter Test",
    needsName: false,
  });
});

Deno.test("REQ-624 actorName — no real name of her own (the sign-up placeholder): the name the owner typed on the invite", () => {
  assertEquals(actorName({ phoneNumber: "+18435550101", name: "New user" }, "Daughter Test"), {
    name: "Daughter Test",
    needsName: false,
  });
  assertEquals(actorName({ phoneNumber: "+18435550101", name: "Nuevo usuario" }, "  Hija  "), {
    name: "Hija",
    needsName: false,
  });
});

Deno.test("REQ-624 actorName — neither: her formatted phone, and she is asked her name", () => {
  assertEquals(actorName({ phoneNumber: "+18435550101", name: "New user" }, undefined), {
    name: "(843) 555-0101",
    needsName: true,
  });
  assertEquals(actorName({ phoneNumber: "+18435550101" }, "   "), {
    name: "(843) 555-0101",
    needsName: true,
  });
  assertEquals(actorName({ phoneNumber: "+447700900123" }, undefined).name, "+447700900123", "a non-US number as stored");
});

Deno.test("REQ-631 actorPatch — while acting, the name, the email AND the language are the person's own; nothing reaches the account", () => {
  assertEquals(splitActingPatch({ name: "Daughter Test", email: "d@x.co", language: "es" }), {
    actor: { name: "Daughter Test", email: "d@x.co", language: "es" },
    account: {},
  });
  assertEquals(splitActingPatch({ name: "Daughter Test" }), { actor: { name: "Daughter Test" }, account: {} });
  assertEquals(splitActingPatch({ language: "en" }), { actor: { language: "en" }, account: {} });
});

Deno.test("REQ-631 personLanguage — the signed-in person's language: hers while acting, the account's on its own session", () => {
  const owner = { language: "en" as const };
  assertEquals(personLanguage(owner, null), "en", "the owner's own session");
  assertEquals(personLanguage(owner, { language: "es" }), "es", "the editor's, never the owner's");
  assertEquals(personLanguage({ language: "es" as const }, { language: "en" }), "en");
  assertEquals(personLanguage(owner, {}), "en", "an editor with no language of her own yet: the account's");
  assertEquals(personLanguage({}, null), undefined, "neither: unset (callers keep their default)");
});

Deno.test("REQ-632 inviteName — a real name is required: missing, blank, whitespace and the sign-up placeholder are refused", () => {
  assertEquals(inviteName("  Sofia Jerez "), "Sofia Jerez");
  assertEquals(inviteName("x".repeat(200))?.length, 120, "capped at 120");
  for (const bad of [undefined, null, 42, "", "   ", "\t\n", "New user", "Nuevo usuario", " nuevo usuario "]) {
    assertEquals(inviteName(bad), null, `refused: ${JSON.stringify(bad)}`);
  }
});
