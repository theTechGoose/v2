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
  draftOwesDetails,
  threadChip,
} from "../../shared/quote-flow/chat-header";
import { threadTitle } from "../../shared/quote-flow/thread-title";
import { quoteJobTitle } from "../../shared/quote-flow/job-name";

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

  it("while the wizard is still asking on the locked quote (phase-2 divider is the latest marker) → REQ-454 'Quote locked · adding terms'", () => {
    const h = deriveChatHeader({
      quote: { status: "draft" },
      messages: [lockCard("locked"), toTerms, termsDivider, wizardStep],
    });
    expect(h.statusKey).toBe(`${H}lockedAddingTerms`);
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
  it("the bound customer's name is appended to the job name (REQ-385, cycle 2 m6)", () => {
    const h = deriveChatHeader({
      customerName: "  Ana Ruiz ",
      quote: { status: "draft", jobName: "Roof repair" },
      messages: [],
    });
    expect(h.clientName).toBe("Roof repair · Ana Ruiz");
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
        "lockedAddingTerms",
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

/**
 * REQ-385 (demo-loop cycle 2, demo issue m6) — the thread's labels agree
 * wherever it is named: the chat list said "Redactando" for a plain question
 * while the header said "Nueva conversación"; the header's title went
 * "New conversation" → job name → customer name; "Ready to send" sat over a
 * re-opened job-details picker; the customer card said "BORRADOR" beside the
 * assistant's "LISTA PARA ENVIAR".
 */
describe("REQ-385 (cycle 2, m6) status labels and headers agree", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
  const en = JSON.parse(read("lang/en.json"));
  const es = JSON.parse(read("lang/es.json"));

  it("a thread with no quote gets no chip — never 'Drafting' / 'Redactando' beside a 'New conversation' header", () => {
    expect(threadChip("none")).toBeNull();
    expect(threadChip(undefined)).toBeNull();
    expect(threadChip(null)).toBeNull();
    // the bill still rides on top once it is out
    expect(threadChip("none", "paid")?.key).toBe("status.paid");
    // a real status keeps its chip
    expect(threadChip("readyToSend")?.key).toBe(`${H}readyToSend`);
  });

  it("AsstThreads renders no chip when threadChip gives none", () => {
    const threads = read("front-end/islands/AsstThreads.tsx");
    expect(threads).toMatch(/chip\s*&&/);
  });

  it("the header title is ONE rule: the job name, then '· customer' appended — the list's title, never replaced", () => {
    const steps = [
      { jobName: undefined, customerName: undefined },
      { jobName: "Fence install", customerName: undefined },
      { jobName: "Fence install", customerName: "Ana Ruiz" },
    ];
    const titles = steps.map((p) =>
      deriveChatHeader({
        customerName: p.customerName,
        quote: p.jobName ? { status: "draft", jobName: p.jobName } : undefined,
        messages: [],
      }).clientName
    );
    expect(titles).toEqual([
      undefined,
      "Fence install",
      "Fence install · Ana Ruiz",
    ]);
    // the conversation list names the thread the same way
    for (const p of steps.slice(1)) {
      const h = deriveChatHeader({
        customerName: p.customerName,
        quote: { status: "draft", jobName: p.jobName },
        messages: [],
      });
      expect(h.clientName).toBe(threadTitle(p, "en"));
    }
    // a customer with no job name yet is still the title
    expect(
      deriveChatHeader({ customerName: " Ana Ruiz ", messages: [] })
        .clientName,
    ).toBe("Ana Ruiz");
  });

  it("the server-rendered title follows the same rule, not conversation.customerName ?? title", () => {
    const route = read("front-end/routes/assistant/[threadId].tsx");
    expect(route).not.toMatch(/detail\?\.conversation\?\.customerName \?\?/);
    expect(route).toMatch(/clientName \?\?/);
  });

  it("a re-opened job-details picker is 'Picking job details', not 'Ready to send'", () => {
    expect(draftOwesDetails({ polishRaw: "Fence, 40 ft" })).toBe(true);
    expect(draftOwesDetails({ jobOptionsOpen: true, pickerMode: "polish" }))
      .toBe(true);
    // the pre-quote "help me price it" confirm picker is not the job pick
    expect(draftOwesDetails({ jobOptionsOpen: true, pickerMode: "confirm" }))
      .toBe(false);
    expect(draftOwesDetails({ jobOptionsOpen: false, polishRaw: "  " }))
      .toBe(false);
    expect(draftOwesDetails(null)).toBe(false);
    const h = deriveChatHeader({
      quote: { status: "draft", jobName: "Fence install", terms: [{}] },
      messages: [readyToSendCta],
      detailsPending: draftOwesDetails({
        jobOptionsOpen: true,
        pickerMode: "polish",
      }),
    });
    expect(h.status).toBe("pickingDetails");
  });

  it("AsstChat's header counts the open job picker (the pencil re-open) as details pending", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    const at = chat.indexOf("const threadHeader = deriveChatHeader(");
    expect(at).toBeGreaterThan(-1);
    const call = chat.slice(at, chat.indexOf("});", at));
    expect(call).toMatch(/detailsPending:[^,]*jobOptionsOpen/);
  });

  it("the customer card's unsent quote reads 'Not sent', never 'Draft' beside 'Ready to send'", () => {
    expect(en["clientsBoard.docState.draft"]).toBe("Not sent");
    expect(es["clientsBoard.docState.draft"]).toBe("Sin enviar");
  });
});

/**
 * REQ-447 (demo-loop cycle 3, demo issues p8-pair10-d + m14) — the header
 * and the list name a thread by ONE rule. The list fell back to the stored
 * conversation title (the first message) while the header had no title
 * input at all, so a thread with messages but no quote read
 * "New conversation" in the header and was titled in the list (fleet-9
 * l.76). The quote's job name leads everywhere once there is one.
 */
describe("REQ-447 (cycle 3, p8-pair10-d/m14) header and list share one title rule", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
  const en = JSON.parse(read("lang/en.json"));
  const es = JSON.parse(read("lang/es.json"));
  const headerText = (
    h: ReturnType<typeof deriveChatHeader>,
    dict: Record<string, string>,
  ) => h.clientName ?? dict[h.clientKey ?? ""];

  it("a thread with a first message but no quote is titled by the conversation title, not 'New conversation' (fleet-9 l.76)", () => {
    const h = deriveChatHeader({
      title: "Fix the kitchen faucet for Ana",
      messages: [{ kind: "text" }],
    });
    expect(h.clientName).toBe("Fix the kitchen faucet for Ana");
    expect(h.clientKey).toBeUndefined();
  });

  it("the job name wins over the conversation title; the customer is appended", () => {
    expect(
      deriveChatHeader({
        title: "cambiar la llave del fregadero",
        quote: { status: "draft", jobName: "Faucet Replacement" },
        messages: [],
      }).clientName,
    ).toBe("Faucet Replacement");
    expect(
      deriveChatHeader({
        title: "cambiar la llave del fregadero",
        customerName: "Ana Ruiz",
        quote: { status: "draft", jobName: "Faucet Replacement" },
        messages: [],
      }).clientName,
    ).toBe("Faucet Replacement · Ana Ruiz");
  });

  it("for every combination the header reads exactly what the list row reads (threadTitle)", () => {
    const vals = {
      jobName: [undefined, "", "Fence install"],
      customerName: [undefined, "  ", "Ana Ruiz"],
      title: [undefined, "   ", "Need a fence quote"],
    };
    for (const jobName of vals.jobName) {
      for (const customerName of vals.customerName) {
        for (const title of vals.title) {
          const h = deriveChatHeader({
            customerName,
            title,
            messages: [],
          });
          // no quote here: the list's fallback is "New conversation"
          if (jobName) continue;
          expect(headerText(h, en)).toBe(
            threadTitle({ jobName, customerName, title }, "en"),
          );
          expect(headerText(h, es)).toBe(
            threadTitle({ jobName, customerName, title }, "es"),
          );
        }
        if (!jobName) continue;
        for (const title of vals.title) {
          const h = deriveChatHeader({
            customerName,
            title,
            quote: { status: "draft", jobName },
            messages: [],
          });
          expect(h.clientName).toBe(
            threadTitle({ jobName, customerName, title }, "en"),
          );
        }
      }
    }
  });

  it("AsstChat feeds the conversation title into the header and refreshes it from the turn's conversation", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    const at = chat.indexOf("const threadHeader = deriveChatHeader(");
    const call = chat.slice(at, chat.indexOf("});", at));
    expect(call).toMatch(/title:\s*convTitle/);
    // seeded from the route, and re-read after every turn
    expect(chat).toMatch(/initialTitle/);
    // REQ-671 (cycle 5, p8): through adoptTurnTitle, which the draft note
    // and the wizard answers share (c5-chat-header-title.test.ts).
    expect(chat).toMatch(/adoptTurnTitle\(res\.conversation\)/);
  });

  it("the server-rendered header passes the conversation title too", () => {
    const route = read("front-end/routes/assistant/[threadId].tsx");
    const at = route.indexOf("deriveChatHeader({");
    const call = route.slice(at, route.indexOf("})", at));
    expect(call).toMatch(/title:\s*detail\.conversation\?\.title/);
    expect(route).toMatch(/initialTitle=\{detail\?\.conversation\?\.title\}/);
  });
});

describe("REQ-447 (cycle 3, m14) the dashboard names the job by its jobName", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
  // REQ-497 AMENDMENT (reconciled on demo-fixes): the row goes through
  // jobRowTitle(j, lang) → quoteJobTitle, which still puts the jobName first
  // (per language), the summary only as a fallback.
  it("DashboardPage's active-job row shows quote.jobName, the summary only as a fallback", () => {
    const page = read("front-end/islands/DashboardPage.tsx");
    expect(page).toMatch(/task:\s*jobRowTitle\(j,\s*lang\)/);
    expect(page).not.toMatch(/task:\s*j\.quote\.summary,/);
    const q = { jobName: "Faucet Replacement", summary: "Replace the kitchen faucet — Ana" };
    expect(quoteJobTitle(q, "en")).toBe("Faucet Replacement");
    expect(quoteJobTitle({ summary: q.summary }, "en")).toBe(q.summary);
  });
});
