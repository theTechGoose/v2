import { assertEquals } from "#std/assert";
import {
  duplicateDraftOf,
  MAX_BULK_IDS,
  removalFor,
} from "#documents/removal.ts";

// REQ-627 — "they want to be able to remove invoices (BUT WHAT IS THE PROCESS?)"
Deno.test("REQ-627 removalFor: a draft, a scheduled or a status-less invoice with no payments is deleted", () => {
  for (const status of ["draft", "scheduled", undefined]) {
    assertEquals(removalFor({ status }, 0).action, "delete", String(status));
  }
});

Deno.test("REQ-627 removalFor: a sent invoice (the customer may have seen it) is voided, never deleted", () => {
  for (const status of ["sent", "viewed", "claimed", "pending"]) {
    assertEquals(removalFor({ status }, 0).action, "void", status);
  }
  // a draft that went out once (sentAt stamped) is still "sent" for removal
  assertEquals(
    removalFor({ status: "draft", sentAt: "2026-11-01T00:00:00Z" }, 0).action,
    "void",
  );
});

Deno.test("REQ-627 removalFor: any payment on it means void, even on a draft", () => {
  assertEquals(removalFor({ status: "draft" }, 1).action, "void");
  assertEquals(
    removalFor({ status: "draft", paidCents: 500 }, 0).action,
    "void",
  );
  assertEquals(removalFor({ status: "sent" }, 2).hasPayments, true);
});

Deno.test("REQ-627 removalFor: paid is locked; void is already removed", () => {
  const paid = removalFor({ status: "paid" }, 1);
  assertEquals(paid.action, "locked");
  assertEquals(paid.reason, "locked_paid");
  const v = removalFor({ status: "void" }, 0);
  assertEquals(v.action, "none");
  assertEquals(v.reason, "already_void");
});

Deno.test("REQ-627 duplicateDraftOf: copies the bill's content as a fresh draft — no number, no status history, no payments", () => {
  const copy = duplicateDraftOf({
    id: "old",
    userId: "u",
    seq: 7,
    number: "INV-007",
    status: "sent",
    sentAt: "x",
    issuedDate: "2026-11-01",
    paidCents: 100,
    paymentIntent: { method: "zelle" },
    customerId: "c1",
    quoteId: "q1",
    jobName: "Mow",
    description: "Front + back",
    lineItems: [{
      description: "Mow",
      quantity: 1,
      unit: "visit",
      price: 6500,
    }],
    amount: 6500,
    discountCents: 0,
    taxRateBp: 825,
    paymentInstructions: "Zelle me",
    billTo: { name: "Ana" },
    netDays: 15,
  });
  assertEquals(copy.status, "draft");
  assertEquals(copy.customerId, "c1");
  assertEquals(copy.quoteId, "q1");
  assertEquals(copy.amount, 6500);
  assertEquals((copy.lineItems as unknown[]).length, 1);
  assertEquals(copy.taxRateBp, 825);
  assertEquals(copy.billTo, { name: "Ana" });
  assertEquals(copy.replaces, "old");
  for (
    const k of [
      "id",
      "userId",
      "seq",
      "number",
      "sentAt",
      "issuedDate",
      "paidCents",
      "paymentIntent",
    ]
  ) {
    assertEquals(k in copy, false, k);
  }
});

// REQ-964 (LOOP-007 q1, q1-40) — REQ-627 AMENDMENT, refs REQ-926: the fresh
// draft never carries the voided bill's stale past due date nor its
// chargeback fee line (whose chargebackFor link undo can never reach).
// The copy takes today's date so it stays pure; see requirements.md REQ-964.
const duplicateOn = duplicateDraftOf as unknown as (
  inv: Record<string, unknown> & { id: string },
  todayIso: string,
) => Record<string, unknown>;

Deno.test("REQ-964 duplicateDraftOf: the copy's due date is counted from today (netDays), never the voided bill's past due date", () => {
  const copy = duplicateOn({
    id: "inv2",
    status: "sent",
    issuedDate: "2026-10-17",
    dueDate: "2026-11-01",
    netDays: 15,
    jobName: "Fence",
    lineItems: [{
      description: "Fence",
      quantity: 1,
      unit: "job",
      price: 100000,
    }],
    amount: 100000,
    subtotalCents: 100000,
  }, "2026-11-19");
  assertEquals(copy.netDays, 15);
  assertEquals(copy.dueDate, "2026-12-04", "today + netDays, not 2026-11-01");
});

Deno.test("REQ-964 duplicateDraftOf: a chargeback fee line (chargebackFor) is not carried into the copy, and its cents leave amount/subtotal", () => {
  const copy = duplicateOn({
    id: "inv2",
    status: "sent",
    dueDate: "2026-11-01",
    netDays: 15,
    jobName: "Fence",
    lineItems: [
      { description: "Fence", quantity: 1, unit: "job", price: 100000 },
      {
        description: "Chargeback fee",
        quantity: 1,
        unit: "fee",
        price: 3500,
        chargebackFor: "p1",
      },
    ],
    amount: 103500,
    subtotalCents: 103500,
  }, "2026-11-19");
  const lines = copy.lineItems as Array<Record<string, unknown>>;
  assertEquals(
    lines.filter((l) => l.chargebackFor !== undefined).length,
    0,
    `no line linked to a payment on the voided bill: ${JSON.stringify(lines)}`,
  );
  assertEquals(lines.length, 1);
  assertEquals(copy.amount, 100000, "the $35 fee is not folded into the copy");
  assertEquals(copy.subtotalCents, 100000);
});

Deno.test("REQ-627/629 MAX_BULK_IDS is 500", () => {
  assertEquals(MAX_BULK_IDS, 500);
});
