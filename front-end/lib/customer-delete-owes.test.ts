/**
 * REQ-1138 (LOOP-007 q3, q3-69) — the delete question for a customer who still owes money names the
 * balance; the board and the sheet learn it from the 409 customer_owes answer; a deleted customer's
 * open invoice never points at her 404 page.
 */
import { assertEquals } from "@std/assert";
import {
  owesAskVars,
  owesFromError,
  owesFromInvoices,
} from "./customer-delete-owes.ts";
import { liveCustomerId } from "./invoice-client.ts";
import { ApiError } from "./api.ts";
import { tFor } from "./i18n.ts";

Deno.test("REQ-1138 (q3-69) owesFromInvoices — the open rows (balance > 0) and their total; nothing open → null", () => {
  assertEquals(
    owesFromInvoices([
      { number: "INV-001", balanceCents: 820_67 },
      { number: "INV-002", balanceCents: 0 },
      { number: "INV-003", balanceCents: 100_00 },
    ]),
    { owedCents: 920_67, invoices: ["INV-001", "INV-003"] },
  );
  assertEquals(
    owesFromInvoices([{ number: "INV-002", balanceCents: 0 }]),
    null,
  );
  assertEquals(owesFromInvoices([]), null);
});

Deno.test("REQ-1138 (q3-69) owesFromError — only a 409 customer_owes with money on it", () => {
  const body = {
    ok: false,
    code: "customer_owes",
    owedCents: 82067,
    invoices: ["INV-001"],
  };
  assertEquals(owesFromError(new ApiError(409, body)), {
    owedCents: 82067,
    invoices: ["INV-001"],
  });
  assertEquals(owesFromError(new ApiError(409, { code: "other" })), null);
  assertEquals(owesFromError(new ApiError(404, body)), null);
  assertEquals(owesFromError(new Error("boom")), null);
  assertEquals(owesFromError(null), null);
});

Deno.test("REQ-1138 (q3-69) the owes question names the amount to the cent and the invoices, in en and es", () => {
  const vars = owesAskVars("Lucía", {
    owedCents: 820_67,
    invoices: ["INV-001"],
  });
  assertEquals(vars.amount, "$820.67");
  const en = tFor("en", "clientsBoard.panel.deleteAskOwes", vars);
  const es = tFor("es", "clientsBoard.panel.deleteAskOwes", vars);
  for (const s of [en, es]) {
    assertEquals(
      s.includes("Lucía") && s.includes("$820.67") && s.includes("INV-001"),
      true,
      s,
    );
  }
  assertEquals(tFor("en", "clientsBoard.panel.deleteAnyway"), "Delete anyway");
  assertEquals(
    tFor("es", "clientsBoard.panel.deleteAnyway"),
    "Eliminar de todos modos",
  );
});

Deno.test("REQ-1138 (q3-69) liveCustomerId — a customer not on the live list is no link target", () => {
  const live = new Map([["c1", "Ana"]]);
  assertEquals(liveCustomerId({ customerId: "c1" }, live), "c1");
  assertEquals(liveCustomerId({ customerId: "gone" }, live), null);
  assertEquals(liveCustomerId({}, live), null);
});
