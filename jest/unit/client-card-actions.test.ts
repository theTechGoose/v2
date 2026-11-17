/**
 * REQ-277 (demo issue M31) — "Open card →" and "Message" on the customer
 * card/panel did nothing: three `<button type="button">` with no handler,
 * copied from the static mock (front-end/islands/ClientsBoard.tsx).
 *
 * Every action on the card now does what its label says:
 *  - the footer nudge: a message verb ("Send a kind reminder", "Follow up",
 *    "Send a hello", "Send progress update") opens a text to the customer
 *    (sms:, else mailto:); "Open card" — or a message verb with no contact
 *    on file — opens the card's panel;
 *  - the panel's "Message" opens the same text; it is gone when there is
 *    nowhere to send one; the panel's own "Open card" (it IS the open card,
 *    and no profile page exists) is gone.
 * Pure logic: front-end/lib/client-actions.ts; wiring: the island source.
 */
import * as fs from "fs";
import * as path from "path";

// Lazy accessor so a missing module reds only the tests that use it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ca = () => require("../../front-end/lib/client-actions");

const base = {
  balanceCents: 0,
  status: "regular",
  phoneNumber: undefined as string | undefined,
  email: undefined as string | undefined,
};

describe("REQ-277 (M31) client-actions — where a card's actions go", () => {
  it("REQ-277 messageHrefFor texts the phone (sms:+1…), else mails, else nothing", () => {
    const { messageHrefFor } = ca();
    expect(messageHrefFor({ ...base, phoneNumber: "(512) 555-3150" })).toBe(
      "sms:+15125553150",
    );
    expect(
      messageHrefFor({
        ...base,
        phoneNumber: "+1 512 555 3150",
        email: "a@b.co",
      }),
    ).toBe("sms:+15125553150");
    expect(messageHrefFor({ ...base, email: " a@b.co " })).toBe(
      "mailto:a@b.co",
    );
    expect(messageHrefFor({ ...base, phoneNumber: "  ", email: "" }))
      .toBeNull();
    expect(messageHrefFor(base)).toBeNull();
  });

  it("REQ-277 ctaKindFor keeps the label precedence: reminder > progress > followUp > hello > openCard", () => {
    const { ctaKindFor } = ca();
    expect(ctaKindFor({ ...base, balanceCents: 100, status: "lead" })).toBe(
      "reminder",
    );
    expect(ctaKindFor({ ...base, status: "active" })).toBe("progress");
    expect(ctaKindFor({ ...base, status: "lead" })).toBe("followUp");
    expect(ctaKindFor({ ...base, status: "cold" })).toBe("hello");
    expect(ctaKindFor({ ...base, status: "regular" })).toBe("openCard");
  });

  it("REQ-277 nudgeActionFor: a message verb texts the customer; 'Open card' opens the panel", () => {
    const { nudgeActionFor } = ca();
    const phone = "512-555-3150";
    for (
      const c of [
        { ...base, balanceCents: 5000, phoneNumber: phone },
        { ...base, status: "active", phoneNumber: phone },
        { ...base, status: "lead", phoneNumber: phone },
        { ...base, status: "cold", phoneNumber: phone },
      ]
    ) {
      expect(nudgeActionFor(c)).toEqual({
        kind: "message",
        href: "sms:+15125553150",
      });
    }
    expect(nudgeActionFor({ ...base, status: "lead", email: "x@y.co" }))
      .toEqual({
        kind: "message",
        href: "mailto:x@y.co",
      });
    // "Open card" opens the card, even when a phone is on file
    expect(nudgeActionFor({ ...base, phoneNumber: phone })).toEqual({
      kind: "open",
    });
    // a message verb with nowhere to send it opens the card (its panel shows what's on file)
    expect(nudgeActionFor({ ...base, status: "lead" })).toEqual({
      kind: "open",
    });
  });
});

describe("REQ-277 (M31) ClientsBoard — no inert card buttons", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../front-end/islands/ClientsBoard.tsx"),
    "utf8",
  );

  it("REQ-277 every <button> on the card (ccard2__*) carries an onClick", () => {
    const buttons = src.match(/<button\b[^>]*>/g) ?? [];
    const cardButtons = buttons.filter((b) => /ccard2__/.test(b));
    expect(cardButtons.length).toBeGreaterThan(0);
    for (const b of cardButtons) expect(b).toMatch(/onClick=/);
  });

  it("REQ-277 the nudge and the panel's Message are wired to client-actions", () => {
    expect(src).toMatch(/nudgeActionFor\(/);
    expect(src).toMatch(/messageHrefFor\(/);
    expect(src).toMatch(/data-cy="ccard2-nudge"/);
    expect(src).toMatch(/data-cy="ccard2-message"/);
  });

  // REQ-277 AMENDMENT — reconciled with develop on demo-fixes: develop's
  // REQ-626 made the panel's "Open card" go somewhere (the client's sheet),
  // so it is back — never as a dead button.
  it("REQ-277 the panel's 'Open card' goes somewhere (REQ-626: the client's sheet)", () => {
    expect(src).toMatch(
      /data-cy="ccard2-open"\s+onClick=\{\(\) => onOpenCard\(c\.id\)\}[\s\S]{0,120}clientsBoard\.panel\.openCard/,
    );
  });
});
