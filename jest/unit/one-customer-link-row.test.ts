/**
 * REQ-571 (demo-loop cycle 4, p4-p2c) — one "Open as customer" row per quote.
 *
 * After a send the chat drew TWO identical customer-link rows for the same
 * quote: one under the send divider (REQ-310) and one on the sent action card
 * (REQ-310 / REQ-460). Neither checked for the other. The row now renders
 * once per quote, on the NEWEST message that would carry it.
 *
 *   front-end/lib/customer-link.ts   customerLinkOwnerIds
 *   front-end/islands/AsstChat.tsx   both CustomerLinkRow sites gate on it
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { customerLinkOwnerIds } from "../../front-end/lib/customer-link";

type Msg = { id: string; kind: string; payload?: Record<string, unknown> };

const sentCard = (id: string, quoteId: string): Msg => ({
  id,
  kind: "action_card",
  payload: { actionType: "quote", status: "sent", quoteId },
});
const sendDivider = (id: string, quoteId: string): Msg => ({
  id,
  kind: "phase_divider",
  payload: { quoteId, channel: "email", emailedTo: "a@b.c" },
});
const byStatus = (p: { status?: string }) =>
  ["sent", "viewed", "accepted"].includes(p.status ?? "");

describe("REQ-571 one customer-link row per quote", () => {
  test("REQ-571 a sent card followed by its send divider: only the divider carries the row", () => {
    const owners = customerLinkOwnerIds(
      [sentCard("c1", "q1"), sendDivider("d1", "q1")],
      byStatus,
    );
    expect([...owners]).toEqual(["d1"]);
  });

  test("REQ-571 a divider followed by a later sent card: only the card carries the row", () => {
    const owners = customerLinkOwnerIds(
      [sendDivider("d1", "q1"), sentCard("c1", "q1")],
      byStatus,
    );
    expect([...owners]).toEqual(["c1"]);
  });

  test("REQ-571 a resend: two dividers for one quote — only the newest", () => {
    const owners = customerLinkOwnerIds(
      [sentCard("c1", "q1"), sendDivider("d1", "q1"), sendDivider("d2", "q1")],
      byStatus,
    );
    expect([...owners]).toEqual(["d2"]);
  });

  test("REQ-571 different quotes each keep their own row", () => {
    const owners = customerLinkOwnerIds(
      [sendDivider("d1", "q1"), sentCard("c2", "q2")],
      byStatus,
    );
    expect(new Set(owners)).toEqual(new Set(["d1", "c2"]));
  });

  test("REQ-571 a card that would not show the link (locked) does not take the row from the divider", () => {
    const locked: Msg = {
      id: "c9",
      kind: "action_card",
      payload: { actionType: "quote", status: "locked", quoteId: "q1" },
    };
    const owners = customerLinkOwnerIds(
      [sendDivider("d1", "q1"), locked],
      byStatus,
    );
    expect([...owners]).toEqual(["d1"]);
  });

  test("REQ-571 wizard phase dividers and cards without a quote own nothing", () => {
    const owners = customerLinkOwnerIds(
      [
        { id: "p1", kind: "phase_divider", payload: { label: "Terms" } },
        { id: "c1", kind: "action_card", payload: { status: "sent" } },
        { id: "t1", kind: "text" },
      ],
      byStatus,
    );
    expect(owners.size).toBe(0);
  });
});

describe("REQ-571 AsstChat renders the row only on the owning message", () => {
  const src = readFileSync(
    join(__dirname, "../../front-end/islands/AsstChat.tsx"),
    "utf8",
  );

  test("REQ-571 the owner set is computed once over the rendered messages", () => {
    expect(src).toMatch(/customerLinkOwnerIds\(\s*ordered/);
  });

  test("REQ-571 every CustomerLinkRow site is gated on the owner set", () => {
    const sites = src.split("<CustomerLinkRow").slice(1);
    expect(sites.length).toBe(2);
    const before = src.split("<CustomerLinkRow").slice(0, -1);
    for (const chunk of before) {
      // the gate sits in the ~1200 chars before each site
      expect(chunk.slice(-1200)).toMatch(/linkOwners\.has\(m\.id\)/);
    }
  });
});
