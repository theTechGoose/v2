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

Deno.test("REQ-627/629 MAX_BULK_IDS is 500", () => {
  assertEquals(MAX_BULK_IDS, 500);
});
