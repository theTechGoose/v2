/**
 * REQ-993 (LOOP-007 q1, q1-75) — a customer page left open after she was deleted in another tab.
 * Send invoice re-reads the customer list; when she is no longer in it the page must not open a
 * blank new-invoice form. The decision is the pure `invoiceFormTarget(customers, id)`:
 * "open" when she is still in the fetched list, "missing" when she is gone.
 */
import { invoiceFormTarget } from "../../front-end/lib/customer-nav";

describe("REQ-993 Send invoice on a deleted customer's page", () => {
  const list = [{ id: "ana" }, { id: "bob" }];

  test("REQ-993: she is still in the fetched list → open the form with her chosen", () => {
    expect(typeof invoiceFormTarget).toBe("function");
    expect(invoiceFormTarget(list, "ana")).toBe("open");
  });

  test("REQ-993: she is gone from the fetched list → 'missing', not a blank form", () => {
    expect(typeof invoiceFormTarget).toBe("function");
    expect(invoiceFormTarget(list, "gone")).toBe("missing");
    expect(invoiceFormTarget([], "ana")).toBe("missing");
  });
});
