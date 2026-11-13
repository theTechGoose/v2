/**
 * REQ-230 (demo issue M14) — the assistant's pre-Continue flow lives on the
 * SERVER, on the conversation, so any reload — the contractor's own, or
 * another window (the demo stage) — rebuilds it: the typed details, the job
 * options and the pick, the price capture and its value, the preview CTA.
 *
 * Before: only the typed note reached the server (POST /draft {note}); the
 * options, the pick, the price and every view flag were useState plus a
 * per-tab sessionStorage stack, so GET /agents/conversations/:id held one
 * user message while the contractor sat on the options or the price.
 *
 * Target: shared/quote-flow/assistant-draft.ts (the wire shape + its parse
 * and restore rules), wired into front-end/islands/AsstChat.tsx and
 * front-end/routes/assistant/[threadId].tsx.
 */
import * as fs from "fs";
import * as path from "path";
import {
  type AssistantDraft,
  emptyAssistantDraft,
  isBlankDraft,
  maxBulletSeq,
  parseAssistantDraft,
  restorableDraft,
} from "../../shared/quote-flow/assistant-draft";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** The contractor on the price step of "help me price it": details typed,
 *  options generated, one picked and confirmed, a price chosen. */
function onPrice(): AssistantDraft {
  return {
    ...emptyAssistantDraft(),
    flowChip: "helpPrice",
    suggestPricing: true,
    jobDetailsRaw: "Patio slab 10x12 for the Nguyen family",
    submittedJobDetails: "Patio slab 10x12 for the Nguyen family",
    pickerMode: "polish",
    jobOptions: [
      {
        id: "opt-1",
        jobName: "Patio Slab",
        summary: "Pour a 10x12 concrete patio slab",
        bullets: [
          { id: "b1", text: "Excavate and grade", deleted: false },
          { id: "b2", text: "Pour 4in slab", deleted: true },
        ],
        byLang: {
          es: {
            jobName: "Losa de patio",
            summary: "Colar losa",
            bullets: ["Excavar", "Colar"],
          },
        },
      },
    ],
    selectedOptionId: "opt-1",
    confirmedOption: {
      id: "opt-1",
      jobName: "Patio Slab",
      summary: "Pour a 10x12 concrete patio slab",
      bullets: [{ id: "b1", text: "Excavate and grade", deleted: false }],
    },
    priceCaptureOpen: true,
    priceCents: 370000,
    priceSuggestions: [
      {
        tier: "market",
        label: "Market",
        priceCents: 370000,
        rationale: "Typical for the area",
      },
    ],
  };
}

describe("REQ-230 (M14): parseAssistantDraft — the one wire shape", () => {
  it("round-trips a full pre-Continue flow unchanged", () => {
    const d = onPrice();
    expect(parseAssistantDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("rejects what is not a draft object", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) {
      expect(parseAssistantDraft(bad)).toBeNull();
    }
  });

  it("fills missing fields with the empty draft and drops unknown ones", () => {
    const d = parseAssistantDraft({ priceCaptureOpen: true, evil: "x" });
    expect(d).toEqual({ ...emptyAssistantDraft(), priceCaptureOpen: true });
    expect(d && "evil" in d).toBe(false);
  });

  it("drops malformed values instead of trusting them", () => {
    const d = parseAssistantDraft({
      priceCents: -5,
      pickerMode: "nope",
      jobOptions: [{ id: 3 }, { id: "ok", jobName: "A", summary: "B", bullets: [{ id: "b1", text: "t" }] }],
      priceSuggestions: [{ tier: "cheap", label: "x", priceCents: 1, rationale: "" }],
      selectedOptionId: { x: 1 },
    })!;
    expect(d.priceCents).toBeNull();
    expect(d.pickerMode).toBe("polish");
    expect(d.jobOptions).toEqual([
      {
        id: "ok",
        jobName: "A",
        summary: "B",
        bullets: [{ id: "b1", text: "t", deleted: false }],
      },
    ]);
    expect(d.priceSuggestions).toBeNull();
    expect(d.selectedOptionId).toBeNull();
  });

  it("bounds what one client can park on a conversation", () => {
    const long = "x".repeat(50_000);
    const d = parseAssistantDraft({
      jobDetailsRaw: long,
      jobOptions: Array.from({ length: 40 }, (_, i) => ({
        id: `o${i}`,
        jobName: "n",
        summary: "s",
        bullets: Array.from({ length: 200 }, (_, j) => ({ id: `b${j}`, text: "t" })),
      })),
    })!;
    expect(d.jobDetailsRaw!.length).toBeLessThanOrEqual(8_000);
    expect(d.jobOptions!.length).toBeLessThanOrEqual(8);
    expect(d.jobOptions![0].bullets.length).toBeLessThanOrEqual(50);
  });
});

describe("REQ-230 (M14): isBlankDraft — plain chats never write a draft", () => {
  it("the empty draft is blank; any flow state is not", () => {
    expect(isBlankDraft(emptyAssistantDraft())).toBe(true);
    expect(isBlankDraft(onPrice())).toBe(false);
    expect(isBlankDraft({ ...emptyAssistantDraft(), awaitingJobDetails: true }))
      .toBe(false);
  });
});

describe("REQ-230 (M14): restorableDraft — what a reload paints", () => {
  it("before Continue (no quote) every panel comes back as it was", () => {
    const d = onPrice();
    expect(restorableDraft(d, { quoteBound: false, messageIds: [] })).toEqual(d);
  });

  it("after Continue (quote bound) the pre-quote panels stay closed", () => {
    const r = restorableDraft(onPrice(), { quoteBound: true, messageIds: [] });
    expect(r.priceCaptureOpen).toBe(false);
    expect(r.awaitingJobDetails).toBe(false);
    // the data itself is kept — the pick and the price are not thrown away
    expect(r.confirmedOption?.id).toBe("opt-1");
    expect(r.priceCents).toBe(370000);
  });

  it("after Continue a confirm-mode picker stays closed; the end-of-wizard (polish) picker reopens", () => {
    const confirm = { ...onPrice(), priceCaptureOpen: false, jobOptionsOpen: true, pickerMode: "confirm" as const };
    expect(restorableDraft(confirm, { quoteBound: true, messageIds: [] }).jobOptionsOpen).toBe(false);
    const polish = { ...confirm, pickerMode: "polish" as const };
    expect(restorableDraft(polish, { quoteBound: true, messageIds: [] }).jobOptionsOpen).toBe(true);
  });

  it("the preview CTA reopens only when its message is in the transcript", () => {
    const d = { ...emptyAssistantDraft(), previewCtaId: "m-cta" };
    expect(restorableDraft(d, { quoteBound: true, messageIds: ["m-cta"] }).previewCtaId).toBe("m-cta");
    expect(restorableDraft(d, { quoteBound: true, messageIds: ["other"] }).previewCtaId).toBeNull();
  });
});

describe("REQ-230 (M14): maxBulletSeq — restored bullet ids never collide with new ones", () => {
  it("returns the highest bN across options and the confirmed option", () => {
    const d = onPrice();
    d.confirmedOption!.bullets.push({ id: "b17", text: "x", deleted: false });
    expect(maxBulletSeq(d)).toBe(17);
    expect(maxBulletSeq(emptyAssistantDraft())).toBe(0);
  });
});

describe("REQ-230 (M14): the assistant persists and rebuilds its flow from the server", () => {
  const island = read("front-end/islands/AsstChat.tsx");
  const route = read("front-end/routes/assistant/[threadId].tsx");

  it("the thread route hands the server draft to the island", () => {
    expect(route).toMatch(/initialDraft=\{detail\?\.draft\}/);
  });

  it("the island seeds its flow state from initialDraft (SSR included)", () => {
    expect(island).toMatch(/initialDraft\?: AssistantDraft/);
    expect(island).toMatch(/restorableDraft\(/);
    for (const field of ["priceCaptureOpen", "priceCents", "jobOptions", "selectedOptionId", "pickerMode", "previewCtaId"]) {
      expect(island).toMatch(new RegExp(`useState[^\\n]*\\(\\s*seed\\??\\.${field}`));
    }
  });

  it("the island writes the flow to POST /agents/conversations/:id/draft as {draft}", () => {
    expect(island).toMatch(/\/agents\/conversations\/\$\{[^}]+\}\/draft`,\s*\{\s*draft/);
  });
});
