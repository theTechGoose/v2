/**
 * REQ-310 (demo cycle 1, m13 + m32) — the customer's link is one click away
 * after a send, and "Copy link" says what it did.
 *
 *   m13: /quotes card's front CTA was a dead zone (stopPropagation only) and
 *        the only /q/:id link lived on the pointer-events:none back face; the
 *        chat rendered no customer link after a successful send.
 *   m32: the chat's copy-link lived inside the send channel menu and its
 *        only confirmation was its own label for 1.2 s; a clipboard rejection
 *        closed the menu silently.
 *
 * Targets:
 *   front-end/lib/customer-link.ts           — the pure logic
 *   front-end/components/CustomerLinkRow.tsx — the row + the toast
 *   front-end/islands/QuoteCard.tsx          — front CTA opens the panel
 *   front-end/islands/AsstChat.tsx           — row under send dividers and
 *                                              sent action_cards; toast
 */
import * as fs from "fs";
import * as path from "path";
import {
  copyCustomerLink,
  customerLinkPath,
  customerLinkUrl,
  dividerShowsCustomerLink,
} from "../../front-end/lib/customer-link.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-310 customer-link logic", () => {
  test("REQ-310 the customer's link is /q/:id on the page's origin", () => {
    expect(customerLinkPath("abc")).toBe("/q/abc");
    expect(customerLinkUrl("https://documonster.com", "abc")).toBe(
      "https://documonster.com/q/abc",
    );
  });

  test("REQ-310 only a send divider that names its quote shows the row", () => {
    expect(dividerShowsCustomerLink({ quoteId: "q1", emailedTo: "a@b.c" }))
      .toBe(true);
    expect(dividerShowsCustomerLink({ quoteId: "q1", textedTo: "+1" })).toBe(
      true,
    );
    // a failed send still has a link worth pasting elsewhere
    expect(
      dividerShowsCustomerLink({
        quoteId: "q1",
        channel: "sms",
        smsFailureReason: "no phone",
      }),
    ).toBe(true);
    // wizard phase dividers do not
    expect(dividerShowsCustomerLink({ phase: 2, label: "Terms" })).toBe(false);
    expect(dividerShowsCustomerLink({ emailedTo: "a@b.c" })).toBe(false);
    expect(dividerShowsCustomerLink(undefined)).toBe(false);
  });

  test("REQ-310 (m32) copying reports copied, and a clipboard refusal reports failed with the url — never throws", async () => {
    const written: string[] = [];
    const ok = await copyCustomerLink("https://x.test/q/1", (t) => {
      written.push(t);
      return Promise.resolve();
    });
    expect(ok).toEqual({ kind: "copied", url: "https://x.test/q/1" });
    expect(written).toEqual(["https://x.test/q/1"]);

    const failed = await copyCustomerLink(
      "https://x.test/q/2",
      () => Promise.reject(new Error("NotAllowedError")),
    );
    expect(failed).toEqual({ kind: "failed", url: "https://x.test/q/2" });

    const noClipboard = await copyCustomerLink("https://x.test/q/3", undefined);
    expect(noClipboard).toEqual({ kind: "failed", url: "https://x.test/q/3" });
  });
});

describe("REQ-310 (m13) /quotes card: the front CTA opens the quote panel", () => {
  const card = read("front-end/islands/QuoteCard.tsx");

  test("REQ-310 the front .qcard__cta calls onOpen(q.id) (flips when no onOpen) instead of stopPropagation only", () => {
    const at = card.indexOf('class="qcard__cta"');
    expect(at).toBeGreaterThan(0);
    const btn = card.slice(
      card.lastIndexOf("<button", at),
      card.indexOf("</button>", at),
    );
    expect(btn).toContain('data-cy="qcard-cta"');
    expect(btn).toMatch(/onOpen\(q\.id\)/);
    expect(btn).toMatch(/setFlipped\(true\)/);
    expect(btn).not.toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
});

describe("REQ-310 the chat renders the customer's link after a send, outside the menu", () => {
  const chat = read("front-end/islands/AsstChat.tsx");
  const row = read("front-end/components/CustomerLinkRow.tsx");

  test("REQ-310 the row component carries the /q/ link, Open as customer and Copy", () => {
    expect(row).toContain('data-cy="customer-link"');
    expect(row).toContain('data-cy="customer-link-open"');
    expect(row).toContain('data-cy="customer-link-copy"');
    expect(row).toMatch(/customerLinkPath\(/);
    expect(row).toContain('target="_blank"');
    expect(row).toContain('"asstChat.customerLink.label"');
    expect(row).toContain('"asstChat.customerLink.open"');
    expect(row).toContain('"asstChat.customerLink.copy"');
  });

  test("REQ-310 the toast component shows copied / couldn't-copy with the url selectable", () => {
    expect(row).toContain('data-cy="link-toast"');
    expect(row).toContain('role="status"');
    expect(row).toContain('"asstChat.customerLink.copied"');
    expect(row).toContain('"asstChat.customerLink.copyFailed"');
    expect(row).toMatch(/data-cy="link-toast-url"/);
  });

  test("REQ-310 (m13) a send divider that names its quote renders the row", () => {
    const start = chat.indexOf('if (m.kind === "phase_divider")');
    const end = chat.indexOf('if (m.kind === "continue_cta")');
    expect(start).toBeGreaterThan(0);
    const divider = chat.slice(start, end);
    expect(divider).toMatch(/dividerShowsCustomerLink\(dp\)/);
    expect(divider).toMatch(/<CustomerLinkRow/);
  });

  // REQ-460 (demo-loop cycle 3, M16) amends this: a LOCKED card no longer
  // carries the link — only a sent (issued) one, via cardShowsCustomerLink.
  test("REQ-310 (m13) / REQ-460 a sent (issued) action_card renders the row", () => {
    const start = chat.indexOf('if (m.kind === "action_card")');
    const end = chat.indexOf('m.content === "PM_ONBOARDING_DEMO_CTA"', start);
    expect(end).toBeGreaterThan(start);
    const cardBlock = chat.slice(start, end);
    const gateAt = cardBlock.indexOf("cardShowsCustomerLink(");
    expect(gateAt).toBeGreaterThan(0);
    expect(cardBlock.slice(gateAt)).toMatch(/<CustomerLinkRow/);
  });

  test("REQ-310 (m32) the menu's Copy link reports through the toast — success and the catch branch alike — not its own label", () => {
    const at = chat.indexOf(
      'role="menuitem"',
      chat.indexOf("Copy link — an immediate action"),
    );
    expect(at).toBeGreaterThan(0);
    const item = chat.slice(
      chat.lastIndexOf("<button", at),
      chat.indexOf("</button>", at),
    );
    // the item hands the copy to the shared handler, which reports via the toast
    expect(item).toMatch(/copyLinkFor\(/);
    const handlerAt = chat.indexOf("async function copyLinkFor(");
    expect(handlerAt).toBeGreaterThan(0);
    const handler = chat.slice(handlerAt, chat.indexOf("\n  }\n", handlerAt));
    expect(handler).toMatch(/copyCustomerLink\(/);
    // REQ-572: the outcome may carry the "mark as sent?" offer on top
    expect(handler).toMatch(/setLinkToast\((out|offer \? \{ \.\.\.out[^)]*: out)\)/);
    // the old silent paths are gone
    expect(item).not.toMatch(/setLinkCopied/);
    expect(item).not.toMatch(/catch \{\s*setChannelMenuOpen\(false\);\s*\}/);
    expect(chat).not.toMatch(/\[linkCopied, setLinkCopied\]/);
  });

  test("REQ-310 (m32) the toast is rendered at the island root, outside the send menu", () => {
    const menuStart = chat.indexOf('class="quote-review__send-menu"');
    const menuEnd = chat.indexOf("</footer>", menuStart);
    const menu = chat.slice(menuStart, menuEnd);
    expect(menu).not.toMatch(/<LinkToast/);
    expect(chat).toMatch(/<LinkToast[\s\S]*?toast=\{linkToast\}/);
  });

  test("REQ-310 the strings exist in both languages", () => {
    for (
      const k of [
        "asstChat.customerLink.label",
        "asstChat.customerLink.copy",
        "asstChat.customerLink.open",
        "asstChat.customerLink.copied",
        "asstChat.customerLink.copyFailed",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
    }
    expect(en["asstChat.customerLink.copied"]).toBe("Link copied");
    expect(en["asstChat.customerLink.copyFailed"]).toMatch(
      /Couldn.t copy — here is the link/,
    );
    expect(en["asstChat.customerLink.open"]).toBe("Open as customer");
  });
});
