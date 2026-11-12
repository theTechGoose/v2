/**
 * REQ-234 — demo issue M3: "Lock it in" / "Confirmar" marked the quote SENT,
 * stamped sentAt and could email the customer before the terms, the customer
 * or the Send step. Locking is not sending: a locked quote stays a draft
 * (lockedAt stamped), its chat card and conversation read "locked", and only
 * Send (SendQuote) flips it to sent, stamps sentAt and dispatches.
 *
 * Target: shared/quote-flow/quote-lock.ts (the one rule both lock paths and
 * the chat UI share) + its wiring in front-end/islands/AsstChat.tsx.
 */
import * as fs from "fs";
import * as path from "path";
import {
  cardChipKey,
  isLockedOrIssued,
  lockStatusFor,
  QUOTE_LOCKED,
} from "../../shared/quote-flow/quote-lock";
import {
  deriveChatHeader,
  threadChip,
} from "../../shared/quote-flow/chat-header";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-234 lockStatusFor — locking a quote never makes it 'sent'", () => {
  it("a draft quote locks to 'locked', not 'sent'", () => {
    expect(QUOTE_LOCKED).toBe("locked");
    expect(lockStatusFor({ status: "draft" })).toBe("locked");
    expect(lockStatusFor({})).toBe("locked");
  });

  it("a quote already issued keeps its real status (no demotion)", () => {
    expect(lockStatusFor({ status: "sent", sentAt: "2026-11-11T00:00:00Z" }))
      .toBe("sent");
    expect(lockStatusFor({ status: "viewed" })).toBe("viewed");
    expect(lockStatusFor({ status: "accepted" })).toBe("accepted");
  });
});

describe("REQ-234 the chat card's chip and helpers know the locked state", () => {
  it("'locked' has its own chip — never the 'Sent' one", () => {
    expect(cardChipKey("locked")).toBe("asstChat.statusChip.locked");
    expect(cardChipKey("sent")).toBe("status.sent");
    expect(cardChipKey("draft")).toBe("status.draft");
    expect(cardChipKey(undefined)).toBe("status.draft");
    expect(cardChipKey("accepted")).toBe("asstChat.statusChip.approved");
  });

  it("a locked card counts as the locked quote for the preview / payment step", () => {
    expect(isLockedOrIssued("locked")).toBe(true);
    expect(isLockedOrIssued("sent")).toBe(true);
    expect(isLockedOrIssued("draft")).toBe(false);
    expect(isLockedOrIssued(undefined)).toBe(false);
  });

  it("both languages carry the locked chip, header and preview copy, and none says sent", () => {
    for (
      const key of [
        "asstChat.statusChip.locked",
        "asstChat.header.quoteLocked",
        "lockQuote.preview.locked",
        "chatCoordinator.quoteLocked",
      ]
    ) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
      expect(en[key]).not.toMatch(/sent/i);
      expect(es[key]).not.toMatch(/enviad/i);
    }
    // REQ-369: the thread list names a locked quote in the header's words.
    expect(threadChip("locked")?.key).toBe("asstChat.header.quoteLocked");
  });
});

describe("REQ-234 AsstChat wiring", () => {
  const src = read("front-end/islands/AsstChat.tsx");

  it("the chip label goes through the shared cardChipKey map", () => {
    expect(src).toMatch(/cardChipKey\(/);
  });

  it("the header names a locked quote as locked, not 'Quote sent'", () => {
    // REQ-245 (quote-m6) derives the header from the quote's lifecycle in
    // shared/quote-flow/chat-header.ts; REQ-236's headerStatusKey (fed the last
    // card's status) still decides "Not delivered" (reconciled on demo-fixes).
    expect(src).toMatch(/deriveChatHeader\(/);
    expect(src).toMatch(/lastCardStatus: \(\s*lastQuoteCard\?\.payload/);
    const header = read("shared/quote-flow/chat-header.ts");
    expect(header).toMatch(/lastCardStatus === "locked"/);
    // REQ-369: the rule moved into threadStatus — a locked quote (lockedAt,
    // status still draft) is named "Quote locked", never "Quote sent".
    expect(
      deriveChatHeader({
        quote: { status: "draft", lockedAt: "2026-11-11T00:00:00Z" },
        messages: [],
      }).statusKey,
    ).toBe("asstChat.header.quoteLocked");
    const delivery = fs.readFileSync(
      path.join(__dirname, "../../front-end/lib/send-delivery.ts"),
      "utf8",
    );
    expect(delivery).toMatch(
      /lastCardStatus === QUOTE_LOCKED[\s\S]{0,120}asstChat\.header\.quoteLocked/,
    );
  });

  it("a locked card keeps the Re-open action (the old status==='sent' gate is gone)", () => {
    expect(src).toMatch(/isLockedOrIssued\(payload\.status\)/);
  });
});
