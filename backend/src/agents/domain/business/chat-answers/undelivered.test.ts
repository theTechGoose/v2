/**
 * REQ-556 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M7 (pair 7): a minute after "Couldn't
 * send… reserved test number", the assistant said INV-001 "went out
 * automatically". billingReply said so for every first milestone signing
 * billed, without reading a delivery result. Signing now records it
 * (`deliveredVia`, REQ-556); an empty record means nothing reached the
 * customer, and the reply says the invoice is ready but couldn't be delivered.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { billingReply } from "./mod.ts";

const SIGNED = {
  id: "q-1",
  status: "accepted",
  acceptedAt: "2026-11-12T05:35:18Z",
  customerSnapshot: { name: "John Miller" },
};
const DEPOSIT = {
  id: "inv-1",
  number: "INV-001",
  quoteId: "q-1",
  status: "sent",
  amount: 160_000,
  dueDate: "2026-11-19",
  installmentIndex: 1,
  installmentTotal: 2,
  createdAt: "2026-11-12T05:35:19Z",
};
const FULL = { ...DEPOSIT, installmentTotal: 1 };

Deno.test("REQ-556 (M7) billingReply: a deposit signing billed that reached nobody → 'ready but couldn't be delivered', never 'went out automatically'", () => {
  const r = billingReply("en", SIGNED, [{ ...DEPOSIT, deliveredVia: [] }]);
  assert(!/went out/i.test(r.text), r.text);
  assertStringIncludes(r.text, "INV-001");
  assertStringIncludes(r.text, "deposit");
  assertStringIncludes(r.text, "couldn't be delivered");
  assertStringIncludes(r.text, "Nov 19");
});

Deno.test("REQ-556 (M7) billingReply: Spanish, a single invoice → 'no se pudo entregar', never 'se envió automáticamente'", () => {
  const r = billingReply("es", SIGNED, [{ ...FULL, deliveredVia: [] }]);
  assert(!/se envió/i.test(r.text), r.text);
  assertStringIncludes(r.text, "INV-001");
  assertStringIncludes(r.text, "no se pudo entregar");
});

Deno.test("REQ-556 (M7) billingReply: delivered (or signed before delivery was recorded) → still 'went out automatically'", () => {
  for (const inv of [{ ...DEPOSIT, deliveredVia: ["email"] }, DEPOSIT]) {
    assertStringIncludes(
      billingReply("en", SIGNED, [inv]).text,
      "went out automatically",
    );
  }
});
