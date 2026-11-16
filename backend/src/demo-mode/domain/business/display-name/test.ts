// REQ-355 (demo cycle 1, m1 / setup-m8) — the seeded sign-in placeholder ("New user" /
// "Nuevo usuario") is not a name: a demo never shows it. A presenter without a real name is
// the brand ("DocuMonster is guiding you"); a customer without one is their phone number (REQ-836: formatted, "(512) 555-3001").
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

Deno.test("REQ-355 + REQ-836 targetNameOf — a real name is kept; a placeholder or nothing is the phone, formatted", () => {
  assertEquals(
    targetNameOf({ name: "Ana Torres", phoneNumber: "+15125553001" }),
    "Ana Torres",
  );
  assertEquals(
    targetNameOf({ name: "Nuevo usuario", phoneNumber: "+15125553001" }),
    "(512) 555-3001",
  );
  assertEquals(
    targetNameOf({ name: "New user", phoneNumber: "+15125553001" }),
    "(512) 555-3001",
  );
  assertEquals(
    targetNameOf({ name: undefined, phoneNumber: "+15125553001" }),
    "(512) 555-3001",
  );
});

// REQ-836 (demo-loop cycle dm2, m1) — the stage named an unnamed customer "+15125550400" while
// /admin showed the same person as "(512) 555-0400": the placeholder label is the phone as the
// app shows it everywhere (shared fmtPhone), never an E.164 '+' string.
Deno.test("REQ-836 targetNameOf — an unnamed customer's label never carries a '+'; a non-NANP number stays readable", () => {
  for (const phoneNumber of ["+15125550400", "15125550400", "5125550400"]) {
    const label = targetNameOf({ name: "New user", phoneNumber });
    assertEquals(label, "(512) 555-0400");
    assertEquals(label.includes("+"), false);
  }
  assertEquals(
    targetNameOf({ name: undefined, phoneNumber: "+442071234567" }),
    "+442071234567",
  );
});
