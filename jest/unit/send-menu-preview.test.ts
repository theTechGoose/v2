/**
 * REQ-570 (demo-loop cycle 4, issue m41) — "No Preview in the Send ▾ menu,
 * and no Send on the Quotes drawer".
 *
 * The assistant's Send ▾ menu offered Text + Email / Text only / Email only /
 * Copy link and no way to see the quote as the customer will. The /quotes
 * open panel offered Copy link / View as customer / Edit and no way to send.
 * Now the menu carries "Preview as customer" (opens /q/<id>) and the panel
 * carries a Send ▾ that opens the same send dialog and goes through the same
 * SendQuote flow (POST /agents/conversations/:id/send-quote) on the quote's
 * own thread — found, or started bound to the quote.
 */
import * as fs from "fs";
import * as path from "path";
import {
  conversationForQuote,
  panelCanSend,
  sendFromQuotePanel,
} from "../../front-end/lib/quote-panel-send.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-570 m41 panelCanSend: which /quotes panels offer Send", () => {
  it("REQ-570 a sent, viewed or revised quote can be (re)sent from the panel", () => {
    expect(panelCanSend({ status: "sent", sentAt: "2026-11-01" })).toBe(true);
    expect(panelCanSend({ status: "viewed", sentAt: "2026-11-01" })).toBe(
      true,
    );
    expect(
      panelCanSend({ status: "sent", sentAt: "2026-11-01", version: 2 }),
    ).toBe(true);
  });
  it("REQ-570 a signed or declined quote offers no Send (UX-02: no re-send of a closed deal)", () => {
    expect(
      panelCanSend({ status: "accepted", acceptedAt: "2026-11-02" }),
    ).toBe(false);
    expect(panelCanSend({ status: "lost", sentAt: "2026-11-01" })).toBe(false);
  });
  it("REQ-570 a draft is finished in the assistant, not sent from the panel", () => {
    expect(panelCanSend({ status: "draft" })).toBe(false);
  });
});

describe("REQ-570 m41 conversationForQuote: the send runs on the quote's own thread", () => {
  it("REQ-570 reuses the thread already bound to the quote (newest first)", async () => {
    const started: unknown[] = [];
    const id = await conversationForQuote("q1", "c1", {
      list: async () => [
        { id: "other", quoteId: "q9" },
        { id: "mine", quoteId: "q1" },
        { id: "older", quoteId: "q1" },
      ],
      start: async (b) => {
        started.push(b);
        return { id: "new" };
      },
    });
    expect(id).toBe("mine");
    expect(started).toEqual([]);
  });
  it("REQ-570 starts a thread bound to the quote and its customer when none exists", async () => {
    const started: unknown[] = [];
    const id = await conversationForQuote("q1", "c1", {
      list: async () => [{ id: "other", quoteId: "q9" }],
      start: async (b) => {
        started.push(b);
        return { id: "new" };
      },
    });
    expect(id).toBe("new");
    expect(started).toEqual([{ quoteId: "q1", customerId: "c1" }]);
  });
});

describe("REQ-570 m41 sendFromQuotePanel: the same SendQuote call the chat makes", () => {
  it("REQ-570 sends on the resolved thread with the channel, language and requestId, and reports the delivery", async () => {
    const calls: unknown[][] = [];
    const out = await sendFromQuotePanel(
      {
        quoteId: "q1",
        customerId: "c1",
        channel: "sms",
        language: "es",
        requestId: "r-1",
      },
      {
        list: async () => [{ id: "conv-1", quoteId: "q1" }],
        start: async () => ({ id: "never" }),
        send: async (...args) => {
          calls.push(args);
          return {
            newMessages: [{
              kind: "phase_divider",
              payload: {
                quoteId: "q1",
                channel: "sms",
                textedTo: "+15125550123",
              },
            }],
          };
        },
      },
    );
    expect(calls).toEqual([["conv-1", "q1", "sms", "es", "r-1"]]);
    expect(out.conversationId).toBe("conv-1");
    expect(out.delivered).toBe(true);
    expect(out.outcome?.textedTo).toBe("+15125550123");
  });
  it("REQ-570 a send that reached nobody is reported as not delivered, with the reason", async () => {
    const out = await sendFromQuotePanel(
      { quoteId: "q1", channel: "email", requestId: "r-2" },
      {
        list: async () => [],
        start: async () => ({ id: "conv-2" }),
        send: async () => ({
          newMessages: [{
            kind: "phase_divider",
            payload: {
              quoteId: "q1",
              channel: "email",
              emailFailureReason: "no email on file",
            },
          }],
        }),
      },
    );
    expect(out.conversationId).toBe("conv-2");
    expect(out.delivered).toBe(false);
    expect(out.outcome?.emailFailureReason).toBe("no email on file");
  });
});

describe("REQ-570 m41 the assistant's Send ▾ menu has 'Preview as customer'", () => {
  const src = read("front-end/islands/AsstChat.tsx");
  it("REQ-570 a menu item opens the customer's page /q/<id> in a new tab", () => {
    const at = src.indexOf('data-cy="send-menu-preview"');
    expect(at).toBeGreaterThan(-1);
    const item = src.slice(at - 600, at + 900);
    expect(item).toContain('role="menuitem"');
    expect(item).toContain("customerLinkPath(");
    expect(item).toContain('target="_blank"');
    expect(item).toContain("asstChat.preview.menuPreview");
  });
  it("REQ-570 it sits in the same menu as Copy link", () => {
    const menu = src.indexOf('class="quote-review__send-menu"');
    const preview = src.indexOf('data-cy="send-menu-preview"');
    const copy = src.indexOf('"asstChat.preview.menuCopyLink"', menu);
    expect(menu).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(menu);
    expect(Math.abs(preview - copy)).toBeLessThan(3000);
  });
});

describe("REQ-570 m41 the /quotes open panel has Send ▾", () => {
  const src = read("front-end/islands/QuotesPage.tsx");
  it("REQ-570 the panel renders a Send ▾ with the three channels and Preview as customer", () => {
    expect(src).toContain('data-cy="quote-panel-send"');
    expect(src).toContain('data-cy="quote-panel-send-menu"');
    expect(src).toContain("quote-panel-send-${ch}");
    expect(src).toContain('data-cy="quote-panel-send-preview"');
    expect(src).toContain("panelCanSend(");
  });
  it("REQ-570 a channel pick opens the shared send dialog, which sends via sendFromQuotePanel → assistantClient.sendQuoteFlow", () => {
    expect(src).toContain("<QuoteSendDialog");
    const dlg = read("front-end/components/QuoteSendDialog.tsx");
    expect(dlg).toContain("sendFromQuotePanel(");
    expect(dlg).toContain("assistantClient.sendQuoteFlow");
    expect(dlg).toContain('data-cy="send-dialog"');
    expect(dlg).toContain("sendDialogErrorKey(");
    expect(dlg).toContain("runExclusive(");
  });
});

describe("REQ-570 m41 copy in en and es", () => {
  const keys = [
    "asstChat.preview.menuPreview",
    "quotesPage.open.send",
    "quotesPage.open.chooseSend",
    "quotesPage.open.sentTo",
    "quotesPage.open.sendFailed",
    "quotesPage.open.sendError",
  ];
  it.each(keys)("REQ-570 %s exists in en and es and differs", (k) => {
    expect(typeof en[k]).toBe("string");
    expect(typeof es[k]).toBe("string");
    expect(en[k].length).toBeGreaterThan(0);
    expect(es[k]).not.toBe(en[k]);
  });
  it("REQ-570 the menu item reads 'Preview as customer'", () => {
    expect(en["asstChat.preview.menuPreview"]).toBe("Preview as customer");
  });
});
