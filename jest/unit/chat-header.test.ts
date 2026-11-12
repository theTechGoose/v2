/**
 * REQ-245 (demo issue quote-invoice-money-m6) — the assistant chat header
 * says where the quote really is.
 *
 * The demo saw "Gathering a little more info" with the finished draft open
 * (the wizard ends with a continue_cta, never a new divider, so the header
 * sat on the phase-2 divider), "Quote sent" / "Out for signature" straight
 * after Lock (lock flipped the quote and the card to "sent"), "Out for
 * signature" after a send that reached nobody, and "New conversation" on a
 * thread that already had a quote (the price flow never emits an
 * action_card).
 *
 * Target: shared/quote-flow/chat-header.ts — the pure derivation the
 * AsstChat header effect dispatches (pm:asst-header).
 */
import * as fs from "fs";
import * as path from "path";
import {
  type ChatHeaderMessage,
  deriveChatHeader,
} from "../../shared/quote-flow/chat-header";

const H = "asstChat.header.";

const lockCard = (status: string): ChatHeaderMessage => ({
  kind: "action_card",
  payload: { actionType: "quote", status },
});
const toTerms: ChatHeaderMessage = {
  kind: "continue_cta",
  payload: { toPhase: "terms" },
};
const termsDivider: ChatHeaderMessage = {
  kind: "phase_divider",
  payload: { phase: 2 },
};
const wizardStep: ChatHeaderMessage = { kind: "wizard", payload: {} };
const readyToSendCta: ChatHeaderMessage = {
  kind: "continue_cta",
  payload: { toPhase: "send" },
};
const sendDivider = (
  p: Record<string, unknown>,
): ChatHeaderMessage => ({
  kind: "phase_divider",
  payload: { phase: 3, ...p },
});

describe("REQ-245 deriveChatHeader — status", () => {
  it("a brand-new thread: no quote, no card → the default line, 'New conversation'", () => {
    const h = deriveChatHeader({ messages: [] });
    expect(h.statusKey).toBe(`${H}default`);
    expect(h.clientKey).toBe(`${H}newConversation`);
    expect(h.clientName).toBeUndefined();
  });

  it("(a) the wizard finished (continue_cta → send after the phase-2 divider) → 'Ready to send', not 'Gathering a little more info'", () => {
    const h = deriveChatHeader({
      quote: { status: "draft", jobName: "Roof repair" },
      messages: [termsDivider, wizardStep, readyToSendCta],
    });
    expect(h.statusKey).toBe(`${H}readyToSend`);
  });

  it("(a) the 'I know my price' flow: draft quote, wizard complete, no action_card at all → 'Ready to send'", () => {
    const h = deriveChatHeader({
      quote: { status: "draft", jobName: "Fence" },
      messages: [
        { kind: "text", payload: {} },
        termsDivider,
        wizardStep,
        readyToSendCta,
      ],
    });
    expect(h.statusKey).toBe(`${H}readyToSend`);
  });

  it("terms persisted on the quote count as a finished wizard", () => {
    const h = deriveChatHeader({
      quote: {
        status: "draft",
        terms: [{ stepId: "payment", label: "x", value: "y" }],
      },
      messages: [],
    });
    expect(h.statusKey).toBe(`${H}readyToSend`);
  });

  it("while the wizard is still asking (phase-2 divider is the latest marker) → 'Gathering a little more info'", () => {
    const h = deriveChatHeader({
      quote: { status: "draft" },
      messages: [lockCard("locked"), toTerms, termsDivider, wizardStep],
    });
    expect(h.statusKey).toBe(`${H}gatheringInfo`);
  });

  it("re-entering the wizard after a finished one → back to 'Gathering a little more info'", () => {
    const h = deriveChatHeader({
      quote: { status: "draft" },
      messages: [termsDivider, readyToSendCta, termsDivider, wizardStep],
    });
    expect(h.statusKey).toBe(`${H}gatheringInfo`);
  });

  it("(b) right after Lock on today's backend (quote + card flipped to 'sent', no send yet) → 'Quote locked', never 'Quote sent' / 'Out for signature'", () => {
    const h = deriveChatHeader({
      quote: { status: "sent", sentAt: "2026-11-11T00:00:00Z" },
      messages: [lockCard("sent"), toTerms],
    });
    expect(h.statusKey).toBe(`${H}quoteLocked`);
  });

  it("(b) right after Lock while the client still holds the pre-lock quote row (status draft) → 'Quote locked'", () => {
    const h = deriveChatHeader({
      quote: { status: "draft" },
      messages: [lockCard("sent"), toTerms],
    });
    expect(h.statusKey).toBe(`${H}quoteLocked`);
  });

  it("(b) right after Lock with REQ-234's shape (status draft + lockedAt, card 'locked') → 'Quote locked'", () => {
    const h = deriveChatHeader({
      quote: { status: "draft", lockedAt: "2026-11-11T00:00:00Z" },
      messages: [lockCard("locked"), toTerms],
    });
    expect(h.statusKey).toBe(`${H}quoteLocked`);
  });

  it("(b) locked + wizard finished, still not sent → 'Ready to send'", () => {
    const h = deriveChatHeader({
      quote: { status: "sent", sentAt: "2026-11-11T00:00:00Z" },
      messages: [
        lockCard("sent"),
        toTerms,
        termsDivider,
        wizardStep,
        readyToSendCta,
      ],
    });
    expect(h.statusKey).toBe(`${H}readyToSend`);
  });

  it("a send that reached the customer (send divider with emailedTo) → 'Out for signature'", () => {
    const h = deriveChatHeader({
      quote: { status: "sent", sentAt: "2026-11-11T00:00:00Z" },
      messages: [
        lockCard("sent"),
        termsDivider,
        readyToSendCta,
        sendDivider({ channel: "email", emailedTo: "a@b.co" }),
      ],
    });
    expect(h.statusKey).toBe(`${H}outForSignature`);
  });

  it("a send by text that reached the customer → 'Out for signature'", () => {
    const h = deriveChatHeader({
      quote: { status: "sent" },
      messages: [sendDivider({ channel: "sms", textedTo: "+15555550100" })],
    });
    expect(h.statusKey).toBe(`${H}outForSignature`);
  });

  it("(M8) a send that reached nobody (send divider, no emailedTo/textedTo) → 'Not delivered', not 'Out for signature'", () => {
    const h = deriveChatHeader({
      quote: { status: "sent", sentAt: "2026-11-11T00:00:00Z" },
      messages: [
        lockCard("sent"),
        readyToSendCta,
        sendDivider({ channel: "email", emailFailureReason: "no_recipient" }),
      ],
    });
    expect(h.statusKey).toBe(`${H}notDelivered`);
  });

  it("a failed send then a delivered one → the latest send wins", () => {
    const h = deriveChatHeader({
      quote: { status: "sent" },
      messages: [
        sendDivider({ channel: "email", emailFailureReason: "x" }),
        sendDivider({ channel: "email", emailedTo: "a@b.co" }),
      ],
    });
    expect(h.statusKey).toBe(`${H}outForSignature`);
  });

  it("the customer opened it (status viewed) → 'Out for signature' even if the chat's send record says failed", () => {
    const h = deriveChatHeader({
      quote: { status: "viewed" },
      messages: [sendDivider({ channel: "email", emailFailureReason: "x" })],
    });
    expect(h.statusKey).toBe(`${H}outForSignature`);
  });

  it("a quote sent from outside the chat (status sent, no lock card in this thread) → 'Out for signature'", () => {
    const h = deriveChatHeader({
      quote: { status: "sent", sentAt: "2026-11-11T00:00:00Z" },
      messages: [],
    });
    expect(h.statusKey).toBe(`${H}outForSignature`);
  });

  it("a REQ-234 locked thread whose quote was later sent elsewhere (card 'locked', quote 'sent') → 'Out for signature'", () => {
    const h = deriveChatHeader({
      quote: {
        status: "sent",
        sentAt: "2026-11-12T00:00:00Z",
        lockedAt: "2026-11-11T00:00:00Z",
      },
      messages: [lockCard("locked")],
    });
    expect(h.statusKey).toBe(`${H}outForSignature`);
  });

  it("accepted outranks everything — quote.status, acceptedAt, or the phase-4 divider", () => {
    expect(
      deriveChatHeader({ quote: { status: "accepted" }, messages: [] })
        .statusKey,
    ).toBe(`${H}quoteAccepted`);
    expect(
      deriveChatHeader({
        quote: { status: "sent", acceptedAt: "2026-11-11T00:00:00Z" },
        messages: [sendDivider({ emailedTo: "a@b.co" })],
      }).statusKey,
    ).toBe(`${H}quoteAccepted`);
    expect(
      deriveChatHeader({
        messages: [
          sendDivider({ emailedTo: "a@b.co" }),
          { kind: "phase_divider", payload: { phase: 4 } },
        ],
      }).statusKey,
    ).toBe(`${H}quoteAccepted`);
  });

  it("a plain draft (quote or draft card, nothing locked) → 'Quote drafted · review'", () => {
    expect(
      deriveChatHeader({ quote: { status: "draft" }, messages: [] })
        .statusKey,
    ).toBe(`${H}quoteDrafted`);
    expect(
      deriveChatHeader({ messages: [lockCard("draft")] }).statusKey,
    ).toBe(`${H}quoteDrafted`);
  });
});

describe("REQ-245 deriveChatHeader — title", () => {
  it("the bound customer's name wins", () => {
    const h = deriveChatHeader({
      customerName: "  Ana Ruiz ",
      quote: { status: "draft", jobName: "Roof repair" },
      messages: [],
    });
    expect(h.clientName).toBe("Ana Ruiz");
    expect(h.clientKey).toBeUndefined();
  });

  it("(c) no customer, but a quote exists with no action_card (price flow) → the quote's job name, never 'New conversation'", () => {
    const h = deriveChatHeader({
      quote: { status: "draft", jobName: "Fence install" },
      messages: [readyToSendCta],
    });
    expect(h.clientName).toBe("Fence install");
    expect(h.clientKey).toBeUndefined();
  });

  it("(c) a quote without a job name → 'Conversation', never 'New conversation'", () => {
    const h = deriveChatHeader({ quote: { status: "draft" }, messages: [] });
    expect(h.clientKey).toBe(`${H}conversation`);
  });

  it("a draft card with no fetched quote yet → 'Conversation'", () => {
    const h = deriveChatHeader({ messages: [lockCard("draft")] });
    expect(h.clientKey).toBe(`${H}conversation`);
  });
});

describe("REQ-245 wiring + copy", () => {
  const root = path.resolve(__dirname, "../..");
  const chat = fs.readFileSync(
    path.join(root, "front-end/islands/AsstChat.tsx"),
    "utf8",
  );

  it("AsstChat's pm:asst-header effect dispatches deriveChatHeader, not its own divider/card precedence", () => {
    expect(chat).toMatch(
      /from "\.\.\/\.\.\/shared\/quote-flow\/chat-header\.ts"/,
    );
    const start = chat.indexOf("// P6.12: keep the chat header fresh");
    expect(start).toBeGreaterThan(-1);
    const effect = chat.slice(start, chat.indexOf('"pm:asst-header"', start));
    expect(effect).toContain("deriveChatHeader(");
    expect(effect).not.toContain("dividerPhase === 2");
  });

  it("the header effect re-runs when the quote's lifecycle fields change (terms / lockedAt / sentAt)", () => {
    const start = chat.indexOf("// P6.12: keep the chat header fresh");
    const deps = chat.slice(
      chat.indexOf("}, [", start),
      chat.indexOf("]);", chat.indexOf("}, [", start)),
    );
    expect(deps).toContain("quote?.terms");
    expect(deps).toContain("quote?.lockedAt");
    expect(deps).toContain("quote?.sentAt");
  });

  it("en and es carry every header status the derivation can name", () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(root, "lang/en.json"), "utf8"),
    );
    const es = JSON.parse(
      fs.readFileSync(path.join(root, "lang/es.json"), "utf8"),
    );
    for (
      const k of [
        "readyToSend",
        "notDelivered",
        "quoteLocked",
        "outForSignature",
        "quoteAccepted",
        "quoteDrafted",
        "gatheringInfo",
        "default",
        "conversation",
        "newConversation",
      ]
    ) {
      expect(typeof en[`${H}${k}`]).toBe("string");
      expect(typeof es[`${H}${k}`]).toBe("string");
    }
    expect(en[`${H}readyToSend`]).toBe("Ready to send");
    expect(en[`${H}notDelivered`]).toBe("Not delivered");
  });
});
