/**
 * REQ-1073 — LOOP-007 cycle 2, issue q2-62 [minor/BUG_CONTRADICTION]: "One
 * part-paid invoice shows four different statuses across screens".
 *
 * QA issued INV-001 for $1,190.75 and recorded $500. ComputeInvoiceBalance
 * stores status "pending". Then:
 *   customer Invoices tab → "Pago parcial"   (CustomerWorkspace invoicePill)
 *   /invoices             → "Enviada"        (InvoicesPage enrich → stage "out")
 *   header search         → "Enviada", $1,190.75 (search.ts invoiceState + amountCents: i.amount)
 *   /i                    → "Pendiente"      (invoiceStatusPill → kind "due")
 * REQ-966 already defines "partly paid" for this case (invoiceDisplayStatus),
 * but only the CSV uses it. Every screen must say "Partly paid" / "Pago
 * parcial", and the search hit must carry the balance still owed.
 */
import * as fs from "fs";
import * as path from "path";
import { searchRecords } from "../../shared/documents/search";
import {
  invoiceDisplayStatus,
  invoicePillFlags,
  invoiceStatusPill,
} from "../../shared/documents/invoice-status";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const now = new Date();
const day = (offset: number) =>
  new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

/** INV-001, $1,190.75, $500 paid, due in two weeks — as the store holds it */
const partPaid = {
  id: "i1",
  number: "INV-001",
  seq: 1,
  customerId: "c1",
  amount: 119075,
  paidCents: 50000,
  status: "pending",
  issuedDate: day(-1),
  dueDate: day(14),
};

function searchHit() {
  const hits = searchRecords(
    {
      customers: [{ id: "c1", number: "C-001", name: "Ann Lee" }],
      quotes: [],
      invoices: [partPaid],
    },
    "INV-001",
  );
  const hit = hits.find((h) => h.type === "invoice");
  expect(hit).toBeDefined();
  return hit as typeof hit & { balanceCents?: number };
}

describe("REQ-1073 (LOOP-007 q2-62) a part-paid invoice reads 'Partly paid' on every screen", () => {
  test("REQ-1073 baseline: REQ-966's display status already says 'partly paid'", () => {
    expect(invoiceDisplayStatus(partPaid, now)).toBe("partly paid");
  });

  test("REQ-1073 header search: the hit's status is partly_paid, not 'sent'", () => {
    expect(searchHit().status).toBe("partly_paid");
  });

  test("REQ-1073 header search: the hit carries the open balance (69075), not only the total", () => {
    const hit = searchHit();
    expect(hit.amountCents).toBe(119075);
    expect(hit.balanceCents).toBe(69075);
  });

  test("REQ-1073 header search: search.status.partly_paid reads 'Partly paid' / 'Pago parcial'", () => {
    expect(en["search.status.partly_paid"]).toBe("Partly paid");
    expect(es["search.status.partly_paid"]).toBe("Pago parcial");
  });

  test("REQ-1073 header search: GlobalSearch shows the hit's balance", () => {
    expect(read("front-end/islands/GlobalSearch.tsx")).toMatch(
      /h\.balanceCents/,
    );
  });

  test.each(["en", "es"] as const)(
    "REQ-1073 /i pill (%s): kind 'partly', labelled like the customer tab",
    (lang) => {
      // front-end/routes/i/[id].tsx feeds the pill exactly these inputs
      const flags = invoicePillFlags(partPaid, now);
      const pill = invoiceStatusPill(
        { ...flags, status: partPaid.status, internal: false },
        lang,
      );
      expect(pill.kind).toBe("partly");
      const dict = lang === "es" ? es : en;
      expect(dict[pill.key]).toBe(dict["customerWs.state.partly"]);
    },
  );

  test("REQ-1073 /i pill: overdue still wins over partly paid (REQ-966 order)", () => {
    const late = { ...partPaid, dueDate: day(-5) };
    const pill = invoiceStatusPill(
      { ...invoicePillFlags(late, now), status: late.status },
      "en",
    );
    expect(pill.kind).toBe("pastDue");
  });

  test("REQ-1073 /invoices: the card stage has a 'partly' value, labelled 'Partly paid' / 'Pago parcial'", () => {
    const island = read("front-end/islands/InvoicesPage.tsx");
    const union = island.match(/stage:\s*((?:\s*\|\s*"[a-z]+")+)/);
    expect(union).not.toBeNull();
    expect(union![1]).toMatch(/"partly"/);
    expect(en["invoicesPage.stage.partly"]).toBe("Partly paid");
    expect(es["invoicesPage.stage.partly"]).toBe("Pago parcial");
  });
});
