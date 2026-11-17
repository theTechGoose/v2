/**
 * REQ-563 (demo-loop cycle 4, issue m3) — "Nothing in the chat says the
 * client signed; statuses out of step (header vs list, ticker, Reabrir)".
 *
 * The demo: after the customer signed, only the chat header changed ("Quote
 * accepted"); the list chip said "Invoiced" (pairs 1, 7); the old quote card
 * still offered "Reabrir" (pair 9); the topbar ticker kept "Quote sent to Bob
 * Smith" after a signature in another tab of the same browser (pair 10).
 *
 * Unit level of REQ-563: the card's Re-open follows the LIVE quote, the
 * header and the list name a signed + billed quote with the same words, a
 * change announced by another tab asks the notifications feed (the ticker's
 * list) at once, and the chat re-reads its transcript when the quote it
 * shows gets signed. The server side (the signed divider) is the backend
 * integration test `backend/src/agents/domain/coordinators/accept-quote/
 * signed-chat.int.test.ts`.
 */
import * as fs from "fs";
import * as path from "path";
import { cardReopenAction } from "../../shared/quote-flow/quote-lock";
import {
  deriveChatHeader,
  threadChip,
} from "../../shared/quote-flow/chat-header";
import {
  _setChangeChannelForTest,
  announceChange,
} from "../../front-end/lib/change-announce";
import {
  _resetChangeFeedForTest,
  subscribeChanges,
} from "../../front-end/lib/change-feed";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => {
  _resetChangeFeedForTest();
  _setChangeChannelForTest();
});

describe("REQ-563 m3 the quote card's Re-open follows the live quote, not the card's snapshot", () => {
  test("REQ-563 a card appended as 'locked' whose quote is now signed (or declined) offers no Re-open", () => {
    expect(cardReopenAction("locked", { status: "accepted" })).toBe("none");
    expect(cardReopenAction("sent", { status: "accepted" })).toBe("none");
    expect(
      cardReopenAction("locked", { status: "sent", acceptedAt: "2026-11-12" }),
    ).toBe("none");
    expect(cardReopenAction("locked", { status: "lost" })).toBe("none");
  });

  test("REQ-563 a 'locked' card whose quote went out since goes to revision, never to the unlock endpoint", () => {
    expect(cardReopenAction("locked", { status: "sent" })).toBe("revise");
    expect(cardReopenAction("locked", { status: "viewed" })).toBe("revise");
  });

  test("REQ-563 a still-locked quote unlocks; with no live row the card's own status decides (REQ-334)", () => {
    expect(cardReopenAction("locked", { status: "locked" })).toBe("unlock");
    expect(cardReopenAction("locked", null)).toBe("unlock");
    expect(cardReopenAction("sent", undefined)).toBe("revise");
    expect(cardReopenAction("draft", undefined)).toBe("none");
  });

  test("REQ-563 the island gates the card's Re-open (and its handler) on cardReopenAction over the live quote", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).not.toMatch(/\{isLockedOrIssued\(payload\.status\)\s*\?/);
    expect(src).toMatch(
      /cardReopenAction\(\s*payload\.status,\s*liveCardQuote\(payload, ruleQuote\),?\s*\) !== "none"/,
    );
    expect(src).toMatch(
      /function reopenActionCard\([\s\S]{0,400}cardReopenAction\(\s*payload\.status,\s*liveCardQuote\(payload, ruleQuote\)/,
    );
  });
});

describe("REQ-563 m3 the header and the list name a signed, billed quote alike", () => {
  const signedDivider = {
    kind: "phase_divider",
    role: "system",
    payload: {
      phase: 4,
      signed: true,
      quoteId: "q1",
      invoiceId: "i1",
      invoiceStatus: "sent",
    },
  };
  test("REQ-563 list chip for accepted + invoice sent == the header's key for the thread that carries the signed divider", () => {
    const chip = threadChip("accepted", "sent");
    const header = deriveChatHeader({
      quote: { id: "q1", status: "accepted", acceptedAt: "2026-11-12" },
      messages: [signedDivider],
    } as never);
    expect(chip?.key).toBe("asstChat.header.signedInvoiced");
    expect(header.statusKey).toBe(chip?.key);
    expect(header.status).toBe("accepted");
  });

  test("REQ-563 'Signed · Invoiced' / 'Firmada · Facturada' in en + es", () => {
    expect(en["asstChat.header.signedInvoiced"]).toBe("Signed · Invoiced");
    expect(es["asstChat.header.signedInvoiced"]).toBe("Firmada · Facturada");
  });

  test("REQ-563 a header passed the conversation's invoice status says the same; paid reads Paid on both", () => {
    const quote = { id: "q1", status: "accepted" };
    expect(
      deriveChatHeader({ quote, messages: [], invoiceStatus: "sent" } as never)
        .statusKey,
    ).toBe("asstChat.header.signedInvoiced");
    expect(
      deriveChatHeader({ quote, messages: [], invoiceStatus: "paid" } as never)
        .statusKey,
    ).toBe(threadChip("accepted", "paid")?.key);
    // no bill out (payment after completion): the quote's own words
    expect(deriveChatHeader({ quote, messages: [] } as never).statusKey).toBe(
      threadChip("accepted", undefined)?.key,
    );
  });

  test("REQ-563 an invoice sent on a quote that is NOT signed keeps the list's 'Invoiced' (REQ-369)", () => {
    expect(threadChip("sent", "sent")?.key).toBe("asstThreads.chip.invoiced");
  });
});

describe("REQ-563 m3 a change announced by another tab refreshes the ticker's feed", () => {
  test("REQ-563 announceChange from the /q tab asks the notifications feed at once, past the focus debounce", async () => {
    const open = new Set<
      { onmessage: ((e: { data: unknown }) => void) | null }
    >();
    _setChangeChannelForTest(() => {
      const ch = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        postMessage(data: unknown) {
          for (const c of [...open]) {
            if (c !== ch) queueMicrotask(() => c.onmessage?.({ data }));
          }
        },
        close() {
          open.delete(ch);
        },
      };
      open.add(ch);
      return ch;
    });
    const refreshFeed = jest.fn(() => Promise.resolve([] as never[]));
    _resetChangeFeedForTest({
      now: () => 1_000,
      win: null,
      refreshFeed,
      subscribeFeed: () => () => {},
    });
    const off = subscribeChanges(() => {});
    announceChange({ entityType: "quote", entityId: "q7" });
    await flush();
    expect(refreshFeed).toHaveBeenCalledTimes(1);
    off();
  });

  test("REQ-563 the topbar follows the change feed, so the ticker is refreshed on any page it is on", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/subscribeChanges\(/);
  });

  test("REQ-563 the chat re-reads its transcript when the quote it shows gets signed (the signed divider appears)", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /followChanges\([\s\S]{0,1600}becameSigned\([\s\S]{0,400}assistantClient\.conversation\(/,
    );
  });
});
