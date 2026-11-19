/**
 * REQ-988 (LOOP-007 q1, q1-71) — a deleted customer shows as "—" on
 * /payments, and its message link points to the deleted id.
 *
 * DELETE /customers/:id is a soft delete (REQ-802): the customer leaves the
 * live list, but every invoice carries a customerSnapshot {name, …} taken
 * when it was issued (invoice-store REQ-204). invoiceClientName — the shared
 * "whom does this invoice bill" helper (REQ-696) — only knew the live map and
 * billTo, so an invoice whose customer was deleted read "—".
 */
import { invoiceClientName } from "../../front-end/lib/invoice-client";

describe("REQ-988 q1-71 invoiceClientName — the snapshot name when the customer was deleted", () => {
  const noCustomers = new Map<string, string>();

  test("REQ-988: a deleted customer's invoice names the customerSnapshot, not '—'", () => {
    const inv = {
      customerId: "c-deleted",
      customerSnapshot: { name: "Linda Pérez" },
    };
    expect(invoiceClientName(inv, noCustomers)).toBe("Linda Pérez");
  });

  test("REQ-988: the snapshot's business name when it has no person name", () => {
    const inv = {
      customerId: "c-deleted",
      customerSnapshot: { name: " ", businessName: "Pérez Roofing" },
    };
    expect(invoiceClientName(inv, noCustomers)).toBe("Pérez Roofing");
  });

  test("REQ-988: the live customer still wins over the snapshot (a rename shows)", () => {
    const inv = {
      customerId: "c-1",
      customerSnapshot: { name: "Old Name" },
    };
    expect(invoiceClientName(inv, new Map([["c-1", "New Name"]]))).toBe(
      "New Name",
    );
  });

  test("REQ-988: the typed BILL TO name still wins over the snapshot", () => {
    const inv = {
      customerId: "c-deleted",
      billTo: { name: "Jorge Ruiz" },
      customerSnapshot: { name: "Linda Pérez" },
    };
    expect(invoiceClientName(inv, noCustomers)).toBe("Jorge Ruiz");
  });

  test("REQ-988: nothing anywhere is still '—'", () => {
    expect(invoiceClientName({ customerId: "c-deleted" }, noCustomers)).toBe(
      "—",
    );
  });
});
