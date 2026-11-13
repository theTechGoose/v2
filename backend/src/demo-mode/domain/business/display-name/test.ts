// REQ-355 (demo cycle 1, m1 / setup-m8) — the seeded sign-in placeholder ("New user" /
// "Nuevo usuario") is not a name: a demo never shows it. A presenter without a real name is
// the brand ("DocuMonster is guiding you"); a customer without one is their phone number.
import { assertEquals } from "#std/assert";
import {
  PRESENTER_FALLBACK_NAME,
  presenterNameOf,
  targetNameOf,
} from "./mod.ts";

Deno.test("REQ-355 presenterNameOf — a real name is kept (trimmed)", () => {
  assertEquals(presenterNameOf({ name: "  Hans Weber " }), "Hans Weber");
});

Deno.test("REQ-355 presenterNameOf — the Spanish and English placeholders become the brand", () => {
  assertEquals(PRESENTER_FALLBACK_NAME, "DocuMonster");
  assertEquals(presenterNameOf({ name: "Nuevo usuario" }), "DocuMonster");
  assertEquals(presenterNameOf({ name: " New user " }), "DocuMonster");
});

Deno.test("REQ-355 presenterNameOf — no name at all becomes the brand", () => {
  assertEquals(presenterNameOf({ name: undefined }), "DocuMonster");
  assertEquals(presenterNameOf({ name: "  " }), "DocuMonster");
  assertEquals(presenterNameOf(undefined), "DocuMonster");
});

Deno.test("REQ-355 targetNameOf — a real name is kept; a placeholder or nothing is the phone", () => {
  assertEquals(
    targetNameOf({ name: "Ana Torres", phoneNumber: "+15125553001" }),
    "Ana Torres",
  );
  assertEquals(
    targetNameOf({ name: "Nuevo usuario", phoneNumber: "+15125553001" }),
    "+15125553001",
  );
  assertEquals(
    targetNameOf({ name: "New user", phoneNumber: "+15125553001" }),
    "+15125553001",
  );
  assertEquals(
    targetNameOf({ name: undefined, phoneNumber: "+15125553001" }),
    "+15125553001",
  );
});
