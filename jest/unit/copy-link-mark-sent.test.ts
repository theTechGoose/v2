/**
 * REQ-572 — demo-loop cycle 4, issue p4-p7c: "'Copy link' leaves quote
 * 'Ready to send'".
 *
 * The ▾ send menu's Copy link only copied the URL (AsstChat.tsx copyLinkFor):
 * by design (REQ-236 / REQ-480) a quote is "sent" only when a channel
 * delivers, and a copy proves nothing. Now the copy toast asks "Link copied —
 * mark as sent?"; "Mark as sent" PUTs {status:"sent", sentVia:"link"} and the
 * thread reads "Shared by link" — never "Not delivered".
 */
import * as fs from "fs";
import * as path from "path";
import {
  linkCopyOffersMarkSent,
  SHARED_BY_LINK_PATCH,
} from "../../front-end/lib/customer-link";
import { isUndelivered } from "../../shared/quote-flow/delivery";
import { classifyQuoteForPipeline } from "../../shared/quote-flow/pipeline-stats";
import {
  type ChatHeaderMessage,
  deriveChatHeader,
  THREAD_STATUSES,
  threadChip,
  threadStatus,
  threadStatusKey,
} from "../../shared/quote-flow/chat-header";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const FAILED = {
  at: "2026-11-12T10:00:00.000Z",
  channel: "email" as const,
  emailFailureReason: "no email on file",
};
const DELIVERED = {
  at: "2026-11-12T11:00:00.000Z",
  channel: "email" as const,
  emailedTo: "a@b.co",
};
const sendCta: ChatHeaderMessage = {
  kind: "continue_cta",
  payload: { toPhase: "send" },
};
const failedDivider: ChatHeaderMessage = {
  kind: "phase_divider",
  payload: { phase: 3, quoteId: "q1", emailFailureReason: "no email" },
};
const TERMS = [{ stepId: "payment_terms", label: "Payment", value: "50/50" }];
const SHARED = {
  status: "sent",
  sentAt: "2026-11-12T12:00:00.000Z",
  sentVia: "link",
  lockedAt: "2026-11-12T09:00:00.000Z",
  terms: TERMS,
};

describe("REQ-572 p4-p7c Copy link offers 'mark as sent'", () => {
  it("offers the mark for a quote that has not gone out yet", () => {
    expect(linkCopyOffersMarkSent({ status: "draft" })).toBe(true);
    expect(linkCopyOffersMarkSent({
      status: "draft",
      lockedAt: "x",
      terms: TERMS,
    })).toBe(true);
    // a send that reached nobody — the link is the fallback
    expect(linkCopyOffersMarkSent({ status: "draft", lastDelivery: FAILED }))
      .toBe(true);
    // LockQuote's legacy "sent" status with nothing delivered
    expect(linkCopyOffersMarkSent({ status: "sent", lastDelivery: FAILED }))
      .toBe(true);
  });

  it("never offers it once the quote went out, was answered, or is unknown", () => {
    expect(linkCopyOffersMarkSent(undefined)).toBe(false);
    expect(linkCopyOffersMarkSent({ status: "sent", deliveredAt: "x" }))
      .toBe(false);
    expect(linkCopyOffersMarkSent({ status: "sent", lastDelivery: DELIVERED }))
      .toBe(false);
    expect(linkCopyOffersMarkSent({ status: "sent", sentAt: "x" })).toBe(false);
    expect(linkCopyOffersMarkSent({ status: "viewed" })).toBe(false);
    expect(linkCopyOffersMarkSent({ status: "accepted" })).toBe(false);
    expect(linkCopyOffersMarkSent({ status: "draft", acceptedAt: "x" }))
      .toBe(false);
    expect(linkCopyOffersMarkSent({ status: "lost", lostAt: "x" })).toBe(false);
    expect(linkCopyOffersMarkSent({ ...SHARED })).toBe(false);
  });

  it("the mark is PUT /quotes/:id {status:'sent', sentVia:'link'}", () => {
    expect(SHARED_BY_LINK_PATCH).toEqual({ status: "sent", sentVia: "link" });
  });
});

describe("REQ-572 a quote shared by link is never 'Not delivered'", () => {
  it("isUndelivered is false once the owner marked it shared by link", () => {
    expect(isUndelivered({ lastDelivery: FAILED })).toBe(true);
    expect(isUndelivered({ lastDelivery: FAILED, sentVia: "link" }))
      .toBe(false);
  });

  it("the pipeline counts it as awaiting the customer, not a draft", () => {
    expect(classifyQuoteForPipeline({
      status: "sent",
      sentAt: "x",
      lastDelivery: FAILED,
      sentVia: "link",
    })).toBe("awaiting");
  });
});

describe("REQ-572 the thread reads 'Shared by link'", () => {
  it("is a thread status, named asstChat.header.sharedByLink in en + es", () => {
    expect(THREAD_STATUSES).toContain("sharedByLink");
    expect(threadStatusKey("sharedByLink")).toBe(
      "asstChat.header.sharedByLink",
    );
    expect(en["asstChat.header.sharedByLink"]).toBe("Shared by link");
    expect(es["asstChat.header.sharedByLink"]).toBe("Compartida por enlace");
  });

  it("a ready-to-send quote marked by link: 'Shared by link', not 'Ready to send' / 'Out for signature'", () => {
    const h = deriveChatHeader({ quote: SHARED, messages: [sendCta] });
    expect(h.status).toBe("sharedByLink");
    expect(h.statusKey).toBe("asstChat.header.sharedByLink");
  });

  it("after a failed send, the owner's mark wins over 'Not delivered'", () => {
    expect(threadStatus({
      quote: { ...SHARED, lastDelivery: FAILED },
      messages: [sendCta, failedDivider],
    })).toBe("sharedByLink");
  });

  it("a later delivery, or the customer opening it, moves it on to 'Out for signature'", () => {
    expect(threadStatus({
      quote: { ...SHARED, lastDelivery: DELIVERED, deliveredAt: "x" },
      messages: [sendCta],
    })).toBe("sent");
    expect(threadStatus({
      quote: { ...SHARED, status: "viewed" },
      messages: [sendCta],
    })).toBe("sent");
    expect(threadStatus({
      quote: { ...SHARED, status: "accepted", acceptedAt: "x" },
      messages: [],
    })).toBe("accepted");
  });

  it("the list chip says the same words in the 'sent' tone", () => {
    expect(threadChip("sharedByLink")).toEqual({
      kind: "sent",
      key: "asstChat.header.sharedByLink",
    });
  });
});

describe("REQ-572 strings + wiring", () => {
  it("the toast's ask + button exist in en and es", () => {
    expect(en["asstChat.customerLink.markSentAsk"]).toBe(
      "Link copied — mark as sent?",
    );
    expect(en["asstChat.customerLink.markSent"]).toBe("Mark as sent");
    expect(es["asstChat.customerLink.markSentAsk"]).toBe(
      "Enlace copiado — ¿marcar como enviada?",
    );
    expect(es["asstChat.customerLink.markSent"]).toBe("Marcar como enviada");
    for (const k of ["markSentFailed"]) {
      expect(en[`asstChat.customerLink.${k}`]).toBeTruthy();
      expect(es[`asstChat.customerLink.${k}`]).toBeTruthy();
    }
  });

  it("the toast renders the ask and a 'Mark as sent' button when offered", () => {
    const src = read("front-end/components/CustomerLinkRow.tsx");
    expect(src).toMatch(/asstChat\.customerLink\.markSentAsk/);
    expect(src).toMatch(/data-cy="link-toast-mark-sent"/);
    expect(src).toMatch(/onMarkSent/);
  });

  it("AsstChat: copyLinkFor offers the mark from the quote row; the mark PUTs the patch and updates the row", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    const at = chat.indexOf("async function copyLinkFor(");
    const handler = chat.slice(at, chat.indexOf("\n  }\n", at));
    expect(handler).toMatch(/linkCopyOffersMarkSent\(/);
    const markAt = chat.indexOf("async function markSharedByLink(");
    expect(markAt).toBeGreaterThan(0);
    const mark = chat.slice(markAt, chat.indexOf("\n  }\n", markAt));
    expect(mark).toMatch(
      /api\.put[\s\S]*`\/quotes\/\$\{[^}]+\}`[\s\S]*SHARED_BY_LINK_PATCH/,
    );
    expect(mark).toMatch(/setQuote\(/);
    expect(chat).toMatch(/<LinkToast[\s\S]*?onMarkSent=/);
  });
});
