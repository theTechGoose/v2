/**
 * REQ-481 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issues M28 + m10.
 *
 * M28: Karen's 50/50 job, Q-001 $7,050, INV-001 sent $3,525, INV-002
 * scheduled $3,525 (sends Nov 26). The quote ledger read "Invoiced $7,050 ·
 * Invoiced but unpaid $7,050", INV-002 read "Draft", the disabled "Create
 * next invoice" said only "Everything agreed is already invoiced", and after
 * CO-001 (+$1,200) was approved the /quotes card and the Decided row still
 * read $7,050.
 *
 * m10: /quotes said "Nothing sent yet — 1 draft ready to send" over a signed
 * Q-001, "Nothing is waiting on a client" while CO-001 waited on Karen, a
 * failed send read as a "draft", and /invoices showed "DRAFTING 0 · no drafts
 * open" beside "INV-002 · Draft".
 *
 * RCA: shared/documents/ledger.ts `live` kept scheduled/draft rows in
 * invoiced + invoicedUnpaid; versions.ts invoiceState mapped scheduled →
 * draft; QuotesPage's card value read estimatedTotal only; QuotesHero's
 * draftsOnly ignored decided history and had no change-order input.
 */
import { readFileSync } from "fs";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ledgerMod = () => require("../../shared/documents/ledger");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const versions = () => require("../../shared/documents/versions");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hc = () => require("../../front-end/lib/headline-counts");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const form = () => require("../../shared/documents/invoice-form");

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const quote = {
  id: "q1",
  number: "Q-001",
  status: "accepted",
  acceptedAt: "2026-11-12T10:00:00Z",
  estimatedTotal: 705000,
};
const inv1 = {
  id: "i1",
  number: "INV-001",
  seq: 1,
  status: "sent",
  amount: 352500,
  dueDate: "2026-11-19",
  installmentIndex: 1,
  installmentTotal: 2,
};
const inv2 = {
  id: "i2",
  number: "INV-002",
  seq: 2,
  status: "scheduled",
  amount: 352500,
  scheduledFor: "2026-11-26",
  dueDate: "2026-12-03",
  installmentIndex: 2,
  installmentTotal: 2,
};

describe("REQ-481 (M28) the quote ledger splits billed from scheduled", () => {
  it("REQ-481 a scheduled invoice is not 'invoiced but unpaid' — only the sent one is", () => {
    const l = ledgerMod().quoteLedger(quote, [inv1, inv2], []);
    expect(l.billedCents).toBe(352500);
    expect(l.scheduledCents).toBe(352500);
    expect(l.invoicedUnpaidCents).toBe(352500);
    // every dollar is on some invoice — the next invoice stays disabled
    expect(l.remainingToInvoiceCents).toBe(0);
    expect(l.nextScheduled).toMatchObject({
      number: "INV-002",
      amountCents: 352500,
      scheduledFor: "2026-11-26",
    });
    expect(l.invoices[1].scheduledFor).toBe("2026-11-26");
  });

  it("REQ-481 a draft (unsent) invoice is also scheduled/drafted, not billed", () => {
    const l = ledgerMod().quoteLedger(quote, [inv1, {
      ...inv2,
      status: "draft",
      scheduledFor: undefined,
    }], []);
    expect(l.billedCents).toBe(352500);
    expect(l.scheduledCents).toBe(352500);
    expect(l.invoicedUnpaidCents).toBe(352500);
    expect(l.nextScheduled).toMatchObject({ number: "INV-002" });
    expect(l.nextScheduled.scheduledFor).toBeUndefined();
  });

  it("REQ-481 the agreement cap still counts the scheduled invoice (no double billing)", () => {
    const d = ledgerMod().invoiceCapDecision(quote, [inv1, inv2], [], 100);
    expect(d.ok).toBe(false);
    expect(d.invoicedCents).toBe(705000);
  });

  it("REQ-481 the panel shows Invoiced (billed), Invoiced but unpaid, Scheduled, Remaining — and names INV-002 as the reason", () => {
    const l = ledgerMod().quoteLedger(quote, [inv1, inv2], []);
    const s = lv().ledgerSummary(l);
    expect(s.rows.map((r: { key: string; cents: number }) => [r.key, r.cents]))
      .toEqual([
        ["agreed", 705000],
        ["invoiced", 352500],
        ["paid", 0],
        ["invoicedUnpaid", 352500],
        ["scheduled", 352500],
        ["remaining", 0],
      ]);
    expect(s.canCreateNextInvoice).toBe(false);
    expect(s.scheduled).toMatchObject({
      number: "INV-002",
      scheduledFor: "2026-11-26",
    });
    expect(s.fullyInvoicedKey).toBe("quotes.ledger.restScheduled");
  });

  it("REQ-481 with nothing scheduled the reason stays 'everything is invoiced' and no Scheduled row shows", () => {
    const l = ledgerMod().quoteLedger(quote, [inv1, {
      ...inv2,
      status: "sent",
    }], []);
    const s = lv().ledgerSummary(l);
    expect(s.rows.some((r: { key: string }) => r.key === "scheduled")).toBe(
      false,
    );
    expect(s.fullyInvoicedKey).toBe("quotes.ledger.fullyInvoiced");
  });

  it("REQ-481 the quote panel renders the reason through ledgerSummary, and shows the send date on a scheduled row", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/summary\.fullyInvoicedKey/);
    expect(src).toMatch(/quotes\.ledger\.sends/);
  });
});

describe("REQ-481 (M28/m10) a scheduled invoice reads 'Scheduled', not 'Draft'", () => {
  it("REQ-481 invoiceState(scheduled) is 'scheduled'; draft stays 'draft'", () => {
    const { invoiceState } = versions();
    expect(invoiceState({ status: "scheduled" })).toBe("scheduled");
    expect(invoiceState({ status: "draft" })).toBe("draft");
    expect(invoiceState({ status: "sent" })).toBe("sent");
  });

  it("REQ-481 the headline reads 'INV-002 · Version 1 · Scheduled'", () => {
    const { formatInvoiceHeadline } = form();
    expect(
      formatInvoiceHeadline(
        { id: "i2", number: "INV-002", version: 1, status: "scheduled" },
        { draft: "Draft", scheduled: "Scheduled" },
        "Version",
      ),
    ).toBe("INV-002 · Version 1 · Scheduled");
  });

  it("REQ-481 stateLabel('scheduled') is 'Scheduled' / 'Programada'", () => {
    const { stateLabel } = lv();
    expect(stateLabel("scheduled", "en")).toBe("Scheduled");
    expect(stateLabel("scheduled", "es")).toBe("Programada");
  });

  it("REQ-481 the related-document rows label a scheduled invoice 'Scheduled'", () => {
    const { relatedDocumentRows } = lv();
    const rows = relatedDocumentRows({
      invoices: [{ id: "i2", number: "INV-002", status: "scheduled" }],
    }, "en");
    expect(rows[0].stateLabel).toBe("Scheduled");
  });

  it("REQ-481 /invoices: the Drafting KPI names the scheduled invoice instead of 'no drafts open'", () => {
    const { draftingKpiSub } = hc();
    expect(draftingKpiSub(0, 1)).toEqual({
      key: "invoicesPage.kpi.draftingSubScheduled.one",
      n: 1,
    });
    expect(draftingKpiSub(0, 0).key).toBe("invoicesPage.kpi.draftingSubEmpty");
    expect(draftingKpiSub(2, 1).key).toBe("invoicesPage.kpi.draftingSub");
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/draftingKpiSub\(/);
    expect(src).toMatch(
      /scheduled:\s*tFor\(lang,\s*"invoices\.state\.scheduled"\)/,
    );
  });
});

describe("REQ-481 (M28) /quotes money includes approved change orders", () => {
  it("REQ-481 the card value is the quote plus approved change orders", () => {
    const { quoteCardValue } = hc();
    expect(
      quoteCardValue({
        estimatedTotal: 705000,
        approvedChangeOrdersCents: 120000,
      }),
    ).toBe(825000);
    expect(quoteCardValue({ estimatedTotal: 705000 })).toBe(705000);
    expect(quoteCardValue({})).toBe(0);
  });

  it("REQ-481 QuotesPage maps the card value through quoteCardValue", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/value:\s*quoteCardValue\(c\)/);
  });
});

describe("REQ-481 (m10) the /quotes hero agrees with the state", () => {
  it("REQ-481 a signed quote + a draft is NOT 'Nothing sent yet' — it is settled, with the draft noted", () => {
    const n = hc().quotesHeroNumbers([
      { stage: "won", value: 705000, customerId: "k" },
      { stage: "draft", value: 50000, customerId: "k" },
    ]);
    expect(n.mode).toBe("settled");
    expect(n.decidedCount).toBe(1);
    expect(n.draftCount).toBe(1);
  });

  it("REQ-481 drafts with no history are still 'draftsOnly'", () => {
    expect(
      hc().quotesHeroNumbers([{ stage: "draft", value: 1 }]).mode,
    ).toBe("draftsOnly");
  });

  it("REQ-481 an undelivered quote is counted apart from ready drafts", () => {
    const n = hc().quotesHeroNumbers([
      { stage: "undelivered", value: 32000, client: "Linda" },
    ]);
    expect(n.undeliveredCount).toBe(1);
    expect(n.mode).toBe("draftsOnly");
  });

  it("REQ-481 a pending change order is named: 'CO-001 is waiting on Karen'", () => {
    const { heroCoWaiting } = hc();
    expect(heroCoWaiting([])).toBeNull();
    const one = heroCoWaiting([{ number: "CO-001", client: "Karen" }]);
    expect(one).toEqual({
      key: "quotesHero.coWaiting.one",
      vars: { number: "CO-001", client: "Karen", n: 1 },
    });
    expect(
      en["quotesHero.coWaiting.one"].replace("{number}", "CO-001").replace(
        "{client}",
        "Karen",
      ),
    ).toBe("CO-001 is waiting on Karen.");
    expect(
      heroCoWaiting([
        { number: "CO-001", client: "Karen" },
        { number: "CO-002", client: "Bo" },
      ])?.key,
    ).toBe("quotesHero.coWaiting.other");
  });

  it("REQ-481 the hero component takes the decided / undelivered / pending-CO inputs and uses the shared mode", () => {
    const src = read("front-end/components/QuotesSections.tsx");
    const hero = src.slice(
      src.indexOf("export function QuotesHero"),
      src.indexOf("interface KpisProps"),
    );
    expect(hero).toMatch(/quotesHeroMode\(/);
    expect(hero).toMatch(/heroCoWaiting\(/);
    expect(hero).toMatch(/data-cy="quotes-hero-co-waiting"/);
    expect(hero).toMatch(/data-cy="quotes-hero-undelivered"/);
    expect(hero).not.toMatch(
      /draftsOnly\s*=\s*!empty\s*&&\s*openCount\s*===\s*0\s*&&\s*draftCount\s*>\s*0;/,
    );
    const page = read("front-end/islands/QuotesPage.tsx");
    expect(page).toMatch(/decidedCount=\{heroNums\.decidedCount\}/);
    expect(page).toMatch(/undeliveredCount=\{heroNums\.undeliveredCount\}/);
    expect(page).toMatch(/pendingChangeOrders=\{/);
  });
});

describe("REQ-481 en + es carry every new label", () => {
  const keys = [
    "public.doc.state.scheduled",
    "invoices.state.scheduled",
    "clientsBoard.docState.scheduled",
    "quotes.ledger.scheduled",
    "quotes.ledger.sends",
    "quotes.ledger.restScheduled",
    "quotes.ledger.restDrafted",
    "quotesHero.coWaiting.one",
    "quotesHero.coWaiting.other",
    "quotesHero.undeliveredTitle.one",
    "quotesHero.undeliveredTitle.other",
    "quotesHero.undeliveredSub",
    "quotesHero.undeliveredNote.one",
    "quotesHero.undeliveredNote.other",
    "invoicesPage.kpi.draftingSubScheduled.one",
    "invoicesPage.kpi.draftingSubScheduled.other",
  ];
  it.each(keys)("REQ-481 %s exists in en and es", (k) => {
    expect(typeof en[k]).toBe("string");
    expect(typeof es[k]).toBe("string");
    expect(en[k].length).toBeGreaterThan(0);
    expect(es[k].length).toBeGreaterThan(0);
  });
  it("REQ-481 the scheduled labels read 'Scheduled' / 'Programada'", () => {
    expect(en["public.doc.state.scheduled"]).toBe("Scheduled");
    expect(es["public.doc.state.scheduled"]).toBe("Programada");
    expect(en["invoices.state.scheduled"]).toBe("Scheduled");
  });
});
