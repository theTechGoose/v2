import { assertEquals } from "#std/assert";
import {
  isOpenReceivable,
  isUpcomingReceivable,
  receivableBalanceCents,
} from "./mod.ts";

// REQ-397 (demo-loop cycle 2, M14): one rule for "money a customer owes now".
// The dashboard filtered `status === "pending"`, a status accept never writes
// (it writes INV-001 "sent", INV-002 "scheduled"), so a $9,600 sent invoice
// counted as $0 outstanding.

Deno.test("REQ-397 isOpenReceivable: sent / viewed / claimed (and legacy pending) with a balance are owed now", () => {
  for (const status of ["sent", "viewed", "claimed", "pending"]) {
    assertEquals(
      isOpenReceivable({ status, amount: 960_000 }),
      true,
      `${status} is an open receivable`,
    );
  }
});

Deno.test("REQ-397 isOpenReceivable: scheduled, draft, paid, void are not owed now", () => {
  for (const status of ["scheduled", "draft", "paid", "void", undefined]) {
    assertEquals(
      isOpenReceivable({ status, amount: 960_000 }),
      false,
      `${status} is not an open receivable`,
    );
  }
});

Deno.test("REQ-397 isOpenReceivable: a paidAt stamp or a fully covered balance closes it", () => {
  assertEquals(
    isOpenReceivable({ status: "sent", amount: 500_00, paidAt: "2026-04-01" }),
    false,
  );
  assertEquals(
    isOpenReceivable({ status: "pending", amount: 500_00, paidCents: 500_00 }),
    false,
  );
  assertEquals(
    isOpenReceivable({ status: "pending", amount: 500_00, paidCents: 200_00 }),
    true,
  );
});

Deno.test("REQ-397 receivableBalanceCents: amount minus what was paid, never negative", () => {
  assertEquals(receivableBalanceCents({ amount: 960_000 }), 960_000);
  assertEquals(
    receivableBalanceCents({ amount: 500_00, paidCents: 200_00 }),
    300_00,
  );
  assertEquals(
    receivableBalanceCents({ amount: 500_00, paidCents: 700_00 }),
    0,
  );
  assertEquals(receivableBalanceCents({}), 0);
});

Deno.test("REQ-397 isUpcomingReceivable: an unpaid scheduled installment is upcoming, not owed", () => {
  assertEquals(
    isUpcomingReceivable({ status: "scheduled", amount: 500_00 }),
    true,
  );
  assertEquals(isUpcomingReceivable({ status: "sent", amount: 500_00 }), false);
  assertEquals(
    isUpcomingReceivable({ status: "scheduled", amount: 500_00, paidAt: "x" }),
    false,
  );
});
