/**
 * REQ-596 — demo-loop cycle 4, issue p4-p5b: "Lowercase 'scheduled' in
 * search". REQ-481 made a scheduled installment's invoice state "scheduled",
 * but the topbar search (front-end/islands/GlobalSearch.tsx statusLabel)
 * looks up `search.status.<status>` and falls back to the raw value when the
 * key is missing — so the chip read "scheduled" next to "Accepted". Every
 * status the search can return now has a label in en and es, and a chip style.
 */
import * as fs from "fs";
import * as path from "path";
import { searchRecords } from "../../shared/documents/search";
import { invoiceState, quoteState } from "../../shared/documents/versions";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

// Every input shape the search's status derivation can see.
const QUOTE_INPUTS = [
  {},
  { status: "draft" },
  { status: "sent" },
  { status: "viewed" },
  { status: "sent", version: 2 },
  { status: "accepted" },
  { acceptedAt: "2026-11-01" },
  { status: "lost" },
];
const INVOICE_INPUTS = [
  {},
  { status: "draft" },
  { status: "scheduled" },
  { status: "sent" },
  { status: "sent", version: 2 },
  { status: "claimed" },
  { status: "paid" },
  { status: "void" },
];
// backend/src/paperwork/dto/change-order.ts ChangeOrderStatus (search defaults to "pending")
const CHANGE_ORDER_STATUSES = ["pending", "approved", "declined"];
// shared/documents/linked-view.ts WorkOrderStatus (search defaults to "open")
const WORK_ORDER_STATUSES = ["open", "in_progress", "done", "cancelled"];

function allSearchStatuses(): string[] {
  return [
    ...new Set([
      ...QUOTE_INPUTS.map((q) => quoteState(q)),
      ...INVOICE_INPUTS.map((i) => invoiceState(i)),
      ...CHANGE_ORDER_STATUSES,
      ...WORK_ORDER_STATUSES,
    ]),
  ];
}

describe("REQ-596 (demo cycle 4, p4-p5b) every search status has a label", () => {
  test("REQ-596 a scheduled installment's search row carries status 'scheduled'", () => {
    const hits = searchRecords(
      {
        customers: [{ id: "c1", number: "C-001", name: "Ann Lee" }],
        quotes: [],
        invoices: [
          {
            id: "i1",
            number: "INV-007",
            seq: 7,
            customerId: "c1",
            amount: 50000,
            status: "scheduled",
          },
        ],
      },
      "INV-007",
    );
    expect(hits.map((h) => h.status)).toEqual(["scheduled"]);
  });

  test.each(allSearchStatuses())(
    "REQ-596 search.status.%s exists in en and es (no raw lowercase fallback)",
    (status) => {
      const key = `search.status.${status}`;
      expect(en[key]).toEqual(expect.any(String));
      expect(es[key]).toEqual(expect.any(String));
      expect(en[key]).not.toBe(status);
      expect(es[key]).not.toBe(status);
    },
  );

  test("REQ-596 scheduled reads 'Scheduled' / 'Programada', like the invoice list", () => {
    expect(en["search.status.scheduled"]).toBe("Scheduled");
    expect(es["search.status.scheduled"]).toBe("Programada");
    expect(es["search.status.scheduled"]).toBe(es["invoices.state.scheduled"]);
  });

  test("REQ-596 the search chip has a scheduled style", () => {
    expect(read("front-end/islands/GlobalSearch.tsx")).toMatch(
      /\.gsearch__status--scheduled\s*[{,]/,
    );
  });
});
