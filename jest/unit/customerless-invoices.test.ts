/**
 * REQ-696 — demo-loop cycle 5 (run r37f88707), issues M5 + M22.
 *
 * M22: an invoice made in Nueva factura with "Sin cliente" and BILL TO
 * "Jorge Ruiz" showed "—" as the customer on /invoices (enrich() read only
 * the customer map) while the public page said "FACTURAR A Jorge Ruiz".
 * M5: the customer card read "SALDO Saldado" while $350 was still to bill
 * (a scheduled completion invoice), and the open /customers page stayed on
 * "0 trabajos firmados" after a signature until a reload — it never followed
 * the REQ-493 change feed.
 */
import * as fs from "fs";
import * as path from "path";
import en from "../../lang/en.json";
import es from "../../lang/es.json";
import { balanceSubLabel } from "../../shared/quote-flow/balance-sub";
import { tFor } from "../../front-end/lib/i18n";
import type { CustomerCard } from "../../front-end/clients/clients";
import {
  balanceDisplay,
  balanceSubFor,
} from "../../front-end/lib/clients-display";
import { invoiceClientName } from "../../front-end/lib/invoice-client";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

describe("REQ-696 M22 invoiceClientName — the bill-to name when the invoice has no customer", () => {
  const customers = new Map([["c-1", "María López"]]);

  test("the customer on file wins", () => {
    expect(
      invoiceClientName(
        { customerId: "c-1", billTo: { name: "Someone Else" } },
        customers,
      ),
    ).toBe("María López");
  });

  test("no customer: the typed BILL TO name, then its business name", () => {
    expect(invoiceClientName({ billTo: { name: " Jorge Ruiz " } }, customers))
      .toBe("Jorge Ruiz");
    expect(
      invoiceClientName({ billTo: { businessName: "Ruiz LLC" } }, customers),
    ).toBe("Ruiz LLC");
    // a customer id the map does not know (deleted) falls back the same way
    expect(
      invoiceClientName(
        { customerId: "gone", billTo: { name: "Jorge Ruiz" } },
        customers,
      ),
    ).toBe("Jorge Ruiz");
  });

  test("nobody at all is still the dash", () => {
    expect(invoiceClientName({}, customers)).toBe("—");
    expect(invoiceClientName({ billTo: { name: "  " } }, customers)).toBe("—");
  });

  test("the /invoices list resolves its client through it", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/invoiceClientName\(inv, customers\)/);
    expect(src).not.toMatch(/customers\.get\(inv\.customerId\)\) \|\| "—"/);
  });
});

describe("REQ-696 M5 the 'to bill' balance state", () => {
  const parts = {
    kind: "toBill" as const,
    amountCents: 350_00,
    date: "2026-11-20",
  };

  test("worded in en and es: amount to bill · send date", () => {
    expect(balanceSubLabel(parts, "en", tFor)).toBe("$350 to bill · Nov 20");
    expect(balanceSubLabel(parts, "es", tFor)).toBe(
      "$350 por facturar · 20 nov",
    );
  });

  test("en and es both carry the keys", () => {
    for (
      const k of [
        "clientsDisplay.balanceSub.toBill",
        "clientsDisplay.balance.toBill",
      ]
    ) {
      expect(EN[k]).toBeTruthy();
      expect(ES[k]).toBeTruthy();
    }
  });

  const card: CustomerCard = {
    id: "c6",
    userId: "u1",
    name: "Pair Six",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    lastWhen: null,
    lastTone: "hot",
    balanceCents: 0,
    balanceSub: "$350 to bill · Nov 20",
    balanceSubParts: parts,
    activeJobs: 1,
    jobsSub: "active",
    status: "active",
    temp: 80,
    daysSinceContact: 0,
    revenue12moCents: 0,
    documents: [
      {
        kind: "invoice",
        id: "i1",
        number: "INV-001",
        state: "scheduled",
        amountCents: 350_00,
        url: "/i/i1",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    ],
  } as CustomerCard;

  test("the card's BALANCE reads what is left to bill, never 'Settled'", () => {
    expect(balanceDisplay(card, "es").text).toBe("$350 por facturar");
    expect(balanceDisplay(card, "en").text).toBe("$350 to bill");
    expect(balanceSubFor(card, "es")).toBe("$350 por facturar · 20 nov");
  });
});

describe("REQ-696 M5 /customers follows the change feed", () => {
  test("ClientsPage re-reads its page when a quote or invoice changes (REQ-493)", () => {
    const src = read("front-end/islands/ClientsPage.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/change-feed\.ts"/);
    expect(src).toMatch(
      /useEffect\(\s*\(\)\s*=>\s*followChanges\(\s*isDocChange,\s*refreshClients,?\s*\),\s*\[\s*page,\s*q,\s*filter,?\s*\],?\s*\)/,
    );
  });
});
