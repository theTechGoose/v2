/**
 * REQ-622 (demo-loop cycle 4, issue p4-p6c): Settings had two payment-term
 * settings — "Days to pay an invoice" (identity.invoiceNetDays, read by the
 * invoice form) and a dead Contract defaults "Payment terms (days)"
 * (contract-defaults paymentTermsDays, read by nothing). invoiceNetDays is
 * the single source now; a stored paymentTermsDays moves into it only when
 * invoiceNetDays was never set.
 */
import { assertEquals } from "#std/assert";
import { legacyNetDays } from "./mod.ts";

Deno.test("REQ-622 p4-p6c: a stored paymentTermsDays migrates when invoiceNetDays is unset", () => {
  assertEquals(legacyNetDays(null, { paymentTermsDays: 45 }), 45);
  assertEquals(legacyNetDays({}, { paymentTermsDays: 0 }), 0);
});

Deno.test("REQ-622 p4-p6c: an invoiceNetDays already set always wins", () => {
  assertEquals(
    legacyNetDays({ invoiceNetDays: 30 }, { paymentTermsDays: 45 }),
    undefined,
  );
  assertEquals(
    legacyNetDays({ invoiceNetDays: 0 }, { paymentTermsDays: 45 }),
    undefined,
  );
});

Deno.test("REQ-622 p4-p6c: nothing to migrate without a valid stored day count", () => {
  assertEquals(legacyNetDays(null, null), undefined);
  assertEquals(legacyNetDays(null, {}), undefined);
  assertEquals(legacyNetDays(null, { paymentTermsDays: "45" }), undefined);
  assertEquals(legacyNetDays(null, { paymentTermsDays: -3 }), undefined);
  assertEquals(legacyNetDays(null, { paymentTermsDays: 12.5 }), undefined);
  assertEquals(legacyNetDays(null, { paymentTermsDays: 400 }), undefined);
});
