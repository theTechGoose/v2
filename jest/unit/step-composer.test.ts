/**
 * REQ-392 — demo-loop cycle 2, issue M7 (cycle 1 M9): "There is no chat box
 * during parts of the guided flow" — no text input at "Pick a price", "Who is
 * this for?" (and the in-chat customer form) or the "Ready to send" card, so
 * the contractor could not tell the assistant "that's wrong, it's the whole
 * job".
 *
 * Cause (RCA at deb85b35): front-end/islands/AsstChat.tsx `composerHidden` —
 * priceCaptureOpen || jobOptionsOpen || invoice screens || an unanswered
 * wizard card || previewCtaId — returned only the error strip. There was no
 * other free-text channel.
 *
 * Fix: the big composer stays off those tap steps (REQ-041 NW-53b, the
 * client's "if they are tapping options there should be no input field"), and
 * a compact "Tell the assistant…" box takes its place. Its text goes to
 * POST /agents/chat with the step it was typed on (the server re-prices on
 * Pick a price, rewrites the versions on Job details, answers with the step in
 * mind on a wizard question, revises the quote on Ready to send). The invoice
 * screens keep no composer.
 *
 * Targets: shared/quote-flow/step-composer.ts, shared/quote-flow/assistant-back.ts
 * (a chat turn typed under a wizard card keeps that card the active step), the
 * island's wiring, and both dictionaries.
 */
import * as fs from "fs";
import * as path from "path";
import {
  composerMode,
  type ComposerModeInput,
  parseChatStepHint,
  statedPriceCents,
} from "../../shared/quote-flow/step-composer";
import { activeWizardStepIdx } from "../../shared/quote-flow/assistant-back";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const closed = (): ComposerModeInput => ({
  priceCaptureOpen: false,
  jobOptionsOpen: false,
  invoiceReviewOpen: false,
  invoiceResultOpen: false,
  awaitingJobDetails: false,
  previewOpen: false,
  messages: [],
});

const wizardCard = (stepId: string, stepIdx = 0) => ({
  id: `w-${stepId}`,
  kind: "wizard",
  payload: { stepId, stepIdx },
});
const pick = (stepId: string) => ({
  id: `p-${stepId}`,
  kind: "text",
  payload: { wizardStepId: stepId },
});

describe("REQ-392 M7: every guided tap step keeps a compact composer", () => {
  test("REQ-392: Pick a price → the step composer, re-pricing", () => {
    expect(composerMode({ ...closed(), priceCaptureOpen: true })).toEqual({
      kind: "step",
      step: "price",
    });
  });

  test("REQ-392: the Job details picker → the step composer, job details", () => {
    expect(composerMode({ ...closed(), jobOptionsOpen: true })).toEqual({
      kind: "step",
      step: "job_details",
    });
  });

  test("REQ-392: 'Who is this for?' (an unanswered wizard card) → the step composer, naming the question", () => {
    expect(
      composerMode({ ...closed(), messages: [wizardCard("customer")] }),
    ).toEqual({ kind: "step", step: "wizard", wizardStepId: "customer" });
  });

  test("REQ-392: every later wizard question too (start, duration, payment, warranty)", () => {
    for (const id of ["start_date", "wraps", "payment_terms", "warranty"]) {
      const messages = [
        wizardCard("customer", 0),
        pick("customer"),
        wizardCard(id, 1),
      ];
      expect(composerMode({ ...closed(), messages })).toEqual({
        kind: "step",
        step: "wizard",
        wizardStepId: id,
      });
    }
  });

  test("REQ-392: Ready to send (the review card open) → the step composer, revising", () => {
    expect(composerMode({ ...closed(), previewOpen: true })).toEqual({
      kind: "step",
      step: "review",
    });
  });

  test("REQ-392: the invoice review and result screens keep no composer", () => {
    expect(composerMode({ ...closed(), invoiceReviewOpen: true })).toEqual({
      kind: "none",
    });
    expect(composerMode({ ...closed(), invoiceResultOpen: true })).toEqual({
      kind: "none",
    });
  });

  test("REQ-392: a plain chat, the details entry and an answered wizard keep the full composer", () => {
    expect(composerMode(closed())).toEqual({ kind: "full" });
    expect(composerMode({ ...closed(), awaitingJobDetails: true })).toEqual({
      kind: "full",
    });
    expect(
      composerMode({
        ...closed(),
        messages: [wizardCard("customer"), pick("customer")],
      }),
    ).toEqual({ kind: "full" });
  });

  test("REQ-392: the details entry restored by back keeps the full composer over a wizard question underneath", () => {
    expect(
      composerMode({
        ...closed(),
        awaitingJobDetails: true,
        messages: [wizardCard("customer")],
      }),
    ).toEqual({ kind: "full" });
  });

  test("REQ-392: the panel on screen wins — price over a wizard question underneath; the picker over an open review", () => {
    expect(
      composerMode({
        ...closed(),
        priceCaptureOpen: true,
        messages: [wizardCard("customer")],
      }),
    ).toEqual({ kind: "step", step: "price" });
    expect(
      composerMode({ ...closed(), jobOptionsOpen: true, previewOpen: true }),
    ).toEqual({ kind: "step", step: "job_details" });
  });

  test("REQ-392: a chat turn typed on a wizard question leaves that question active", () => {
    const messages = [
      wizardCard("customer", 0),
      {
        id: "u1",
        kind: "text",
        payload: { step: "wizard", stepQuestion: "customer" },
      },
      { id: "a1", kind: "text", payload: {} },
    ];
    expect(composerMode({ ...closed(), messages })).toEqual({
      kind: "step",
      step: "wizard",
      wizardStepId: "customer",
    });
    // …and Back still knows which step is on screen (it used to read only
    // the LAST message).
    expect(activeWizardStepIdx(messages)).toBe(0);
    expect(
      activeWizardStepIdx([
        wizardCard("start_date", 1),
        { id: "u", kind: "text", payload: { step: "wizard" } },
        { id: "a", kind: "text" },
      ]),
    ).toBe(1);
  });

  test("REQ-392: a pick or the send CTA after the card still ends the step for Back", () => {
    expect(
      activeWizardStepIdx([wizardCard("customer", 0), pick("customer")]),
    ).toBeNull();
    expect(
      activeWizardStepIdx([
        wizardCard("warranty", 4),
        { id: "c", kind: "continue_cta", payload: { toPhase: "send" } },
      ]),
    ).toBeNull();
  });
});

describe("REQ-392 M7: a price the contractor states in a correction fills the price box", () => {
  test("REQ-392: the demo's words — '$28k', '28k', '$28,000', '$28.5k'", () => {
    expect(
      statedPriceCents(
        "No that's wrong, it's the WHOLE gut job incl. heated floor, vanity, glass, drain move — more like $28k",
      ),
    ).toBe(2_800_000);
    expect(statedPriceCents("more like 28k")).toBe(2_800_000);
    expect(statedPriceCents("it should be $28,000")).toBe(2_800_000);
    expect(statedPriceCents("closer to $28.5k")).toBe(2_850_000);
  });

  test("REQ-392: a bare amount, a total, and Spanish", () => {
    expect(statedPriceCents("$4,500")).toBe(450_000);
    expect(statedPriceCents("4500 dollars")).toBe(450_000);
    expect(statedPriceCents("make it $4,500 total")).toBe(450_000);
    expect(statedPriceCents("cóbrale unos $3,700")).toBe(370_000);
    expect(statedPriceCents("más bien 28 mil dólares")).toBe(2_800_000);
  });

  test("REQ-392: never a cost, a deposit, two amounts or no amount", () => {
    expect(statedPriceCents("my plumber quoted $2,800 for the rough-in"))
      .toBeNull();
    expect(statedPriceCents("take a $500 deposit")).toBeNull();
    expect(statedPriceCents("30% down")).toBeNull();
    expect(
      statedPriceCents("tile is more like $6,000 and the vanity $2,000"),
    ).toBeNull();
    expect(statedPriceCents("add the permit and the toilet reset")).toBeNull();
    expect(statedPriceCents("")).toBeNull();
  });
});

describe("REQ-392 M7: the step hint on the wire", () => {
  test("REQ-392: each step's hint parses; the job and scope are trimmed and capped", () => {
    expect(parseChatStepHint({ id: "review" })).toEqual({ id: "review" });
    expect(
      parseChatStepHint({ id: "wizard", wizardStepId: "customer" }),
    ).toEqual({ id: "wizard", wizardStepId: "customer" });
    expect(
      parseChatStepHint({
        id: "price",
        job: "  Master bath gut  ",
        scope: "Tub out\nCurbless shower",
        tiers: true,
      }),
    ).toEqual({
      id: "price",
      job: "Master bath gut",
      scope: "Tub out\nCurbless shower",
      tiers: true,
    });
    const long = parseChatStepHint({
      id: "job_details",
      job: "x".repeat(20_000),
    });
    expect(long?.job?.length).toBe(8_000);
  });

  test("REQ-392: junk is no hint (the turn stays a plain chat turn)", () => {
    expect(parseChatStepHint(undefined)).toBeUndefined();
    expect(parseChatStepHint("price")).toBeUndefined();
    expect(parseChatStepHint({ id: "lock_quote" })).toBeUndefined();
    expect(parseChatStepHint({ id: 3 })).toBeUndefined();
    expect(parseChatStepHint({ id: "price", job: 7, tiers: "yes" })).toEqual({
      id: "price",
    });
  });
});

describe("REQ-392 M7: copy and wiring", () => {
  const UI_KEYS = [
    "asstChat.stepComposer.open",
    "asstChat.stepComposer.close",
    "asstChat.stepComposer.thinking",
    "asstChat.stepComposer.placeholder.price",
    "asstChat.stepComposer.placeholder.job_details",
    "asstChat.stepComposer.placeholder.wizard",
    "asstChat.stepComposer.placeholder.review",
    "chatCoordinator.step.repriced",
    "chatCoordinator.step.priceSetTiers",
    "chatCoordinator.step.priceSet",
    "chatCoordinator.step.priceAsk",
    "chatCoordinator.step.repriceFailed",
    "chatCoordinator.step.priceAskTiers",
    "chatCoordinator.step.jobOptions",
    "chatCoordinator.step.jobOptionsDegraded",
  ];

  test("REQ-392: both languages carry every new string, in their own language", () => {
    for (const k of UI_KEYS) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k].trim().length).toBeGreaterThan(0);
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["asstChat.stepComposer.open"]).toBe("Tell the assistant…");
  });

  test("REQ-392: the model-facing step prompts exist in both dictionaries", () => {
    for (
      const k of [
        "prompts.chatStep.correction",
        "prompts.chatStep.onScreen",
        "prompts.chatStep.wizard",
        "prompts.chatStep.review",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(es[k]).toBe(en[k]);
    }
  });

  test("REQ-392: the island picks the composer with composerMode and renders the step composer — no early return of the error strip alone", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/composerMode\(/);
    expect(src).toMatch(/<StepComposer\b/);
    expect(src).not.toMatch(/const composerHidden = /);
    const comp = read("front-end/components/StepComposer.tsx");
    expect(comp).toMatch(/data-cy="step-composer"/);
    expect(comp).toMatch(/asstChat\.stepComposer\.open/);
  });

  test("REQ-392: the chat client sends the step hint", () => {
    const client = read("front-end/clients/assistant.ts");
    expect(client).toMatch(/step\?: ChatStepHint/);
  });
});
