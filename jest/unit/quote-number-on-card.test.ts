/**
 * REQ-465 (demo-loop cycle 3, issue m37) — the quote's number shows from the
 * first card, not only on the final review card.
 *
 * The Q-number exists from creation (QuoteStore.create → createNumbered), but
 * the draft / locked action cards and the chat header never named it: only
 * the review card (quote-review__num) did. The cards now read
 * "Q-001 · Quote locked" — the card's own `payload.number`, else the
 * already-fetched quote's number when it is that card's quote — and the
 * header's status line carries the same "Q-001 · …" prefix.
 */
import * as fs from "fs";
import * as path from "path";
import {
  actionCardNumber,
  numberedLabel,
} from "../../shared/documents/numbering";
import { deriveChatHeader } from "../../shared/quote-flow/chat-header";

const root = path.resolve(__dirname, "../..");
const ASST = fs.readFileSync(
  path.join(root, "front-end/islands/AsstChat.tsx"),
  "utf8",
);
const ROUTE = fs.readFileSync(
  path.join(root, "front-end/routes/assistant/[threadId].tsx"),
  "utf8",
);

describe("REQ-465 (m37) quote number on the chat cards and header", () => {
  test("REQ-465 the card's own number wins", () => {
    expect(
      actionCardNumber({ quoteId: "q1", number: "Q-001" }, {
        id: "q1",
        number: "Q-009",
      }),
    ).toBe("Q-001");
    expect(actionCardNumber({ quoteId: "q1", number: "Q-001" }, null)).toBe(
      "Q-001",
    );
  });

  test("REQ-465 a card without one falls back to the fetched quote — only when it is that quote", () => {
    expect(actionCardNumber({ quoteId: "q1" }, { id: "q1", number: "Q-004" }))
      .toBe("Q-004");
    expect(actionCardNumber({ quoteId: "q1" }, { id: "q2", number: "Q-004" }))
      .toBeUndefined();
    expect(actionCardNumber({ quoteId: "q1" }, undefined)).toBeUndefined();
    expect(actionCardNumber({}, { id: "q1", number: "Q-004" }))
      .toBeUndefined();
    expect(actionCardNumber({ quoteId: "q1", number: "  " }, { id: "q1" }))
      .toBeUndefined();
  });

  test("REQ-465 numberedLabel → 'Q-001 · Quote locked'; no number → the label alone", () => {
    expect(numberedLabel("Q-001", "Quote locked")).toBe("Q-001 · Quote locked");
    expect(numberedLabel(undefined, "Quote locked")).toBe("Quote locked");
    expect(numberedLabel("", "Borrador")).toBe("Borrador");
  });

  test("REQ-465 deriveChatHeader carries the thread quote's number", () => {
    const h = deriveChatHeader({
      customerName: "Acme",
      quote: { number: "Q-001", lockedAt: "2026-11-12T00:00:00Z" },
      messages: [],
    });
    expect(h.number).toBe("Q-001");
    expect(deriveChatHeader({ messages: [] }).number).toBeUndefined();
  });

  test("REQ-465 AsstChat's action card chip renders the number via actionCardNumber + numberedLabel", () => {
    const start = ASST.indexOf('if (m.kind === "action_card") {');
    expect(start).toBeGreaterThan(-1);
    const card = ASST.slice(start, start + 12000);
    expect(card).toMatch(/actionCardNumber\(\s*payload,\s*ruleQuote\s*\)/);
    expect(card).toMatch(/numberedLabel\(/);
    expect(card).toContain('data-cy="action-card-chip"');
  });

  test("REQ-465 the header status line (live + SSR) is prefixed with the quote number", () => {
    const effect = ASST.slice(
      ASST.indexOf("const threadHeader = deriveChatHeader("),
      ASST.indexOf('"pm:asst-header"'),
    );
    expect(effect).toMatch(/numberedLabel\(\s*header\.number/);
    expect(ROUTE).toMatch(/numberedLabel\(\s*ssrHeader\.number/);
  });
});
