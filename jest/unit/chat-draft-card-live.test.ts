/**
 * REQ-660 (demo-loop cycle 5, M24) — "Old quote card keeps a live 'Lock it
 * in' with the stale price after correction". The chat's draft quote card
 * rendered the line items and total it was appended with; a correction made
 * through revise_quote replies with text + `payload.quoteUpdated` and appends
 * no new card, so the card kept "Total $532.50 · Lock it in" while the quote
 * was $8,700.
 *
 *   front-end/lib/chat-draft-card.ts   draftCardView
 *   front-end/islands/AsstChat.tsx     the action card renders through it
 *
 * Lazy-required so a missing module reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = () => require("../../front-end/lib/chat-draft-card");

const draftCard = (id: string, quoteId = "q1") => ({
  id,
  role: "assistant",
  kind: "action_card",
  payload: {
    actionType: "quote",
    status: "draft",
    quoteId,
    lineItems: [{ description: "Drywall patch", amountCents: 53250 }],
    totalCents: 53250,
  },
});
const revisionReply = (id: string, quoteId = "q1") => ({
  id,
  role: "assistant",
  kind: "text",
  content: "Updated the quote … Open Q-001",
  payload: {
    quoteRevision: { kind: "draft_updated", quoteId },
    quoteUpdated: quoteId,
  },
});
const liveQuote = {
  id: "q1",
  status: "draft",
  lineItems: [
    { description: "Drywall repair, 3 rooms", quantity: 1, price: 600000 },
    {
      description: "Paint",
      descriptionByLang: { es: "Pintura" },
      quantity: 2,
      price: 135000,
    },
  ],
  estimatedTotal: 870000,
};

describe("REQ-660 the draft quote card shows the quote as it is now", () => {
  test("REQ-660 after a revise_quote correction the card shows the live lines and total, not its $532.50 snapshot", () => {
    const messages = [draftCard("c1"), revisionReply("r1")];
    const view = lib().draftCardView(messages, messages[0], liveQuote, "en");
    expect(view.superseded).toBe(false);
    expect(view.totalCents).toBe(870000);
    expect(view.lineItems).toEqual([
      { description: "Drywall repair, 3 rooms", amountCents: 600000 },
      { description: "Paint", amountCents: 270000 },
    ]);
  });

  test("REQ-660 live lines speak the chat's language when the quote carries it", () => {
    const messages = [draftCard("c1")];
    const view = lib().draftCardView(messages, messages[0], liveQuote, "es");
    expect(view.lineItems[1].description).toBe("Pintura");
  });

  test("REQ-660 the total sums the live lines when the quote has no estimatedTotal", () => {
    const messages = [draftCard("c1")];
    const { estimatedTotal: _drop, ...noTotal } = liveQuote;
    const view = lib().draftCardView(messages, messages[0], noTotal, "en");
    expect(view.totalCents).toBe(870000);
  });

  test("REQ-660 an older draft card for the same quote is superseded by a newer card — Lock it in only on the newest", () => {
    const messages = [draftCard("c1"), revisionReply("r1"), draftCard("c2")];
    const lib_ = lib();
    expect(
      lib_.draftCardView(messages, messages[0], liveQuote, "en").superseded,
    )
      .toBe(true);
    const newest = lib_.draftCardView(messages, messages[2], liveQuote, "en");
    expect(newest.superseded).toBe(false);
    expect(newest.totalCents).toBe(870000);
  });

  test("REQ-660 a later locked card still supersedes the draft (audit #18 kept)", () => {
    const locked = {
      ...draftCard("c2"),
      payload: { ...draftCard("c2").payload, status: "locked" },
    };
    const messages = [draftCard("c1"), locked];
    expect(
      lib().draftCardView(messages, messages[0], liveQuote, "en").superseded,
    )
      .toBe(true);
  });

  test("REQ-660 a card for another quote, a card with no live quote, and a non-draft card keep their own snapshot", () => {
    const other = draftCard("c9", "q-other");
    const lib_ = lib();
    const a = lib_.draftCardView([other], other, liveQuote, "en");
    expect(a.totalCents).toBe(53250);
    expect(a.superseded).toBe(false);
    const b = lib_.draftCardView(
      [draftCard("c1")],
      draftCard("c1"),
      undefined,
      "en",
    );
    expect(b.totalCents).toBe(53250);
    const sent = {
      ...draftCard("c3"),
      payload: { ...draftCard("c3").payload, status: "sent" },
    };
    const c = lib_.draftCardView([sent], sent, liveQuote, "en");
    expect(c.totalCents).toBe(53250);
    expect(c.lineItems).toEqual([
      { description: "Drywall patch", amountCents: 53250 },
    ]);
  });

  test("REQ-660 a draft card for another quote is not superseded by this quote's cards", () => {
    const other = draftCard("c9", "q-other");
    const messages = [other, draftCard("c1")];
    expect(lib().draftCardView(messages, other, liveQuote, "en").superseded)
      .toBe(false);
  });

  test("REQ-660 the chat island renders the action card through draftCardView", () => {
    const island = read("front-end/islands/AsstChat.tsx");
    expect(island).toMatch(
      /import \{ draftCardView \} from "\.\.\/lib\/chat-draft-card\.ts"/,
    );
    const card = island.slice(
      island.indexOf('if (m.kind === "action_card") {'),
    );
    const body = card.slice(0, card.indexOf("return ("));
    expect(body).toMatch(/draftCardView\(\s*messages,\s*m,\s*ruleQuote/);
    // The old snapshot-only total and the draft-blind supersede scan are gone.
    expect(body).not.toMatch(/payload\.lineItems \?\? \[\]/);
    expect(body).not.toMatch(/\?\.status !== "draft"/);
  });
});
