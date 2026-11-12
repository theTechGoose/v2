/**
 * REQ-369 (demo-loop cycle 1, demo issue m2) — "Status labels disagree
 * inside the app": the chat header, the conversation list's chip and the
 * quote cards named different states for the same quote — "Quote accepted"
 * in the header while the list said "Quote sent"; "Ready to send" while the
 * job description was still being picked; "Locked · ready to send" against
 * "Drafting"; "Not delivered" against "Locked · ready to send"; a list chip
 * reading "Terms".
 *
 * Root cause (RCA m2, CONFIRMED, skeptic UPHELD): three independent
 * derivations — `deriveChatHeader` (the header), AsstThreads' `deriveChip`
 * (the denormalized conv.quoteStatus / currentPhase, which the customer's
 * public accept never updates, refreshed only by an 8 s poll), and each
 * action_card's append-time `payload.status`.
 *
 * Target: ONE rule — `threadStatus` in shared/quote-flow/chat-header.ts,
 * named through `threadStatusKey` (the same words on every surface; the list
 * adds its invoice tail with `threadChip`) — and the client sync in
 * front-end/lib/thread-status-sync.ts (the chat pushes its status to the
 * list; the list hands the server's newer status back to the chat).
 */
import * as fs from "fs";
import * as path from "path";
import {
  type ChatHeaderMessage,
  deriveChatHeader,
  THREAD_STATUSES,
  threadChip,
  type ThreadStatus,
  threadStatus,
  threadStatusKey,
} from "../../shared/quote-flow/chat-header";
import { headerStatusKey } from "../../front-end/lib/send-delivery";
import {
  latestThreadStatus,
  listNeedsRefresh,
  listStatusFor,
  publishThreadStatus,
  serverDisagreement,
  THREAD_SERVER_STATUS_EVENT,
  THREAD_STATUS_EVENT,
} from "../../front-end/lib/thread-status-sync";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const H = "asstChat.header.";

const card = (status: string): ChatHeaderMessage => ({
  kind: "action_card",
  payload: { actionType: "quote", status, quoteId: "q1" },
});
const termsDivider: ChatHeaderMessage = {
  kind: "phase_divider",
  payload: { phase: 2 },
};
const wizardStep: ChatHeaderMessage = { kind: "wizard", payload: {} };
const sendCta: ChatHeaderMessage = {
  kind: "continue_cta",
  payload: { toPhase: "send", quoteId: "q1" },
};
/** What SendQuote writes: a phase-3 divider naming the quote + the outcome. */
const sendDivider = (p: Record<string, unknown>): ChatHeaderMessage => ({
  kind: "phase_divider",
  payload: { phase: 3, quoteId: "q1", ...p },
});
const FAILED = {
  at: "2026-11-12T05:30:00Z",
  channel: "sms" as const,
  smsFailureReason: "made-up 555 number",
};
const DELIVERED = {
  at: "2026-11-12T05:31:00Z",
  channel: "email" as const,
  emailedTo: "john@example.com",
};

describe("REQ-369 threadStatus — one rule, fed by the quote row", () => {
  it("nothing on the thread → none; a quote or a draft card → drafted", () => {
    expect(threadStatus({})).toBe("none");
    expect(threadStatus({ quote: { status: "draft" } })).toBe("drafted");
    expect(threadStatus({ messages: [card("draft")] })).toBe("drafted");
  });

  it("a locked price (lockedAt, or the lock card) → locked", () => {
    expect(
      threadStatus({
        quote: { status: "draft", lockedAt: "2026-11-12T05:00:00Z" },
      }),
    ).toBe("locked");
    expect(
      threadStatus({ quote: { status: "draft" }, messages: [card("locked")] }),
    ).toBe("locked");
  });

  it("the terms wizard asking → gathering, from the transcript (chat) or the wizard state (server)", () => {
    const q = { status: "draft", lockedAt: "2026-11-12T05:00:00Z" };
    expect(
      threadStatus({
        quote: q,
        messages: [card("locked"), termsDivider, wizardStep],
      }),
    ).toBe("gathering");
    expect(threadStatus({ quote: q, wizard: "asking" })).toBe("gathering");
  });

  it("the wizard finished → readyToSend; with the job-details pick still owed → pickingDetails (demo: 'Ready to send' while picking scope)", () => {
    const q = { status: "draft", lockedAt: "2026-11-12T05:00:00Z" };
    const done = [card("locked"), termsDivider, wizardStep, sendCta];
    expect(threadStatus({ quote: q, messages: done })).toBe("readyToSend");
    expect(threadStatus({ quote: q, messages: done, detailsPending: true }))
      .toBe("pickingDetails");
    expect(threadStatus({ quote: q, wizard: "done", detailsPending: true }))
      .toBe("pickingDetails");
    expect(threadStatus({ quote: q, wizard: "done" })).toBe("readyToSend");
  });

  it("the pick is only owed at the END of the wizard: still asking → gathering", () => {
    expect(
      threadStatus({
        quote: { status: "draft" },
        messages: [termsDivider, wizardStep],
        detailsPending: true,
      }),
    ).toBe("gathering");
  });

  it("the row's own delivery record decides 'Not delivered' — the server's view has no transcript at all", () => {
    expect(
      threadStatus({
        quote: { status: "draft", lockedAt: "x", lastDelivery: FAILED },
      }),
    ).toBe("undelivered");
    // REQ-236: whatever status a pre-REQ-234 lock left on it
    expect(
      threadStatus({ quote: { status: "sent", lastDelivery: FAILED } }),
    ).toBe("undelivered");
  });

  it("a once-delivered quote whose resend failed is still out for signature (REQ-236)", () => {
    expect(
      threadStatus({
        quote: {
          status: "sent",
          lastDelivery: FAILED,
          deliveredAt: "2026-11-12T05:20:00Z",
        },
        messages: [sendDivider({ smsFailureReason: "x" })],
      }),
    ).toBe("sent");
  });

  it("delivered, sent or viewed → sent ('Out for signature')", () => {
    expect(
      threadStatus({
        quote: {
          status: "sent",
          lastDelivery: DELIVERED,
          deliveredAt: DELIVERED.at,
        },
      }),
    ).toBe("sent");
    expect(threadStatus({ quote: { status: "viewed" } })).toBe("sent");
  });

  it("the customer declined → declined", () => {
    expect(threadStatus({ quote: { status: "lost" } })).toBe("declined");
    expect(
      threadStatus({
        quote: { status: "sent", lostAt: "2026-11-12T06:00:00Z" },
      }),
    ).toBe("declined");
  });

  it("the customer signed on the public page: the row says accepted, the chat still holds the send divider → accepted", () => {
    expect(
      threadStatus({
        quote: {
          status: "accepted",
          acceptedAt: "2026-11-12T05:35:00Z",
          lastDelivery: DELIVERED,
          deliveredAt: DELIVERED.at,
        },
        messages: [
          card("locked"),
          sendCta,
          sendDivider({ emailedTo: "john@example.com" }),
        ],
      }),
    ).toBe("accepted");
  });
});

describe("REQ-369 one label per status — the header's words on every surface", () => {
  it("every status names one asstChat.header key, each carried by en and es", () => {
    const keys = THREAD_STATUSES.map((s) => threadStatusKey(s));
    expect(new Set(keys).size).toBe(THREAD_STATUSES.length);
    for (const k of keys) {
      expect(k.startsWith(H)).toBe(true);
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k].trim().length).toBeGreaterThan(0);
      expect(es[k].trim().length).toBeGreaterThan(0);
    }
  });

  it("'Picking job details' has its own words, not 'Ready to send'", () => {
    expect(en[threadStatusKey("pickingDetails")]).toBe("Picking job details");
    expect(es[threadStatusKey("pickingDetails")]).not.toBe(
      es[threadStatusKey("readyToSend")],
    );
    expect(en[threadStatusKey("declined")]).toBe("Quote declined");
  });

  it("the wizard's label is never 'Terms' and never 'ready' (the demo asked 'what does Terms mean?')", () => {
    expect(en[threadStatusKey("gathering")]).not.toMatch(/terms|ready/i);
    expect(es[threadStatusKey("gathering")]).not.toMatch(/términos|lista/i);
    expect(en["asstThreads.chip.terms"]).toBeUndefined();
    expect(es["asstThreads.chip.terms"]).toBeUndefined();
  });
});

describe("REQ-369 deriveChatHeader names the rule's status", () => {
  it("'Picking job details' when the send CTA exists but the job-details pick is still owed (demo pairs 1, 3, 4)", () => {
    const h = deriveChatHeader({
      quote: { status: "draft", jobName: "Roof repair" },
      messages: [termsDivider, wizardStep, sendCta],
      detailsPending: true,
    });
    expect(h.status).toBe("pickingDetails");
    expect(h.statusKey).toBe(`${H}pickingDetails`);
  });

  it("its statusKey is threadStatusKey(threadStatus(the same input)) for every shape the demo hit", () => {
    const inputs = [
      { messages: [] },
      { quote: { status: "draft" }, messages: [card("draft")] },
      { quote: { status: "draft", lockedAt: "x" }, messages: [card("locked")] },
      { quote: { status: "draft" }, messages: [termsDivider, wizardStep] },
      { quote: { status: "draft" }, messages: [termsDivider, sendCta] },
      {
        quote: { status: "draft" },
        messages: [termsDivider, sendCta],
        detailsPending: true,
      },
      { quote: { status: "draft", lastDelivery: FAILED }, messages: [] },
      { quote: { status: "sent", deliveredAt: "x" }, messages: [] },
      { quote: { status: "lost" }, messages: [] },
      { quote: { status: "accepted" }, messages: [card("locked")] },
    ];
    for (const input of inputs) {
      const h = deriveChatHeader(input);
      expect(h.status).toBe(threadStatus(input));
      expect(h.statusKey).toBe(threadStatusKey(threadStatus(input)));
    }
  });
});

describe("REQ-369 the conversation list's chip is the same status", () => {
  it("for every quote status the chip's words ARE the header's words", () => {
    for (const s of THREAD_STATUSES) {
      if (s === "none") continue;
      expect(threadChip(s)?.key).toBe(threadStatusKey(s));
    }
  });

  it("a thread with no quote yet has no chip (REQ-385, cycle 2 m6); the bill rides on top once it is out", () => {
    expect(threadChip("none")).toBeNull();
    expect(threadChip("accepted", "sent")).toEqual({
      kind: "sent",
      key: "asstThreads.chip.invoiced",
    });
    expect(threadChip("accepted", "paid")).toEqual({
      kind: "paid",
      key: "status.paid",
    });
  });

  // REQ-453 (demo-loop cycle 3, p8-pair5-d / p8-pair2-b): in-progress steps
  // are the neutral "progress" tone; only a failed send or a decline is pink.
  it("chip colours follow the status: signed paid-green, out sent-green, drafts quiet, in-progress neutral, failures needs-you", () => {
    expect(threadChip("accepted")?.kind).toBe("paid");
    expect(threadChip("sent")?.kind).toBe("sent");
    expect(threadChip("drafted")?.kind).toBe("draft");
    for (
      const s of [
        "locked",
        "gathering",
        "pickingDetails",
        "readyToSend",
      ] as ThreadStatus[]
    ) {
      expect(threadChip(s)?.kind).toBe("progress");
    }
    for (const s of ["undelivered", "declined"] as ThreadStatus[]) {
      expect(threadChip(s)?.kind).toBe("needs");
    }
  });
});

describe("REQ-369 REQ-236's header overlay can never contradict the rule", () => {
  // AsstChat still runs REQ-236's headerStatusKey over the header (kept so
  // the branch merges cleanly); the rule folds its "Not delivered" in, so
  // the overlay never turns the header into something the list and the
  // cards do not say.
  const rows = [
    undefined,
    { status: "draft" },
    { status: "draft", lockedAt: "x" },
    { status: "sent", sentAt: "x" },
    { status: "viewed" },
    { status: "lost" },
    { status: "draft", lastDelivery: FAILED },
    { status: "sent", lastDelivery: FAILED },
    { status: "sent", lastDelivery: FAILED, deliveredAt: "x" },
    { status: "sent", lastDelivery: DELIVERED, deliveredAt: DELIVERED.at },
    { status: "viewed", lastDelivery: FAILED },
  ];
  const dividers: (ChatHeaderMessage | undefined)[] = [
    undefined,
    termsDivider,
    sendDivider({ emailFailureReason: "no email" }),
    sendDivider({ emailedTo: "a@b.co" }),
    { kind: "phase_divider", payload: { phase: 3, smsFailureReason: "x" } },
  ];
  const cards = [undefined, "draft", "locked", "sent"];

  it("whenever the overlay says 'Not delivered', the rule says undelivered (or the customer already answered)", () => {
    for (const quote of rows) {
      for (const div of dividers) {
        for (const c of cards) {
          const messages = [
            ...(c ? [card(c)] : []),
            ...(div ? [div] : []),
          ];
          const status = threadStatus({ quote, messages });
          const overlay = headerStatusKey({
            quoteAccepted: quote?.status === "accepted",
            quote: quote as Parameters<typeof headerStatusKey>[0]["quote"],
            lastDividerPayload: div?.payload as Parameters<
              typeof headerStatusKey
            >[0]["lastDividerPayload"],
            lastCardStatus: c,
            hasQuoteCard: !!c,
          });
          if (
            overlay === `${H}notDelivered` &&
            status !== "accepted" && status !== "declined"
          ) {
            expect({ quote, div: div?.payload, c, status }).toEqual({
              quote,
              div: div?.payload,
              c,
              status: "undelivered",
            });
          }
        }
      }
    }
  });
});

describe("REQ-369 client sync — the chat and the list show one status", () => {
  const rows = [
    { id: "a", threadStatus: "locked" as ThreadStatus },
    { id: "b", threadStatus: "sent" as ThreadStatus },
  ];

  it("the open thread's row shows the chat's live status; the other rows their server status", () => {
    const live = { conversationId: "a", status: "gathering" as ThreadStatus };
    expect(listStatusFor(rows[0], live)).toBe("gathering");
    expect(listStatusFor(rows[1], live)).toBe("sent");
    expect(listStatusFor({ id: "c" }, null)).toBe("none");
  });

  it("a pushed status refreshes the list only when the server's row is missing or behind", () => {
    expect(
      listNeedsRefresh(rows, { conversationId: "a", status: "locked" }),
    ).toBe(false);
    expect(
      listNeedsRefresh(rows, { conversationId: "a", status: "gathering" }),
    ).toBe(true);
    expect(
      listNeedsRefresh(rows, { conversationId: "new", status: "drafted" }),
    ).toBe(true);
  });

  it("the server's newer status for the open thread is handed back to the chat (the customer signed meanwhile)", () => {
    const signed = [{ id: "a", threadStatus: "accepted" as ThreadStatus }];
    expect(
      serverDisagreement(signed, { conversationId: "a", status: "sent" }),
    ).toBe("accepted");
    expect(
      serverDisagreement(signed, { conversationId: "a", status: "accepted" }),
    ).toBeUndefined();
    expect(serverDisagreement(signed, null)).toBeUndefined();
    expect(
      serverDisagreement([{ id: "a" }], {
        conversationId: "a",
        status: "sent",
      }),
    ).toBeUndefined();
  });

  it("the two events have their own names", () => {
    expect(THREAD_STATUS_EVENT).toBe("pm:asst-thread-status");
    expect(THREAD_SERVER_STATUS_EVENT).toBe("pm:asst-thread-server-status");
  });

  it("the chat's push is dispatched AND kept, so a list that hydrates after the chat still shows it", () => {
    const seen: unknown[] = [];
    const target = new EventTarget();
    const g = globalThis as unknown as {
      dispatchEvent: (e: Event) => boolean;
      CustomEvent?: unknown;
    };
    const realDispatch = g.dispatchEvent;
    g.dispatchEvent = (e: Event) => target.dispatchEvent(e);
    target.addEventListener(THREAD_STATUS_EVENT, (e) => {
      seen.push((e as CustomEvent).detail);
    });
    try {
      expect(latestThreadStatus()).toBeNull();
      const pushed = { conversationId: "a", status: "pickingDetails" as const };
      publishThreadStatus(pushed);
      expect(seen).toEqual([pushed]);
      expect(latestThreadStatus()).toEqual(pushed);
    } finally {
      g.dispatchEvent = realDispatch;
    }
  });
});

describe("REQ-369 wiring — every surface reads the one rule", () => {
  const threads = read("front-end/islands/AsstThreads.tsx");
  const chat = read("front-end/islands/AsstChat.tsx");
  const route = read("front-end/routes/assistant/[threadId].tsx");

  it("AsstThreads labels its chip through threadChip + listStatusFor, never off quoteStatus / currentPhase", () => {
    expect(threads).toMatch(/threadChip\(/);
    expect(threads).toMatch(/listStatusFor\(/);
    expect(threads).not.toMatch(/quoteStatus\s*===/);
    expect(threads).not.toMatch(/currentPhase\s*===/);
    expect(threads).not.toMatch(/function deriveChip/);
  });

  it("AsstThreads takes the chat's push inside its one startPoll effect, and hands the server's status back", () => {
    const at = threads.indexOf("addEventListener(THREAD_STATUS_EVENT");
    expect(at).toBeGreaterThan(-1);
    const effect = threads.slice(
      threads.lastIndexOf("useEffect(", at),
      threads.indexOf("}, [", at),
    );
    expect(effect).toMatch(/startPoll\(/);
    expect(effect).toMatch(/listNeedsRefresh\(/);
    expect(threads).toMatch(/serverDisagreement\(/);
    expect(threads).toMatch(/THREAD_SERVER_STATUS_EVENT/);
  });

  it("AsstChat pushes its thread's status, and re-reads the quote row when the list knows better", () => {
    expect(chat).toMatch(
      /publishThreadStatus\(\{\s*conversationId: convoId,\s*status: threadHeader\.status/,
    );
    const at = chat.indexOf("addEventListener(THREAD_SERVER_STATUS_EVENT");
    expect(at).toBeGreaterThan(-1);
    const effect = chat.slice(chat.lastIndexOf("useEffect(", at), at);
    // one read per hand-back — not a poll (REQ-221's polls are startPoll's)
    expect(effect).toMatch(/quotesClient\.get\(rowId\)/);
    expect(effect).not.toMatch(/setInterval\(|startPoll\(/);
  });

  it("AsstThreads shows a push that came before it hydrated", () => {
    expect(threads).toMatch(/showLive\(latestThreadStatus\(\)\)/);
  });

  it("REQ-236's overlay in AsstChat leaves a customer's answer alone — accepted or declined", () => {
    const at = chat.indexOf("const undelivered =");
    expect(at).toBeGreaterThan(-1);
    const guard = chat.slice(at, chat.indexOf("headerStatusKey(", at));
    expect(guard).toMatch(/"accepted"/);
    expect(guard).toMatch(/"declined"/);
  });

  it("AsstChat's header knows the job-details pick is still owed", () => {
    expect(chat).toMatch(
      /deriveChatHeader\(\{[\s\S]{0,200}detailsPending: needsJobPolish/,
    );
  });

  it("AsstChat's quote cards name the thread's status through threadStatusKey, not their append-time payload.status", () => {
    expect(chat).toMatch(/threadStatusKey\(/);
    // the conversation's own quote card and the review card
    const card = chat.slice(
      chat.indexOf('if (m.kind === "action_card") {'),
      chat.indexOf("const isSuperseded"),
    );
    expect(card).toMatch(/threadStatusKey\(/);
    const review = chat.slice(
      chat.indexOf('<span class="quote-review__chip">'),
      chat.indexOf(
        "</span>",
        chat.indexOf('<span class="quote-review__chip">'),
      ),
    );
    expect(review).toMatch(/threadStatusKey\(/);
    expect(review).not.toMatch(/lockedPayload\.status/);
  });

  it("until its quote row is fetched, AsstChat's rule — header, cards and REQ-236's overlay alike — reads the route's snapshot of it", () => {
    // a card read "Locked · ready to send" under "Gathering a little more
    // info" until the row came (the e2e holds the row to prove it)
    expect(chat).toMatch(
      /const ruleQuote = quote \?\?\s*\(convoId === conversationId \? initialQuote : undefined\)/,
    );
    expect(chat).toMatch(/deriveChatHeader\(\{[\s\S]{0,120}quote: ruleQuote,/);
    const card = chat.slice(
      chat.indexOf('if (m.kind === "action_card") {'),
      chat.indexOf("const isSuperseded"),
    );
    expect(card).toMatch(/payload\.quoteId === ruleQuote\.id/);
    const at = chat.indexOf("const undelivered =");
    const overlay = chat.slice(
      at,
      chat.indexOf('=== "asstChat.header.notDelivered"', at),
    );
    expect(overlay).toMatch(/quote: ruleQuote/);
  });

  it("the server-rendered header is the same rule (no 'Phase: terms' before hydration)", () => {
    expect(route).toMatch(/deriveChatHeader\(/);
    expect(route).not.toMatch(/assistantThread\.phasePrefix/);
  });
});
