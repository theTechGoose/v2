/**
 * REQ-626 — every "Open" / card button does something: the client card's
 * "Open card", "Message" and CTA; the quote card's front CTA and "Resend";
 * the invoice card's "Open" (the editable panel, in-app — "View as customer"
 * stays a separate link); the payment cards' buttons; the field task's
 * "Invoiced" chip. Part 1 pins the pure rules (shared/card-actions), part 2
 * the wiring — no button whose only handler is stopPropagation.
 */
import * as fs from "fs";
import * as path from "path";
import {
  clientCtaAction,
  draftConversationFor,
  messageHref,
  quoteCta,
} from "../../shared/card-actions/mod";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-626 the card actions' rules", () => {
  test("Message: a text to the customer's phone first, an email otherwise, nothing without a contact", () => {
    expect(messageHref({ phoneNumber: "(512) 555-0101" })).toBe(
      "sms:+15125550101",
    );
    expect(messageHref({ phoneNumber: "+44 20 7946 0958", email: "a@b.co" }))
      .toBe("sms:+442079460958");
    expect(messageHref({ email: "maria@lopez.example" })).toBe(
      "mailto:maria@lopez.example",
    );
    expect(messageHref({ phoneNumber: "5125550101" }, "Hi Maria & co"))
      .toBe("sms:+15125550101?body=Hi%20Maria%20%26%20co");
    expect(messageHref({ email: "m@l.example" }, "Hi")).toBe(
      "mailto:m@l.example?body=Hi",
    );
    expect(messageHref({})).toBeNull();
    expect(messageHref({ phoneNumber: "  ", email: "" })).toBeNull();
  });

  test("the client card's CTA: a message when its label is one, the client's card otherwise", () => {
    expect(clientCtaAction({ balanceCents: 5000, status: "owes" })).toBe(
      "message",
    );
    expect(clientCtaAction({ balanceCents: 0, status: "active" })).toBe(
      "message",
    );
    expect(clientCtaAction({ balanceCents: 0, status: "lead" })).toBe(
      "message",
    );
    expect(clientCtaAction({ balanceCents: 0, status: "cold" })).toBe(
      "message",
    );
    expect(clientCtaAction({ balanceCents: 0, status: "regular" })).toBe(
      "open",
    );
  });

  test("the quote card's CTA does what its label says", () => {
    expect(quoteCta("draft", 0)).toEqual({
      key: "quoteCard.cta.finishSend",
      action: "resume",
    });
    expect(quoteCta("opened", 1)).toEqual({
      key: "quoteCard.cta.friendlyNudge",
      action: "resend",
    });
    expect(quoteCta("opened", 4)).toEqual({
      key: "quoteCard.cta.friendlyNudge",
      action: "resend",
    });
    expect(quoteCta("cooling", 0)).toEqual({
      key: "quoteCard.cta.friendlyNudge",
      action: "resend",
    });
    expect(quoteCta("stale", 0)).toEqual({
      key: "quoteCard.cta.winItBack",
      action: "resend",
    });
    expect(quoteCta("sent", 0)).toEqual({
      key: "quoteCard.cta.openQuote",
      action: "open",
    });
    expect(quoteCta("won", 0)).toEqual({
      key: "quoteCard.cta.openQuote",
      action: "open",
    });
  });

  test("a draft resumes in the newest assistant conversation that holds it", () => {
    const convos = [
      { id: "c1", quoteId: "q1", updatedAt: "2026-11-01T00:00:00Z" },
      { id: "c2", quoteId: "q1", updatedAt: "2026-11-05T00:00:00Z" },
      { id: "c3", quoteId: "q2", updatedAt: "2026-11-09T00:00:00Z" },
    ];
    expect(draftConversationFor("q1", convos)).toBe("c2");
    expect(draftConversationFor("q9", convos)).toBeUndefined();
  });
});

describe("REQ-626 no dead card buttons", () => {
  test("client card: Open card opens the client sheet, Message messages, the CTA acts, the sort sorts", () => {
    const board = read("front-end/islands/ClientsBoard.tsx");
    expect(board).toMatch(
      /data-cy="ccard2-open"[\s\S]{0,200}onClick=\{\(\) => onOpenCard\(c\.id\)\}/,
    );
    expect(board).toMatch(/data-cy="ccard2-message"/);
    expect(board).toMatch(/messageHref\(/);
    expect(board).toMatch(
      /class="ccard2__nudge"[\s\S]{0,120}onClick=\{onCta\}/,
    );
    expect(board).toMatch(/class="ctoolbar2__sort"[\s\S]{0,250}onClick=/);
    const page = read("front-end/islands/ClientsPage.tsx");
    expect(page).toMatch(/<ClientSheet/);
    expect(page).toMatch(/searchParams\.(get|set)\("open"/);
    const sheet = read("front-end/components/ClientSheet.tsx");
    expect(sheet).toContain('data-cy="client-sheet"');
    expect(sheet).toContain('data-cy="client-sheet-edit"');
    expect(sheet).toContain('data-cy="client-sheet-message"');
  });

  test("quote card: the front CTA and Resend have real handlers; the page hands the card its opener", () => {
    const card = read("front-end/islands/QuoteCard.tsx");
    expect(card).toMatch(/class="qcard__cta"[\s\S]{0,120}onClick=\{onCta\}/);
    expect(card).toMatch(
      /data-cy="qcard-resend"[\s\S]{0,80}onClick=\{onResend\}/,
    );
    // Resend posts the quote to both channels and reads the bodies
    expect(card).toMatch(/\/api\/quotes\/\$\{id\}\/\$\{channel\}/);
    expect(card).toMatch(/one\("email"\), one\("text"\)/);
    expect(card).toMatch(/interpretSendResult\(/);
    expect(card).not.toMatch(
      /<button[^>]*onClick=\{\(e\) => e\.stopPropagation\(\)\}/,
    );
    const page = read("front-end/islands/QuotesPage.tsx");
    expect((page.match(/onOpen=\{openQuote\}/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
  });

  test("invoice card: Open opens the editable panel in-app; View as customer is its own link", () => {
    const inv = read("front-end/islands/InvoicesPage.tsx");
    const open = inv.slice(
      inv.indexOf("function doOpenInvoice"),
      inv.indexOf("function doOpenInvoice") + 400,
    );
    expect(open).toMatch(/onOpen\(inv\.id\)/);
    expect(open).not.toMatch(/\/i\/\$\{inv\.id\}/);
    expect(inv).toMatch(
      // REQ-586 AMENDMENT (reconciled with develop on demo-fixes): the customer's
      // view opens in the invoice's document language
      /data-cy="invoice-view-as-customer"[\s\S]{0,200}href=\{invoiceLinkPath\(inv\.id, inv\.lang\)\}/,
    );
    expect(inv).toMatch(/data-cy="invoice-back-open"/);
  });

  test("payment cards: the front CTA, Receipt, Match invoice and Text client all go somewhere", () => {
    const pay = read("front-end/islands/PaymentsPage.tsx");
    expect(pay).not.toMatch(
      /<button[^>]*onClick=\{\(e\) => e\.stopPropagation\(\)\}/,
    );
    for (
      const cy of [
        "pay-card-cta",
        "pay-card-receipt",
        "pay-card-match",
        "pay-card-text",
      ]
    ) {
      expect(pay).toContain(`data-cy="${cy}"`);
    }
  });

  test("the field task's Invoiced chip opens that invoice", () => {
    const tasks = read("front-end/islands/FieldTasksPage.tsx");
    expect(tasks).toMatch(
      /\/invoices\?open=\$\{encodeURIComponent\(x\.invoiceId/,
    );
  });

  test("every new key exists in both languages", () => {
    const files = [
      "front-end/components/ClientSheet.tsx",
      "front-end/islands/ClientsBoard.tsx",
      "front-end/islands/QuoteCard.tsx",
      "front-end/islands/PaymentsPage.tsx",
    ].map(read).join("\n");
    const keys = [
      ...new Set(
        [...files.matchAll(
          /"((?:clientSheet|clientsBoard|quoteCard|paymentsPage)\.[a-zA-Z_.]+)"/g,
        )].map((m) => m[1]),
      ),
    ];
    for (const file of ["lang/en.json", "lang/es.json"]) {
      const dict = JSON.parse(read(file));
      // a plural (tnFor) key lives as <key>.one / <key>.other
      const has = (k: string) =>
        typeof dict[k] === "string" || typeof dict[`${k}.one`] === "string";
      for (const k of keys) expect([file, k, has(k)]).toEqual([file, k, true]);
    }
  });
});
