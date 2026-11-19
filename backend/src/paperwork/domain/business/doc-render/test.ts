/**
 * REQ-949 (LOOP-007 q1, q1-25) — a change order names its invoice only when
 * that invoice has been issued. A draft or scheduled balance invoice is one
 * the customer never received, so "CO-001 on INV-002" points them at a
 * document they have never seen.
 */
import { assert, assertEquals } from "#std/assert";
import { changeOrderRef } from "./mod.ts";

const co = { id: "co-1", number: "CO-001" };

Deno.test("REQ-949 changeOrderRef: a SENT invoice is named — 'CO-001 on INV-002' (REQ-204 kept)", () => {
  const sent = {
    id: "inv-2",
    number: "INV-002",
    status: "sent",
    sentAt: "2026-11-01T12:00:00Z",
  };
  assertEquals(changeOrderRef(co, sent, "en"), "CO-001 on INV-002");
});

for (const status of ["scheduled", "draft"]) {
  Deno.test(`REQ-949 changeOrderRef: a ${status.toUpperCase()} invoice never sent is not named`, () => {
    const unsent = { id: "inv-2", number: "INV-002", status };
    for (const lang of ["en", "es"] as const) {
      const ref = changeOrderRef(co, unsent, lang);
      assert(
        !ref.includes("INV-002"),
        `${lang}: an unsent ${status} invoice must not be cited, got "${ref}"`,
      );
      assert(ref.includes("CO-001"), `${lang}: still names CO-001, got "${ref}"`);
    }
  });
}
