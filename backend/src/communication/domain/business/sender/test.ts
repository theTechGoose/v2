// REQ-123 — Raphael, 2026-10-27: "i do not want to SEND ANYTHING VIA monsterrg.com can we send
// everything via documonster instead?" — the one module that says where every email leaves from.
import { assert, assertEquals } from "#std/assert";
import { aliasFrom, fromDocumonster, HOUSE_FROM, SEND_DOMAIN, senderAddress } from "./mod.ts";

Deno.test("REQ-123 sender — every email leaves from documonster.com: the house From is DocuMonster <hello@documonster.com>, a business alias is <alias>@documonster.com, noreply@documonster.com without one, and any other domain is refused", () => {
  assertEquals(SEND_DOMAIN, "documonster.com");
  assertEquals(HOUSE_FROM, '"DocuMonster" <hello@documonster.com>');
  assertEquals(senderAddress(HOUSE_FROM), "hello@documonster.com");

  // the per-business alias system (roadmap p.7) keeps its alias, on documonster.com
  assertEquals(aliasFrom("acme-roofing"), "acme-roofing@documonster.com");
  assertEquals(aliasFrom("  acme-roofing "), "acme-roofing@documonster.com", "trimmed");
  assertEquals(aliasFrom(undefined), "noreply@documonster.com", "no alias on file");
  assertEquals(aliasFrom(""), "noreply@documonster.com", "an empty alias");
  assertEquals(aliasFrom("Acme Roofing"), "noreply@documonster.com", "not a slug — never an address");
  assertEquals(aliasFrom("acme@monsterrg.com"), "noreply@documonster.com", "an address is not an alias");

  // the seam's rule: a From on documonster.com, display name or bare, and nothing else
  assert(fromDocumonster(HOUSE_FROM));
  assert(fromDocumonster("hello@documonster.com"));
  assert(fromDocumonster("Hello@DocuMonster.com"), "case-insensitive");
  assert(fromDocumonster("acme-roofing@documonster.com"));
  assert(fromDocumonster("Acme Roofing <acme-roofing@documonster.com>"));
  assertEquals(fromDocumonster("warnings@monsterrg.com"), false, "the box env's sender");
  assertEquals(fromDocumonster("rafac@monsterrg.com"), false, "main/.env's sender");
  assertEquals(fromDocumonster("noreply@quotejefe.com"), false, "prod's sender until now");
  assertEquals(fromDocumonster("hans-llc@paperworkmonster.com"), false, "the old alias domain");
  assertEquals(fromDocumonster('"DocuMonster" <x@documonster.com.evil.test>'), false, "a lookalike");
  assertEquals(fromDocumonster("x@notdocumonster.com"), false, "a suffix match is not the domain");
  assertEquals(fromDocumonster(""), false);
});
