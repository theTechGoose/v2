/**
 * REQ-462 — demo-loop cycle 3, issue M26: on /quotes a signed quote's panel
 * said "Signed — later changes go on a change order" and offered nothing, and
 * each change-order row was a bare link — a pending order could not be
 * corrected or withdrawn there (or from the chat).
 *
 *   shared/documents/change-order-actions.ts  newChangeOrderTarget,
 *                                             changeOrderRowActions,
 *                                             changeOrderCents,
 *                                             changeOrderBody
 *   front-end/clients/change-orders.ts        POST / PUT / DELETE
 *                                             /invoices/:id/change-orders[/:coId]
 *   front-end/islands/QuotesPage.tsx          New change order · Edit · Withdraw
 *   front-end/lib/chat-quote-link.ts          the chat edit's reply links its quote
 *
 * Lazy-required so a missing module reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const actions = () => require("../../shared/documents/change-order-actions");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const link = () => require("../../front-end/lib/chat-quote-link");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const inv = (id: string, number: string, status: string) => ({
  id,
  number,
  status,
});

describe("REQ-462 (M26) newChangeOrderTarget — which invoice a new change order goes on", () => {
  it("REQ-462 the newest invoice that is still open (pair 5: INV-001 sent, INV-002 draft → INV-002)", () => {
    const { newChangeOrderTarget } = actions();
    expect(
      newChangeOrderTarget({
        invoices: [inv("i1", "INV-001", "sent"), inv("i2", "INV-002", "draft")],
        remainingToInvoiceCents: 0,
      }),
    ).toEqual({ kind: "invoice", invoiceId: "i2", invoiceNumber: "INV-002" });
  });

  it("REQ-462 a paid, void or canceled invoice never takes one", () => {
    const { newChangeOrderTarget } = actions();
    expect(
      newChangeOrderTarget({
        invoices: [
          inv("i1", "INV-001", "sent"),
          inv("i2", "INV-002", "paid"),
          inv("i3", "INV-003", "void"),
          inv("i4", "INV-004", "canceled"),
        ],
        remainingToInvoiceCents: 0,
      }),
    ).toEqual({ kind: "invoice", invoiceId: "i1", invoiceNumber: "INV-001" });
  });

  it("REQ-462 nothing open and something left to invoice → create the next invoice first", () => {
    const { newChangeOrderTarget } = actions();
    expect(
      newChangeOrderTarget({ invoices: [], remainingToInvoiceCents: 705_000 }),
    ).toEqual({ kind: "invoice_first" });
  });

  it("REQ-462 every invoice paid and nothing left → bill the extra work on a new invoice", () => {
    const { newChangeOrderTarget } = actions();
    expect(
      newChangeOrderTarget({
        invoices: [inv("i1", "INV-001", "paid")],
        remainingToInvoiceCents: 0,
      }),
    ).toEqual({ kind: "new_invoice" });
  });
});

describe("REQ-462 (M26) changeOrderRowActions — Edit and Withdraw on an order that is not approved", () => {
  it("REQ-462 pending and declined orders get both; an approved one gets neither", () => {
    const { changeOrderRowActions } = actions();
    expect(changeOrderRowActions({ status: "pending", invoiceId: "i2" }))
      .toEqual({ edit: true, withdraw: true });
    expect(changeOrderRowActions({ status: "declined", invoiceId: "i2" }))
      .toEqual({ edit: true, withdraw: true });
    expect(changeOrderRowActions({ status: "approved", invoiceId: "i2" }))
      .toEqual({ edit: false, withdraw: false });
  });

  it("REQ-462 an order with no invoice id has no endpoint to call — no actions", () => {
    const { changeOrderRowActions } = actions();
    expect(changeOrderRowActions({ status: "pending" }))
      .toEqual({ edit: false, withdraw: false });
  });
});

describe("REQ-462 (M26) changeOrderCents / changeOrderBody — the form's amount and body", () => {
  it("REQ-462 dollars as typed → signed integer cents; a minus is a credit", () => {
    const { changeOrderCents } = actions();
    expect(changeOrderCents("1000")).toBe(100_000);
    expect(changeOrderCents(" $1,000.50 ")).toBe(100_050);
    expect(changeOrderCents("-50")).toBe(-5_000);
    expect(changeOrderCents("−50")).toBe(-5_000);
    for (const bad of ["", "abc", "0", "0.00", "$"]) {
      expect(changeOrderCents(bad)).toBeNull();
    }
  });

  it("REQ-462 a body needs a description and a non-zero amount", () => {
    const { changeOrderBody } = actions();
    expect(
      changeOrderBody({
        description: "  Upgrade to frameless glass shower door ",
        dollars: "1,000",
      }),
    ).toEqual({
      ok: true,
      body: {
        description: "Upgrade to frameless glass shower door",
        deltaAmountCents: 100_000,
      },
    });
    expect(changeOrderBody({ description: " ", dollars: "100" }))
      .toEqual({ ok: false, reason: "description" });
    expect(changeOrderBody({ description: "Towel bar", dollars: "0" }))
      .toEqual({ ok: false, reason: "amount" });
  });
});

describe("REQ-462 (M26) the quotes page", () => {
  const src = read("front-end/islands/QuotesPage.tsx");

  it("REQ-462 a 'New change order' button sits next to the signed quote's lock note", () => {
    const at = src.indexOf('data-cy="quote-lock-note"');
    expect(at).toBeGreaterThan(-1);
    const near = src.slice(at, at + 1200);
    expect(near).toMatch(/data-cy="quote-new-change-order"/);
    expect(near).toMatch(/quotes\.ledger\.newChangeOrder/);
  });

  it("REQ-462 the form posts the order on the open invoice, or says what comes first", () => {
    expect(src).toMatch(/newChangeOrderTarget\(/);
    expect(src).toMatch(/changeOrdersClient\.create\(/);
    expect(src).toMatch(/data-cy="quote-co-form"/);
    expect(src).toMatch(/quotes\.ledger\.coInvoiceFirst/);
    // REQ-655 (cycle 5, p18-9c) amends the all-paid case: no refusal box —
    // the button itself is "Bill extra work", to a linked new invoice
    expect(src).toMatch(/newChangeOrderButton\(/);
  });

  it("REQ-462 a change-order row has Edit (PUT) and Withdraw (asks, then DELETE)", () => {
    expect(src).toMatch(/changeOrderRowActions\(/);
    expect(src).toMatch(/data-cy="ledger-co-edit"/);
    expect(src).toMatch(/data-cy="ledger-co-withdraw"/);
    expect(src).toMatch(/data-cy="ledger-co-withdraw-confirm"/);
    expect(src).toMatch(/changeOrdersClient\.update\(/);
    expect(src).toMatch(/changeOrdersClient\.withdraw\(/);
  });

  it("REQ-462 the client calls the existing change-order endpoints", () => {
    const client = read("front-end/clients/change-orders.ts");
    expect(client).toMatch(
      /api\.post<[^>]*>\(\s*`\/invoices\/\$\{invoiceId\}\/change-orders`/,
    );
    expect(client).toMatch(
      /api\.put<[^>]*>\(\s*`\/invoices\/\$\{invoiceId\}\/change-orders\/\$\{changeOrderId\}`/,
    );
    expect(client).toMatch(
      /api\.delete<[^>]*>\(\s*`\/invoices\/\$\{invoiceId\}\/change-orders\/\$\{changeOrderId\}`/,
    );
  });
});

describe("REQ-462 (M26) chatQuoteLink — the chat's change-order edit links its quote", () => {
  it("REQ-462 an edit, a withdrawal or a refusal that names a quote links to it", () => {
    const { chatQuoteLink } = link();
    for (
      const kind of ["updated", "withdrawn", "approved", "no_change", "ask"]
    ) {
      expect(
        chatQuoteLink({
          changeOrderEdit: {
            kind,
            number: "CO-001",
            quoteId: "q1",
            quoteNumber: "Q-001",
          },
        }),
      ).toEqual({ quoteId: "q1", quoteNumber: "Q-001", publish: false });
    }
  });

  it("REQ-462 an unknown number has nothing to open", () => {
    const { chatQuoteLink } = link();
    expect(
      chatQuoteLink({ changeOrderEdit: { kind: "none", number: "CO-007" } }),
    ).toBeUndefined();
  });
});

describe("REQ-462 (M26) copy", () => {
  it("REQ-462 both languages carry the panel's and the chat's new copy", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const keys = [
      "quotes.ledger.newChangeOrder",
      "quotes.ledger.coDescription",
      "quotes.ledger.coAmount",
      "quotes.ledger.coCreate",
      "quotes.ledger.coGoesOn",
      "quotes.ledger.coInvoiceFirst",
      "quotes.ledger.coNewInvoice",
      "quotes.ledger.coEdit",
      "quotes.ledger.coSave",
      "quotes.ledger.coWithdraw",
      "quotes.ledger.coWithdrawAsk",
      "quotes.ledger.coSaved",
      "quotes.ledger.coError",
      "chatCoordinator.changeOrderEdit.updated",
      "chatCoordinator.changeOrderEdit.withdrawn",
      "chatCoordinator.changeOrderEdit.approved",
      "chatCoordinator.changeOrderEdit.none",
      "chatCoordinator.changeOrderEdit.noChange",
      "chatCoordinator.changeOrderEdit.askAmount",
      "chatCoordinator.changeOrderEdit.askWhat",
    ];
    for (const key of keys) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
    }
    expect(en["quotes.ledger.newChangeOrder"]).not.toEqual(
      es["quotes.ledger.newChangeOrder"],
    );
    expect(en["chatCoordinator.changeOrderEdit.updated"]).not.toEqual(
      es["chatCoordinator.changeOrderEdit.updated"],
    );
  });
});
