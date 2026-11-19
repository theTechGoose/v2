/**
 * REQ-1081 — Raphael (LOOP-007): "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green". QA issue q3-16
 * (cycle 3): the /payments "Record a payment" picker read
 * "INV-002 · Greg Pruitt · $1,001" while the Amount field under it read
 * "1000.5". The option label formats the invoice with the whole-dollar
 * rollup formatter (fmtMoney) and prints the full total, not the balance.
 * REQ-961: a single invoice's amount is shown to the cent on owner screens.
 */
import { assert, assertStringIncludes } from "@std/assert";
import { recordOptionLabel } from "./payment-record-option.ts";

const inv = { number: "INV-002", amount: 100050 };

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1081 q3-16 (${lang}): a $1,000.50 invoice's picker option reads "$1,000.50", never the rounded "$1,001"`, () => {
    const label = recordOptionLabel(lang, inv, "Greg Pruitt");
    assert(!label.includes("$1,001"), `label rounds the cents: ${label}`);
    assertStringIncludes(label, "$1,000.50");
    assertStringIncludes(label, "INV-002");
    assertStringIncludes(label, "Greg Pruitt");
  });

  Deno.test(`REQ-1081 q3-16 (${lang}): a part-paid invoice's option shows the balance still owed ($500.50), not the full total`, () => {
    const label = recordOptionLabel(
      lang,
      { ...inv, paidCents: 50000 } as typeof inv & { paidCents: number },
      "Greg Pruitt",
    );
    assertStringIncludes(label, "$500.50");
    assert(!label.includes("$1,000"), `label shows the total: ${label}`);
    assert(!label.includes("$1,001"), `label shows the total: ${label}`);
  });
}
