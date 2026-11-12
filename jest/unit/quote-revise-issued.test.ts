/**
 * REQ-315 (demo-loop cycle 1: B2, M26, m49) — a sent, unsigned quote can be
 * repriced from /quotes ("Edit → Version N+1"), and the chat's change-order /
 * revision replies link back to the quote they changed.
 *
 *   front-end/lib/quote-line-edit.ts   canReviseQuote, nextVersionOf,
 *                                      editableLines, linesPatch
 *   front-end/lib/chat-quote-link.ts   chatQuoteLink
 *   front-end/islands/QuotesPage.tsx   the Edit button + inline line editor
 *   front-end/islands/AsstChat.tsx     the "Open Q-001 → Publish revision" link
 *
 * Lazy-required so a missing module reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const edit = () => require("../../front-end/lib/quote-line-edit");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const link = () => require("../../front-end/lib/chat-quote-link");

const SENT = "2026-11-10T10:00:00Z";

describe("REQ-315 B2 canReviseQuote — only an issued, unsigned quote gets Edit → Version N+1", () => {
  it("REQ-315 a sent or viewed quote can be revised", () => {
    const { canReviseQuote } = edit();
    expect(canReviseQuote({ status: "sent", sentAt: SENT })).toBe(true);
    expect(canReviseQuote({ status: "viewed", sentAt: SENT })).toBe(true);
    expect(canReviseQuote({ status: "sent" })).toBe(true);
  });

  it("REQ-315 a draft, a signed, a declined and a sample quote cannot", () => {
    const { canReviseQuote } = edit();
    expect(canReviseQuote({ status: "draft" })).toBe(false);
    expect(canReviseQuote({})).toBe(false);
    expect(canReviseQuote({ status: "accepted", sentAt: SENT })).toBe(false);
    expect(canReviseQuote({ status: "sent", sentAt: SENT, acceptedAt: SENT }))
      .toBe(false);
    expect(canReviseQuote({ status: "lost", sentAt: SENT })).toBe(false);
    expect(canReviseQuote({ status: "sent", sentAt: SENT, isSample: true }))
      .toBe(false);
  });

  it("REQ-315 nextVersionOf is the version + 1, and 2 for a row written before versioning", () => {
    const { nextVersionOf } = edit();
    expect(nextVersionOf({ version: 1 })).toBe(2);
    expect(nextVersionOf({ version: 3 })).toBe(4);
    expect(nextVersionOf({})).toBe(2);
  });
});

describe("REQ-315 editableLines / linesPatch — the editor's rows and the PUT body", () => {
  it("REQ-315 seeds the rows from the live lines, prices in dollars", () => {
    const { editableLines } = edit();
    expect(
      editableLines({
        lineItems: [
          {
            description: "Plumbing fixtures",
            quantity: 1,
            unit: "ea",
            price: 115000,
          },
          { description: "Tile", quantity: 2, price: 1050 },
        ],
      }),
    ).toEqual([
      {
        description: "Plumbing fixtures",
        quantity: "1",
        unit: "ea",
        price: "1150",
      },
      { description: "Tile", quantity: "2", unit: "ea", price: "10.5" },
    ]);
    expect(editableLines({})).toEqual([]);
  });

  it("REQ-315 seeds from the pending revision when there is one — the working copy, not the published version", () => {
    const { editableLines } = edit();
    expect(
      editableLines({
        lineItems: [
          {
            description: "Plumbing fixtures",
            quantity: 1,
            unit: "ea",
            price: 115000,
          },
        ],
        pendingRevision: {
          lineItems: [
            {
              description: "Plumbing fixtures",
              quantity: 1,
              unit: "ea",
              price: 130000,
            },
            {
              description: "Heated floor",
              quantity: 1,
              unit: "ea",
              price: 120000,
            },
          ],
        },
      }),
    ).toEqual([
      {
        description: "Plumbing fixtures",
        quantity: "1",
        unit: "ea",
        price: "1300",
      },
      { description: "Heated floor", quantity: "1", unit: "ea", price: "1200" },
    ]);
  });

  it("REQ-315 linesPatch turns dollars into integer cents and sums the new total", () => {
    const { linesPatch } = edit();
    expect(
      linesPatch([
        {
          description: " Plumbing fixtures ",
          quantity: "1",
          unit: "ea",
          price: "1300",
        },
        { description: "Tile", quantity: "2", unit: "", price: "10.5" },
        { description: "Discount", quantity: "1", unit: "ea", price: "-25" },
      ]),
    ).toEqual({
      ok: true,
      lineItems: [
        {
          description: "Plumbing fixtures",
          quantity: 1,
          unit: "ea",
          price: 130000,
        },
        { description: "Tile", quantity: 2, unit: "ea", price: 1050 },
        { description: "Discount", quantity: 1, unit: "ea", price: -2500 },
      ],
      estimatedTotal: 129600,
    });
  });

  it("REQ-315 an edit keeps each unchanged line's translations (REQ-264) — publishing does not re-translate — and a reworded or new line carries none", () => {
    const { editableLines, linesPatch } = edit();
    const rows = editableLines({
      lineItems: [
        {
          description: "Plumbing fixtures",
          quantity: 1,
          unit: "ea",
          price: 115000,
          descriptionByLang: {
            en: "Plumbing fixtures",
            es: "Accesorios de plomería",
          },
        },
        {
          description: "Tile floor and walls",
          quantity: 1,
          unit: "ea",
          price: 480000,
          descriptionByLang: { es: "Piso y paredes de azulejo" },
        },
      ],
    });
    rows[0].price = "1300"; // repriced, same wording
    rows[1].description = "Porcelain tile floor and walls"; // reworded
    rows.push({
      description: "Heated floor",
      quantity: "1",
      unit: "ea",
      price: "1200",
    });
    const out = linesPatch(rows);
    expect(out.ok).toBe(true);
    expect(out.lineItems[0]).toEqual({
      description: "Plumbing fixtures",
      quantity: 1,
      unit: "ea",
      price: 130000,
      descriptionByLang: {
        en: "Plumbing fixtures",
        es: "Accesorios de plomería",
      },
    });
    expect(out.lineItems[1]).toEqual({
      description: "Porcelain tile floor and walls",
      quantity: 1,
      unit: "ea",
      price: 480000,
    });
    expect(out.lineItems[2]).toEqual({
      description: "Heated floor",
      quantity: 1,
      unit: "ea",
      price: 120000,
    });
  });

  it("REQ-315 linesPatch refuses an empty editor, a blank description, a bad price or a non-positive qty", () => {
    const { linesPatch } = edit();
    expect(linesPatch([])).toEqual({ ok: false, reason: "empty" });
    expect(linesPatch([{ description: "  ", quantity: "1", price: "1" }]))
      .toEqual({ ok: false, reason: "invalid" });
    expect(linesPatch([{ description: "x", quantity: "1", price: "abc" }]))
      .toEqual({ ok: false, reason: "invalid" });
    expect(linesPatch([{ description: "x", quantity: "1", price: "" }]))
      .toEqual({ ok: false, reason: "invalid" });
    expect(linesPatch([{ description: "x", quantity: "0", price: "5" }]))
      .toEqual({ ok: false, reason: "invalid" });
  });
});

describe("REQ-315 m49 chatQuoteLink — a reply that names a quote gets a link to it", () => {
  it("REQ-315 a pending revision (from a change order or revise_quote) links to publish", () => {
    const { chatQuoteLink } = link();
    expect(
      chatQuoteLink({
        changeOrder: {
          kind: "pending_revision",
          quoteId: "q1",
          quoteNumber: "Q-001",
        },
      }),
    ).toEqual({ quoteId: "q1", quoteNumber: "Q-001", publish: true });
    expect(
      chatQuoteLink({
        quoteRevision: { kind: "pending_revision", quoteId: "q1" },
      }),
    )
      .toEqual({ quoteId: "q1", publish: true });
  });

  it("REQ-315 a draft update, an invoice change order, a locked quote and an unknown line link without publish", () => {
    const { chatQuoteLink } = link();
    for (
      const kind of [
        "draft_updated",
        "change_order",
        "needs_invoice",
        "locked",
        "no_such_line",
      ]
    ) {
      expect(
        chatQuoteLink({
          changeOrder: { kind, quoteId: "q1", quoteNumber: "Q-001" },
        }),
      )
        .toEqual({ quoteId: "q1", quoteNumber: "Q-001", publish: false });
      expect(chatQuoteLink({ quoteRevision: { kind, quoteId: "q1" } }))
        .toEqual({ quoteId: "q1", publish: false });
    }
  });

  it("REQ-315 a clarifying question, a miss and a plain bubble have no link", () => {
    const { chatQuoteLink } = link();
    expect(
      chatQuoteLink({
        changeOrder: { kind: "ambiguous", quoteIds: ["a", "b"] },
      }),
    ).toBeUndefined();
    expect(chatQuoteLink({ changeOrder: { kind: "none" } })).toBeUndefined();
    expect(chatQuoteLink({ quoteRevision: { kind: "ask_customer" } }))
      .toBeUndefined();
    expect(chatQuoteLink({ quoteUpdated: "q1" })).toBeUndefined();
    expect(chatQuoteLink({})).toBeUndefined();
    expect(chatQuoteLink(undefined)).toBeUndefined();
    expect(chatQuoteLink("nope")).toBeUndefined();
  });
});

describe("REQ-315 wiring — the islands use the pure rules and the copy exists in both languages", () => {
  it("REQ-315 QuotesPage gates Edit → Version N+1 on canReviseQuote, seeds the editor from editableLines and saves linesPatch through quotesClient.update", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toContain('from "../lib/quote-line-edit.ts"');
    expect(src).toContain("canReviseQuote(");
    expect(src).toContain("editableLines(");
    expect(src).toContain("linesPatch(");
    expect(src).toContain('data-cy="quote-edit"');
    expect(src).toContain('data-cy="quote-edit-save"');
    expect(src).toContain("data-cy={`quote-edit-line-price-${");
    expect(src).toContain("quotesClient.update(");
  });

  it("REQ-315 AsstChat renders the quote link from chatQuoteLink under the reply", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toContain('from "../lib/chat-quote-link.ts"');
    expect(src).toContain("chatQuoteLink(");
    expect(src).toContain('data-cy="msg-quote-link"');
    expect(src).toContain("/quotes?open=${");
  });

  it("REQ-315 every new key is in en and es", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const keys = [
      "quotesPage.open.edit",
      "quotesPage.edit.heading",
      "quotesPage.edit.description",
      "quotesPage.edit.qty",
      "quotesPage.edit.price",
      "quotesPage.edit.addLine",
      "quotesPage.edit.removeLine",
      "quotesPage.edit.total",
      "quotesPage.edit.save",
      "quotesPage.edit.saving",
      "quotesPage.edit.saved",
      "quotesPage.edit.invalid",
      "quotesPage.edit.error",
      "asstChat.openQuotePublish",
      "asstChat.openQuote",
      "asstChat.theQuote",
      "chatCoordinator.reviseQuote.publishHint",
      "chatCoordinator.reviseQuote.locked",
      "chatCoordinator.reviseQuote.noSuchLine",
      "chatCoordinator.reviseQuote.askCustomer",
      "chatCoordinator.reviseQuote.none",
      "chatCoordinator.reviseQuote.ambiguous",
      "prompts.tools.reviseQuote.description",
      "prompts.tools.reviseQuote.customerName",
      "prompts.tools.reviseQuote.quoteNumber",
      "prompts.tools.reviseQuote.lines",
      "prompts.tools.reviseQuote.match",
      "prompts.tools.reviseQuote.lineDescription",
      "prompts.tools.reviseQuote.amountCents",
      "prompts.tools.reviseQuote.remove",
      "prompts.tools.changeOrder.quoteNumber",
    ];
    const missing = keys.flatMap((k) => [
      ...(typeof en[k] === "string" && en[k].trim() ? [] : [`en:${k}`]),
      ...(typeof es[k] === "string" && es[k].trim() ? [] : [`es:${k}`]),
    ]);
    expect(missing).toEqual([]);
    // the chat link label carries the quote number and the publish step
    expect(en["asstChat.openQuotePublish"]).toContain("{number}");
    expect(es["asstChat.openQuotePublish"]).toContain("{number}");
    // the narrowed change_order description sends repricing to revise_quote
    expect(en["prompts.tools.changeOrder.description"]).toContain(
      "revise_quote",
    );
    expect(es["prompts.tools.changeOrder.description"]).toContain(
      "revise_quote",
    );
    // both system prompts know the tool
    for (const d of [en, es]) {
      expect(d["prompts.systemQuote"]).toContain("revise_quote");
      expect(d["prompts.systemTerms"]).toContain("revise_quote");
    }
  });
});
