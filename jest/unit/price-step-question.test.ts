/**
 * REQ-444 — demo-loop cycle 3, issue M21: "The assistant ignores questions and
 * says changes are done when they are not". On Pick a price, "does this
 * include the quartz slab material or just labor?? … ¿y el precio incluye el
 * permiso de plomería? add permit if not" got only "Re-priced with your note —
 * Competitive $17,000 · Market $20,000 · Premium $24,000." Later "Done — the
 * job details on the quote are updated." while the $450 permit was never
 * priced.
 *
 * Front-end / shared half of the fix:
 *   - the price step's hint carries the tiers on screen and what they include
 *     (the server's chat model answers a question about them);
 *   - a reply that rewrote the job details on screen ("add the permit") is
 *     applied to the details and the confirmed option — a language the reply
 *     didn't rewrite is dropped so the send translates it again;
 *   - every new string exists in both dictionaries, the "Done — …" template is
 *     gone, and the island is wired to both.
 *
 * Targets: shared/quote-flow/step-composer.ts, front-end/islands/AsstChat.tsx,
 * lang/en.json + lang/es.json.
 */
import * as fs from "fs";
import * as path from "path";
import {
  parseChatStepHint,
  stepScopeOf,
  withStepScope,
} from "../../shared/quote-flow/step-composer";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const TIERS = [
  {
    label: "Competitive",
    priceCents: 1_700_000,
    rationale: "Basic kitchen refresh",
  },
  {
    label: "Market",
    priceCents: 2_000_000,
    rationale: "Typical Austin kitchen remodel pricing",
  },
  { label: "Premium", priceCents: 2_400_000 },
];

describe("REQ-444 M21: the price step's hint carries what is on screen", () => {
  test("REQ-444: the tiers on screen and what they include ride with a price-step message", () => {
    expect(
      parseChatStepHint({
        id: "price",
        job: "Kitchen gut",
        scope: "Demo\nCabinets",
        tiers: true,
        options: TIERS,
        basis: "labor_materials_as_noted",
      }),
    ).toEqual({
      id: "price",
      job: "Kitchen gut",
      scope: "Demo\nCabinets",
      tiers: true,
      options: TIERS,
      basis: "labor_materials_as_noted",
    });
  });

  test("REQ-444: junk tiers and an unknown basis are dropped; at most four tiers", () => {
    const hint = parseChatStepHint({
      id: "price",
      options: [
        { label: "Market", priceCents: "2000000" },
        { label: "", priceCents: 5 },
        { label: "Low", priceCents: -5 },
        { label: "Odd", priceCents: 12.5 },
        "Premium $24k",
        { label: "A", priceCents: 100 },
        { label: "B", priceCents: 200, rationale: 7 },
        { label: "C", priceCents: 300 },
        { label: "D", priceCents: 400 },
        { label: "E", priceCents: 500 },
      ],
      basis: "cheap",
    });
    expect(hint).toEqual({
      id: "price",
      options: [
        { label: "A", priceCents: 100 },
        { label: "B", priceCents: 200 },
        { label: "C", priceCents: 300 },
        { label: "D", priceCents: 400 },
      ],
    });
    expect(parseChatStepHint({ id: "price", options: "x" })).toEqual({
      id: "price",
    });
  });
});

describe("REQ-444 M21: a reply that changed the job details on screen", () => {
  const confirmed = {
    id: "o2",
    jobName: "Kitchen Renovation",
    summary: "Kitchen renovation and cleanup",
    bullets: [
      { id: "b1", text: "Demo existing kitchen", deleted: false },
      { id: "b2", text: "Old line", deleted: true },
      { id: "b3", text: "Install cabinets", deleted: false },
    ],
    byLang: {
      en: {
        jobName: "Kitchen Renovation",
        summary: "Kitchen renovation and cleanup",
        bullets: ["Demo existing kitchen", "Install cabinets"],
      },
      es: {
        jobName: "Renovación de cocina",
        summary: "Renovación de cocina y limpieza",
        bullets: ["Demoler la cocina existente", "Instalar gabinetes"],
      },
    },
  };
  const NEW = "Demo existing kitchen\nInstall cabinets\nPlumbing permit";

  test("REQ-444: stepScopeOf reads the reply's new details (and any per-language copy); nothing or junk → none", () => {
    expect(
      stepScopeOf({
        step: "price",
        scope: ` ${NEW} `,
        scopeByLang: { es: "Permiso", fr: 3 },
      }),
    ).toEqual({ scope: NEW, byLang: { es: "Permiso" } });
    expect(stepScopeOf({ step: "price", scope: NEW })).toEqual({
      scope: NEW,
      byLang: {},
    });
    expect(stepScopeOf({ step: "price" })).toBeUndefined();
    expect(stepScopeOf({ step: "price", scope: "  " })).toBeUndefined();
    expect(stepScopeOf(undefined)).toBeUndefined();
    expect(stepScopeOf("scope")).toBeUndefined();
  });

  test("REQ-444: the confirmed option takes the new lines; a language the reply didn't rewrite is dropped (stale — the send translates it)", () => {
    const next = withStepScope(confirmed, { scope: NEW, byLang: {} }, "en");
    expect(next.bullets.map((b) => b.text)).toEqual([
      "Demo existing kitchen",
      "Install cabinets",
      "Plumbing permit",
    ]);
    expect(next.bullets.every((b) => !b.deleted)).toBe(true);
    expect(new Set(next.bullets.map((b) => b.id)).size).toBe(3);
    expect(next.byLang).toEqual({
      en: {
        jobName: "Kitchen Renovation",
        summary: "Kitchen renovation and cleanup",
        bullets: [
          "Demo existing kitchen",
          "Install cabinets",
          "Plumbing permit",
        ],
      },
    });
    expect(next.jobName).toBe("Kitchen Renovation");
    // the input is not mutated
    expect(confirmed.byLang.es.bullets).toHaveLength(2);
  });

  test("REQ-444: a language the reply did rewrite keeps its own lines", () => {
    const next = withStepScope(
      confirmed,
      {
        scope: NEW,
        byLang: {
          es:
            "Demoler la cocina existente\nInstalar gabinetes\nPermiso de plomería",
        },
      },
      "en",
    );
    expect(next.byLang?.es).toEqual({
      jobName: "Renovación de cocina",
      summary: "Renovación de cocina y limpieza",
      bullets: [
        "Demoler la cocina existente",
        "Instalar gabinetes",
        "Permiso de plomería",
      ],
    });
  });

  test("REQ-444: an option with no per-language copy stays without one", () => {
    const plain = { id: "x", jobName: "J", summary: "S", bullets: [] };
    const next = withStepScope(plain, { scope: "A\nB", byLang: {} }, "en");
    expect(next.bullets.map((b) => b.text)).toEqual(["A", "B"]);
    expect("byLang" in next).toBe(false);
  });
});

describe("REQ-444 M21: copy and wiring", () => {
  const UI_KEYS = [
    "chatCoordinator.step.askFailed",
    "chatCoordinator.step.repricedScope",
    "chatCoordinator.step.scopeUnchanged",
    "chatCoordinator.jobDetails.changed",
    "chatCoordinator.jobDetails.reworded",
    "chatCoordinator.jobDetails.same",
    "chatCoordinator.jobDetails.added",
    "chatCoordinator.jobDetails.removed",
    "chatCoordinator.jobDetails.lang.en",
    "chatCoordinator.jobDetails.lang.es",
    "chatCoordinator.jobDetails.pricesSame",
    "chatCoordinator.jobDetails.noQuote",
    "chatCoordinator.notDone",
    "chatCoordinator.notDone.and",
    "chatCoordinator.tool.create_quote",
    "chatCoordinator.tool.lock_quote",
    "chatCoordinator.tool.request_terms_transition",
    "chatCoordinator.tool.change_order",
    "chatCoordinator.tool.revise_quote",
    "chatCoordinator.tool.update_job_details",
  ];

  test("REQ-444: both languages carry every new string, in their own language", () => {
    for (const k of UI_KEYS) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k].trim().length).toBeGreaterThan(0);
      expect(es[k]).not.toBe(en[k]);
    }
  });

  test("REQ-444: the fixed 'Done — the job details on the quote are updated.' reply is gone", () => {
    expect(en["chatCoordinator.jobDetailsUpdated"]).toBeUndefined();
    expect(es["chatCoordinator.jobDetailsUpdated"]).toBeUndefined();
    const coordinator = read(
      "backend/src/agents/domain/coordinators/handle-chat-message/mod.ts",
    );
    expect(coordinator).not.toMatch(/chatCoordinator\.jobDetailsUpdated/);
  });

  test("REQ-444: the model reads the price step's prompt (both dictionaries, one text), and the review asks for one tool call per change", () => {
    const k = "prompts.chatStep.price";
    expect(typeof en[k]).toBe("string");
    expect(es[k]).toBe(en[k]);
    expect(en[k]).toMatch(/update_job_details/);
    expect(en[k]).toMatch(/never/i);
    const review = "prompts.chatStep.review";
    expect(es[review]).toBe(en[review]);
    expect(en[review]).toMatch(/one tool call (for|per) each change/i);
  });

  test("REQ-444: the island sends the tiers and their basis with a price-step message, and applies a rewritten scope from the reply", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const hint = src.slice(src.indexOf("function stepHintFor("));
    const priceHint = hint.slice(
      0,
      hint.indexOf('if (step === "job_details")'),
    );
    expect(priceHint).toMatch(/options:/);
    expect(priceHint).toMatch(/basis:/);
    const apply = src.slice(src.indexOf("function applyStepAnswer("));
    const priceApply = apply.slice(
      0,
      apply.indexOf("const opts = p.jobOptions"),
    );
    expect(priceApply).toMatch(/stepScopeOf\(/);
    expect(priceApply).toMatch(/withStepScope\(/);
    expect(priceApply).toMatch(/setPendingJobDetailsRaw\(/);
  });
});
