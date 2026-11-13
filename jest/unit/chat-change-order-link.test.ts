/**
 * REQ-456 (demo-loop cycle 3, M25) — a chat change order shows its own
 * number and the customer's approval link.
 *
 * The demo's reply rendered only "Open Q-001": no CO number, no /co link,
 * so "send it to her" looked ignored. The change-order outcome now carries
 * `changeOrderNumber` + `approvalPath`; `chatChangeOrderLink` reads them and
 * AsstChat renders "CO-001" with Copy link / Open as customer.
 *
 *   front-end/lib/chat-quote-link.ts   chatChangeOrderLink
 *   front-end/islands/AsstChat.tsx     the chip under the reply
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const mod = () => require("../../front-end/lib/chat-quote-link");

describe("REQ-456 M25 chatChangeOrderLink — the reply names the change order and links its approval page", () => {
  it("reads the CO number and /co path off a change_order outcome", () => {
    expect(
      mod().chatChangeOrderLink({
        changeOrder: {
          kind: "change_order",
          quoteId: "q1",
          quoteNumber: "Q-001",
          invoiceId: "i1",
          changeOrderId: "co1",
          changeOrderNumber: "CO-001",
          approvalPath: "/co/co1?lang=en",
        },
      }),
    ).toEqual({
      changeOrderId: "co1",
      number: "CO-001",
      path: "/co/co1?lang=en",
    });
  });

  it("an older outcome without a path still links /co/<id>", () => {
    expect(
      mod().chatChangeOrderLink({
        changeOrder: {
          kind: "change_order",
          quoteId: "q1",
          invoiceId: "i1",
          changeOrderId: "co1",
        },
      }),
    ).toEqual({ changeOrderId: "co1", number: undefined, path: "/co/co1" });
  });

  it("a path that is not a /co page is not trusted", () => {
    expect(
      mod().chatChangeOrderLink({
        changeOrder: {
          kind: "change_order",
          changeOrderId: "co1",
          approvalPath: "https://evil.example/co/co1",
        },
      })?.path,
    ).toBe("/co/co1");
  });

  it("other outcomes have no change-order link", () => {
    const { chatChangeOrderLink } = mod();
    for (const kind of ["pending_revision", "draft_updated", "needs_invoice"]) {
      expect(chatChangeOrderLink({ changeOrder: { kind, quoteId: "q1" } }))
        .toBeUndefined();
    }
    expect(chatChangeOrderLink({ quoteRevision: { kind: "change_order" } }))
      .toBeUndefined();
    expect(chatChangeOrderLink(undefined)).toBeUndefined();
    expect(chatChangeOrderLink("nope")).toBeUndefined();
  });

  it("AsstChat renders the CO number with Copy link and Open as customer", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toContain("chatChangeOrderLink(m.payload)");
    expect(src).toContain(`data-cy="msg-co-open"`);
    expect(src).toContain(`data-cy="msg-co-copy"`);
    expect(src).toContain(`"asstChat.changeOrderLink.open"`);
    expect(src).toContain(`"asstChat.changeOrderLink.copy"`);
  });

  it("en and es carry the new copy, the reply names the CO number and no longer says 'I've sent you the link to share'", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const d of [en, es]) {
      expect(d["asstChat.changeOrderLink.open"]).toContain("{number}");
      expect(d["asstChat.changeOrderLink.copy"]).toContain("{number}");
      expect(d["chatCoordinator.changeOrder.created"]).toContain("{number}");
      expect(d["chatCoordinator.changeOrder.created"]).toContain("{sent}");
    }
    expect(en["chatCoordinator.changeOrder.created"]).not.toContain(
      "sent you the link",
    );
    expect(es["chatCoordinator.changeOrder.created"]).not.toContain(
      "te mandé el enlace",
    );
    const sentKeys = (d: Record<string, string>) =>
      Object.keys(d).filter((k) =>
        k.startsWith("chatCoordinator.changeOrder.sent.")
      ).sort();
    expect(sentKeys(en)).toEqual(sentKeys(es));
    expect(sentKeys(en).length).toBeGreaterThanOrEqual(8);
  });
});

/**
 * REQ-652 (demo-loop cycle 5, M8) — a chat change order is MADE unsent
 * (`sent: false`); the newest reply offers "Send CO-001" (its words are what
 * the chat reads as the send), with Preview (Open as customer) and Copy link
 * as the outlined secondaries.
 */
describe("REQ-652 M8 an unsent chat change order offers Send / Copy link / Preview", () => {
  const unsent = {
    changeOrder: {
      kind: "change_order",
      quoteId: "q1",
      invoiceId: "i1",
      changeOrderId: "co1",
      changeOrderNumber: "CO-001",
      approvalPath: "/co/co1",
      sent: false,
    },
  };

  it("chatChangeOrderLink marks an unsent change order", () => {
    expect(mod().chatChangeOrderLink(unsent)).toEqual({
      changeOrderId: "co1",
      number: "CO-001",
      path: "/co/co1",
      unsent: true,
    });
    expect(
      mod().chatChangeOrderLink({
        changeOrder: { ...unsent.changeOrder, sent: true },
      })?.unsent,
    ).toBeUndefined();
  });

  it("liveChangeOrderSendId: only the newest message, only an assistant reply with an unsent change order", () => {
    const { liveChangeOrderSendId } = mod();
    const reply = { id: "m2", role: "assistant", payload: unsent };
    const user = { id: "m1", role: "user", payload: undefined };
    expect(liveChangeOrderSendId([user, reply])).toBe("m2");
    expect(
      liveChangeOrderSendId([reply, { id: "m3", role: "user" }]),
    ).toBeUndefined();
    expect(
      liveChangeOrderSendId([{
        ...reply,
        payload: { changeOrder: { ...unsent.changeOrder, sent: true } },
      }]),
    ).toBeUndefined();
    expect(liveChangeOrderSendId([])).toBeUndefined();
  });

  it("AsstChat renders the Send button on the live unsent reply and sends its own words", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toContain("liveChangeOrderSendId(visible)");
    expect(src).toContain(`data-cy="msg-co-send"`);
    expect(src).toContain(`"asstChat.changeOrderLink.send"`);
    const i = src.indexOf(`data-cy="msg-co-send"`);
    expect(src.slice(i, i + 600)).toContain("sendText(");
  });

  it("en and es carry the Send label and the not-sent reply", () => {
    for (const l of ["en", "es"]) {
      const d = JSON.parse(read(`lang/${l}.json`));
      expect(d["asstChat.changeOrderLink.send"]).toContain("{number}");
      expect(d["chatCoordinator.changeOrder.createdNotSent"]).toContain(
        "{number}",
      );
    }
  });
});
