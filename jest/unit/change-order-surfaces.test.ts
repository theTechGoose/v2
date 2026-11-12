/**
 * REQ-565 — demo-loop cycle 4, issue m33: a change order had no way out to the
 * customer from its row on the quote panel (the number was a bare link, no
 * Copy link / Send / View as customer, nothing said she sees it as a banner on
 * her quote link); the customer's card left change orders out and showed the
 * quote at its original total; and "Revision published — the customer got the
 * same link again." stayed on the panel after the quote was signed or a change
 * order was made.
 *
 *   shared/documents/change-order-actions.ts  changeOrderShareLinks
 *   front-end/lib/quote-line-edit.ts          publishedNoteVisible
 *   front-end/islands/QuotesPage.tsx          the CO row's actions + banner line
 *   front-end/islands/ClientsBoard.tsx        change-order rows, agreed total
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const actions = () => require("../../shared/documents/change-order-actions");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const edit = () => require("../../front-end/lib/quote-line-edit");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-565 (m33) changeOrderShareLinks — the CO row's Copy link / Text / Email", () => {
  it("REQ-565 the full /co link, a text to the customer's phone and an email to her address, both carrying the link", () => {
    const { changeOrderShareLinks } = actions();
    const links = changeOrderShareLinks({
      origin: "https://documonster.com",
      path: "/co/co-1",
      phone: "(512) 555-0142",
      email: "maria@example.com",
      subject: "Change order CO-001",
      text: "Hi Maria, change order CO-001: https://documonster.com/co/co-1",
    });
    expect(links.url).toBe("https://documonster.com/co/co-1");
    expect(links.sms).toBe(
      "sms:+15125550142?body=" +
        encodeURIComponent(
          "Hi Maria, change order CO-001: https://documonster.com/co/co-1",
        ),
    );
    expect(links.email).toBe(
      "mailto:maria@example.com?subject=" +
        encodeURIComponent("Change order CO-001") + "&body=" +
        encodeURIComponent(
          "Hi Maria, change order CO-001: https://documonster.com/co/co-1",
        ),
    );
  });

  it("REQ-565 with no phone or email on file the text and the email still open, prefilled, with no recipient", () => {
    const { changeOrderShareLinks } = actions();
    const links = changeOrderShareLinks({
      origin: "http://localhost:5280",
      path: "/co/co-2",
      subject: "S",
      text: "T",
    });
    expect(links.url).toBe("http://localhost:5280/co/co-2");
    expect(links.sms).toBe("sms:?body=T");
    expect(links.email).toBe("mailto:?subject=S&body=T");
  });
});

describe("REQ-565 (m33) publishedNoteVisible — 'Revision published' goes stale", () => {
  const mark = { version: 2, status: "sent", changeOrders: 0 };

  it("REQ-565 shown right after Publish, before and after the ledger reloads the new version", () => {
    const { publishedNoteVisible } = edit();
    expect(
      publishedNoteVisible(mark, {
        version: 1,
        status: "sent",
        changeOrders: 0,
      }),
    ).toBe(true);
    expect(
      publishedNoteVisible(mark, {
        version: 2,
        status: "sent",
        changeOrders: 0,
      }),
    ).toBe(true);
  });

  it("REQ-565 gone once the quote is signed, a later version lands, or a change order is made", () => {
    const { publishedNoteVisible } = edit();
    expect(
      publishedNoteVisible(mark, {
        version: 2,
        status: "accepted",
        changeOrders: 0,
      }),
    ).toBe(false);
    expect(
      publishedNoteVisible(mark, {
        version: 3,
        status: "sent",
        changeOrders: 0,
      }),
    ).toBe(false);
    expect(
      publishedNoteVisible(mark, {
        version: 2,
        status: "sent",
        changeOrders: 1,
      }),
    ).toBe(false);
  });

  it("REQ-565 nothing published from this panel: no note", () => {
    const { publishedNoteVisible } = edit();
    expect(
      publishedNoteVisible(null, {
        version: 2,
        status: "sent",
        changeOrders: 0,
      }),
    ).toBe(false);
  });
});

describe("REQ-565 (m33) the quote panel's change-order row", () => {
  const src = read("front-end/islands/QuotesPage.tsx");
  const start = src.indexOf("function LedgerChangeOrderRow(");
  const end = src.indexOf("function QuoteLedgerSection(");
  const row = src.slice(start, end);

  it("REQ-565 the row offers Copy link, Text, Email and View as customer, built by changeOrderShareLinks", () => {
    expect(start).toBeGreaterThan(-1);
    expect(row).toMatch(/changeOrderShareLinks\(/);
    expect(row).toMatch(/data-cy="ledger-co-copy"/);
    expect(row).toMatch(/navigator\.clipboard\.writeText\(/);
    expect(row).toMatch(/data-cy="ledger-co-text"/);
    expect(row).toMatch(/data-cy="ledger-co-email"/);
    expect(row).toMatch(/data-cy="ledger-co-view"/);
    expect(row).toMatch(/quotes\.ledger\.coViewAsCustomer/);
  });

  it("REQ-565 the row says the customer also sees it as a banner on her quote link", () => {
    expect(row).toMatch(/data-cy="ledger-co-banner-note"/);
    expect(row).toMatch(/quotes\.ledger\.coBannerNote/);
  });

  it("REQ-565 the 'Revision published' note is gated by publishedNoteVisible, not a bare flag", () => {
    expect(src).toMatch(/publishedNoteVisible\(/);
    expect(src).not.toMatch(/setPublished\(true\)/);
  });
});

describe("REQ-565 (m33) the customer card's documents", () => {
  const board = read("front-end/islands/ClientsBoard.tsx");

  it("REQ-565 a change-order row has its own label and icon; the quote row says it includes approved change orders", () => {
    expect(board).toMatch(/d\.kind === "change_order"/);
    expect(board).toMatch(/clientsBoard\.doc\.inclChangeOrders/);
  });

  it("REQ-565 the client type and the CRM DTO both know the change_order kind", () => {
    expect(read("front-end/clients/clients.ts")).toMatch(
      /kind: "quote" \| "invoice" \| "change_order"/,
    );
    expect(read("backend/src/crm/dto/customer.ts")).toMatch(
      /kind: "quote" \| "invoice" \| "change_order"/,
    );
  });
});

describe("REQ-565 (m33) copy", () => {
  it("REQ-565 both languages carry the new keys with the same placeholders", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const keys = [
      "quotes.ledger.coCopyLink",
      "quotes.ledger.coLinkCopied",
      "quotes.ledger.coText",
      "quotes.ledger.coEmail",
      "quotes.ledger.coViewAsCustomer",
      "quotes.ledger.coBannerNote",
      "quotes.ledger.coSendSubject",
      "quotes.ledger.coSendBody",
      "clientsBoard.doc.change_order",
      "clientsBoard.doc.inclChangeOrders",
    ];
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(holes(es[k])).toEqual(holes(en[k]));
    }
    expect(en["quotes.ledger.coBannerNote"]).toMatch(/banner/i);
    expect(en["quotes.ledger.coSendBody"]).toMatch(/\{url\}/);
  });
});
