/**
 * REQ-454 (demo-loop cycle 3, demo issue m34) — "Quote status goes
 * backwards: locked → Gathering more info → Accepted".
 *
 * The flow locks the price FIRST and runs the terms wizard after it
 * (REQ-234). `threadStatus` ranked the wizard's "asking" state above
 * "locked", so the header, the list chip and the lock card went
 * "Quote locked · ready to send" → "Gathering a little more info" — a step
 * back, on a quote that was still locked (RCA m34, CONFIRMED, skeptic
 * UPHELD: shared/quote-flow/chat-header.ts threadStatus, and
 * front-end/lib/send-delivery.ts headerStatusKey).
 *
 * Target: the wizard on a LOCKED quote reads forward — "Quote locked ·
 * adding terms" (status `addingTerms`, key asstChat.header.lockedAddingTerms)
 * — and nothing says "ready to send" before the terms are done.
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
import { cardChipKey } from "../../shared/quote-flow/quote-lock";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const KEY = "asstChat.header.lockedAddingTerms";

const card = (status: string): ChatHeaderMessage => ({
  kind: "action_card",
  payload: { actionType: "quote", status, quoteId: "q1" },
});
const lockCta: ChatHeaderMessage = {
  kind: "continue_cta",
  payload: { toPhase: "terms", quoteId: "q1" },
};
const termsDivider: ChatHeaderMessage = {
  kind: "phase_divider",
  payload: { phase: 2 },
};
const wizardStep: ChatHeaderMessage = { kind: "wizard", payload: {} };
const sendCta: ChatHeaderMessage = {
  kind: "continue_cta",
  payload: { toPhase: "send", quoteId: "q1" },
};
const LOCKED = { status: "draft", lockedAt: "2026-11-12T05:00:00Z" };

describe("REQ-454 m34: the terms wizard on a locked quote reads forward", () => {
  it("a locked quote in the wizard is 'addingTerms', not 'gathering' — chat transcript and server wizard state alike", () => {
    expect(
      threadStatus({
        quote: LOCKED,
        messages: [card("locked"), lockCta, termsDivider, wizardStep],
      }),
    ).toBe("addingTerms");
    expect(threadStatus({ quote: LOCKED, wizard: "asking" })).toBe(
      "addingTerms",
    );
    // the chat has the lock card before its quote row arrives
    expect(
      threadStatus({ messages: [card("locked"), termsDivider, wizardStep] }),
    ).toBe("addingTerms");
  });

  it("the header and the lock card's words: 'Quote locked · adding terms'", () => {
    const h = deriveChatHeader({
      quote: { ...LOCKED, jobName: "Fence install" },
      messages: [card("locked"), lockCta, termsDivider, wizardStep],
    });
    expect(h.status).toBe("addingTerms");
    expect(h.statusKey).toBe(KEY);
    expect(threadStatusKey("addingTerms")).toBe(KEY);
    expect(en[KEY]).toBe("Quote locked · adding terms");
    expect(es[KEY]).toBe("Cotización confirmada · agregando términos");
    expect(threadChip("addingTerms")).toEqual({ kind: "needs", key: KEY });
  });

  it("the walk drafted → locked → adding terms → ready to send only ever moves forward", () => {
    const steps: ThreadStatus[] = [
      threadStatus({ quote: { status: "draft" }, messages: [card("draft")] }),
      threadStatus({ quote: LOCKED, messages: [card("locked"), lockCta] }),
      threadStatus({
        quote: LOCKED,
        messages: [card("locked"), lockCta, termsDivider, wizardStep],
      }),
      threadStatus({
        quote: LOCKED,
        messages: [card("locked"), lockCta, termsDivider, wizardStep, sendCta],
      }),
    ];
    expect(steps).toEqual(["drafted", "locked", "addingTerms", "readyToSend"]);
    const order = steps.map((s) => THREAD_STATUSES.indexOf(s));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("nothing says 'ready to send' before the terms are done", () => {
    for (const k of [threadStatusKey("locked"), KEY, cardChipKey("locked")]) {
      expect(en[k]).not.toMatch(/ready/i);
      expect(es[k]).not.toMatch(/lista|listo/i);
    }
    expect(en[threadStatusKey("locked")]).toBe("Quote locked");
    expect(es[threadStatusKey("locked")]).toBe("Cotización confirmada");
  });

  it("a wizard on a quote that was never locked still reads 'gathering'", () => {
    expect(
      threadStatus({
        quote: { status: "draft" },
        messages: [termsDivider, wizardStep],
      }),
    ).toBe("gathering");
  });

  it("REQ-236's headerStatusKey overlay agrees: the phase-2 divider after a lock card is 'adding terms'", () => {
    expect(
      headerStatusKey({
        quoteAccepted: false,
        quote: { status: "draft" },
        lastDividerPayload: { phase: 2 },
        lastCardStatus: "locked",
        hasQuoteCard: true,
      }),
    ).toBe(KEY);
    expect(
      headerStatusKey({
        quoteAccepted: false,
        quote: undefined,
        lastDividerPayload: { phase: 2 },
        lastCardStatus: undefined,
        hasQuoteCard: true,
      }),
    ).toBe("asstChat.header.gatheringInfo");
  });
});
