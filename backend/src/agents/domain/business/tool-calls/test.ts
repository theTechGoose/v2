/**
 * REQ-444 (demo-loop cycle 3, M21) — "says changes are done when they are
 * not". On Ready to send pair 7 asked, in one message, to fix the Spanish job
 * details AND "add a plumbing permit line $450". The model's tool calls were
 * cut to the first (OpenAILLMClient honoured one per turn), the job details
 * changed, nothing was priced, and the reply was the fixed "Done — the job
 * details on the quote are updated." with the total still $20,000.
 *
 * The pure rules: which of the model's calls run and in what order, and the
 * reply lines built from what actually changed.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import type { LLMAction } from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";
import {
  isEditAction,
  jobDetailsChangeLine,
  jobDetailsChangeOf,
  notDoneLine,
  planToolCalls,
  pricesSameLine,
  proseAnswer,
  sameJobDetails,
  toolCallsOf,
  totalMoveLine,
  workingTotalCents,
} from "./mod.ts";

const DETAILS: LLMAction = {
  type: "update_job_details",
  payload: { descriptionByLang: { en: "Demo\nPlumbing permit" } },
};
const PERMIT: LLMAction = {
  type: "change_order",
  payload: { description: "Plumbing permit", deltaAmountCents: 45_000 },
};
const REVISE: LLMAction = {
  type: "revise_quote",
  payload: { lines: [{ match: "Cabinets", amountCents: 500_000 }], remove: [] },
};
const DRAFT: LLMAction = {
  type: "create_quote",
  payload: {
    summary: "Fence repair",
    lineItems: [{ description: "Fence repair", amountCents: 120_000 }],
  },
};
const LOCK: LLMAction = { type: "lock_quote", payload: { quoteId: "q-1" } };
const TERMS: LLMAction = {
  type: "request_terms_transition",
  payload: { quoteId: "q-1" },
};

Deno.test("REQ-444 toolCallsOf: every call the model made, else the one action, else none", () => {
  assertEquals(
    toolCallsOf({ text: "", action: DETAILS, actions: [DETAILS, PERMIT] }),
    [DETAILS, PERMIT],
  );
  assertEquals(toolCallsOf({ text: "", action: PERMIT }), [PERMIT]);
  assertEquals(toolCallsOf({ text: "hi" }), []);
  assertEquals(toolCallsOf({ text: "", actions: [] }), []);
});

Deno.test("REQ-444 planToolCalls: several changes to the quote all run — the job details first, then each line change in the model's order", () => {
  assertEquals(planToolCalls([PERMIT, DETAILS, REVISE]), {
    edits: [DETAILS, PERMIT, REVISE],
    notDone: [],
  });
  assertEquals(planToolCalls([DETAILS, PERMIT]), {
    edits: [DETAILS, PERMIT],
    notDone: [],
  });
  const second: LLMAction = {
    type: "change_order",
    payload: { description: "Dumpster", deltaAmountCents: 60_000 },
  };
  assertEquals(planToolCalls([PERMIT, second]), {
    edits: [PERMIT, second],
    notDone: [],
  });
});

Deno.test("REQ-444 planToolCalls: one call runs on the single-action path as before; none is nothing", () => {
  assertEquals(planToolCalls([DRAFT]), { single: DRAFT, notDone: [] });
  assertEquals(planToolCalls([DETAILS]), { single: DETAILS, notDone: [] });
  assertEquals(planToolCalls([]), { notDone: [] });
});

Deno.test("REQ-444 planToolCalls: a mix that can't all run keeps the first call and names the rest", () => {
  assertEquals(planToolCalls([DRAFT, LOCK]), {
    single: DRAFT,
    notDone: ["lock_quote"],
  });
  assertEquals(planToolCalls([PERMIT, LOCK, TERMS]), {
    single: PERMIT,
    notDone: ["lock_quote", "request_terms_transition"],
  });
  // The same tool again is not reported as undone (one of it ran).
  // REQ-585 (demo-loop cycle 4, M4): the job details that ride along with a
  // create are folded into it — never reported as not done.
  assertEquals(planToolCalls([DRAFT, DRAFT, DETAILS]), {
    single: {
      type: "create_quote" as const,
      payload: {
        ...(DRAFT as Extract<LLMAction, { type: "create_quote" }>).payload,
        descriptionByLang: { en: "Demo\nPlumbing permit" },
      },
    },
    notDone: [],
  });
});

Deno.test("REQ-444 notDoneLine: says what wasn't done, in the contractor's language; nothing → no line", () => {
  assertEquals(notDoneLine("en", []), "");
  const en = notDoneLine("en", ["lock_quote"]);
  assertStringIncludes(en, "lock the quote");
  assertStringIncludes(en, "ask me again");
  const es = notDoneLine("es", ["lock_quote", "change_order"]);
  assertStringIncludes(es, "bloquear la cotización");
  assertStringIncludes(es, " y ");
  assert(!es.includes("lock"), es);
});

const BEFORE = "Demo existing kitchen\nInstall cabinets\nTile backsplash";

Deno.test("REQ-444 jobDetailsChangeLine: built from what changed — the languages, the lines added and removed", () => {
  assertEquals(
    jobDetailsChangeLine("en", {
      before: BEFORE,
      after: `${BEFORE}\nPlumbing permit`,
      langs: ["en", "es"],
    }),
    "Updated the job details (English, Spanish): added Plumbing permit.",
  );
  assertEquals(
    jobDetailsChangeLine("en", {
      before: BEFORE,
      after: "Demo existing kitchen\nTile backsplash\nPlumbing permit",
      langs: ["en"],
    }),
    "Updated the job details (English): added Plumbing permit; removed Install cabinets.",
  );
  assertEquals(
    jobDetailsChangeLine("es", {
      before: "Demoler la cocina",
      after: "Demoler la cocina\nPermiso de plomería",
      langs: ["en", "es"],
    }),
    "Actualicé los detalles del trabajo (inglés, español): agregué Permiso de plomería.",
  );
});

Deno.test("REQ-444 jobDetailsChangeLine: only another language changed → the languages, no invented lines; nothing changed → said so", () => {
  assertEquals(
    jobDetailsChangeLine("en", {
      before: BEFORE,
      after: BEFORE,
      langs: ["es"],
    }),
    "Updated the job details (Spanish).",
  );
  assertEquals(
    jobDetailsChangeLine("en", { before: BEFORE, after: BEFORE, langs: [] }),
    "The job details already say that — nothing changed.",
  );
  // Whitespace and case-only line differences are not changes.
  assertEquals(
    jobDetailsChangeLine("en", {
      before: "Demo existing kitchen\n",
      after: "  demo existing kitchen",
      langs: [],
    }),
    "The job details already say that — nothing changed.",
  );
  // No language list (the price step's details on screen): no parentheses.
  assertEquals(
    jobDetailsChangeLine("en", { before: BEFORE, after: `${BEFORE}\nPermit` }),
    "Updated the job details: added Permit.",
  );
});

Deno.test("REQ-444 totalMoveLine / pricesSameLine: the total's move, or that no price changed", () => {
  assertEquals(
    totalMoveLine("en", 2_000_000, 2_045_000),
    "Total $20,000.00 → $20,450.00.",
  );
  assertEquals(totalMoveLine("en", 2_000_000, 2_000_000), "");
  const same = pricesSameLine("en", 2_000_000);
  assertStringIncludes(same, "No price changed");
  assertStringIncludes(same, "$20,000.00");
  const sameEs = pricesSameLine("es", 2_000_000);
  assertStringIncludes(sameEs, "$20,000.00");
  assert(!sameEs.includes("No price changed"), sameEs);
});

Deno.test("REQ-444 jobDetailsChangeOf: what an update did to the quote — the reply language's lines before and after, and the languages whose text changed", () => {
  const current = {
    description: "Demo\nCabinets",
    descriptionByLang: { en: "Demo\nCabinets", es: "Demoler\nGabinetes" },
  };
  assertEquals(
    jobDetailsChangeOf("en", current, {
      en: "Demo\nCabinets\nPermit",
      es: "Demoler\nGabinetes\nPermiso",
    }),
    {
      before: "Demo\nCabinets",
      after: "Demo\nCabinets\nPermit",
      langs: ["en", "es"],
    },
  );
  // Only Spanish rewritten: English is unchanged, Spanish is named.
  assertEquals(
    jobDetailsChangeOf("en", current, { es: "Demoler\nGabinetes\nPermiso" }),
    { before: "Demo\nCabinets", after: "Demo\nCabinets", langs: ["es"] },
  );
  // The same text again is no change in that language.
  assertEquals(
    jobDetailsChangeOf("en", current, { en: " demo\ncabinets " }).langs,
    [],
  );
  // A language the quote never had is new — measured against the base text.
  assertEquals(
    jobDetailsChangeOf("es", { description: "Demo" }, { es: "Demoler" }),
    { before: "Demo", after: "Demoler", langs: ["es"] },
  );
});

Deno.test("REQ-444 sameJobDetails: the same lines, whitespace and case aside", () => {
  assert(sameJobDetails("Demo\nCabinets", "  demo \n\nCABINETS "));
  assert(!sameJobDetails("Demo\nCabinets", "Demo\nCabinets\nPermit"));
  assert(!sameJobDetails("Demo\nCabinets", "Cabinets\nDemo"));
});

Deno.test("REQ-444 workingTotalCents: the pending revision's total when one waits, else the quote's", () => {
  assertEquals(workingTotalCents({ estimatedTotal: 2_000_000 }), 2_000_000);
  assertEquals(
    workingTotalCents({
      estimatedTotal: 2_000_000,
      pendingRevision: { estimatedTotal: 2_045_000 },
    }),
    2_045_000,
  );
  assertEquals(
    workingTotalCents({
      estimatedTotal: 2_000_000,
      pendingRevision: { lineItems: [{ price: 45_000, quantity: 2 }] },
    }),
    90_000,
  );
  assertEquals(
    workingTotalCents({
      lineItems: [{ price: 100 }, { price: 50, quantity: 3 }],
    }),
    250,
  );
});

// ---------------------------------------------------------------------------
// REQ-585 (demo-loop cycle 4, M4 + M30)
// ---------------------------------------------------------------------------

const ES_DETAILS: LLMAction = {
  type: "update_job_details",
  payload: {
    descriptionByLang: {
      es: "Reparar fuga del grifo de la cocina\nColgar 2 puertas interiores",
    },
  },
};

Deno.test("REQ-585 M4 planToolCalls: pair 6's create_quote + update_job_details ('Ella habla español') is ONE create carrying the job details — nothing reported as not done", () => {
  const draft = DRAFT as Extract<LLMAction, { type: "create_quote" }>;
  const folded: ReturnType<typeof planToolCalls> = {
    single: {
      type: "create_quote",
      payload: {
        ...draft.payload,
        descriptionByLang: ES_DETAILS.type === "update_job_details"
          ? ES_DETAILS.payload.descriptionByLang
          : {},
      },
    },
    notDone: [],
  };
  assertEquals(planToolCalls([DRAFT, ES_DETAILS]), folded);
  // Whatever order the model made them in.
  assertEquals(planToolCalls([ES_DETAILS, DRAFT]), folded);
  // Two job-details calls: merged per language, the later one wins.
  const en: LLMAction = {
    type: "update_job_details",
    payload: { descriptionByLang: { en: "Fix kitchen faucet leak" } },
  };
  const plan = planToolCalls([DRAFT, ES_DETAILS, en]);
  assertEquals(plan.notDone, []);
  assertEquals(
    plan.single?.type === "create_quote"
      ? plan.single.payload.descriptionByLang
      : undefined,
    {
      es: "Reparar fuga del grifo de la cocina\nColgar 2 puertas interiores",
      en: "Fix kitchen faucet leak",
    },
  );
  // A lock that ran first still runs alone; the create (with its details) is
  // the one named as not done — the details are part of it.
  assertEquals(planToolCalls([LOCK, DRAFT, ES_DETAILS]), {
    single: LOCK,
    notDone: ["create_quote"],
  });
});

const RAW_ES =
  "Baño principal de la señora Tran en Round Rock, quitar la tina y poner regadera de azulejo con banca, vanity doble, el inodoro se queda pero lo reinstalamos, dos semanas y media, ponle precio, no sé, como 18 mil?";

Deno.test("REQ-585 M30 jobDetailsChangeLine: a one-line raw body that was rewritten is 'reworded' — her whole message is never echoed (twice)", () => {
  const out = jobDetailsChangeLine("es", {
    before: RAW_ES,
    after: RAW_ES.replace("como 18 mil?", "como 19,500?") +
      " Calefacción del piso.",
    langs: ["es"],
  });
  assertEquals(out, "Actualicé los detalles del trabajo (español).");
  assert(!out.includes("Tran"), out);
  // A short one-line body replaced by another: still not echoed twice.
  const short = jobDetailsChangeLine("en", {
    before: "Demo kitchen",
    after: "Demo the whole kitchen",
    langs: ["en"],
  });
  assertEquals(short, "Updated the job details (English).");
});

Deno.test("REQ-585 M30 jobDetailsChangeLine: a changed line longer than 80 characters is never echoed; short ones are still named, without a doubled period", () => {
  const long =
    "Install new white shaker cabinets from the cabinet place on Burnet Road with soft-close hinges and crown";
  assert(long.length > 80);
  const out = jobDetailsChangeLine("en", {
    before: "Demo existing kitchen\nTile backsplash",
    after: `Demo existing kitchen\nTile backsplash\n${long}`,
    langs: ["en", "es"],
  });
  assertEquals(out, "Updated the job details (English, Spanish).");
  assertEquals(
    jobDetailsChangeLine("es", {
      before: "Demoler la cocina\nAzulejo",
      after: "Demoler la cocina\nAzulejo\nCalefacción del piso.",
      langs: ["es"],
    }),
    "Actualicé los detalles del trabajo (español): agregué Calefacción del piso.",
  );
});

Deno.test("REQ-585 M4 proseAnswer: the model's answer stays, its claims of a change go (the outcome lines say what changed)", () => {
  assertEquals(
    proseAnswer(
      "Done — I updated the start date to Nov 23. Yes, a 50% deposit is common for remodels in Texas.",
    ),
    "Yes, a 50% deposit is common for remodels in Texas.",
  );
  assertEquals(
    proseAnswer(
      "Listo, actualicé la fecha de inicio. Sí, un anticipo del 50% es normal en Texas.",
    ),
    "Sí, un anticipo del 50% es normal en Texas.",
  );
  assertEquals(
    proseAnswer("I've removed the Floor stays line and updated the quote."),
    "",
  );
  assertEquals(proseAnswer(""), "");
  assertEquals(
    proseAnswer("Is the permit for the whole job or just the plumbing?"),
    "Is the permit for the whole job or just the plumbing?",
  );
});

Deno.test("REQ-585 update_terms is a change that runs beside the others, and is named when it didn't run", () => {
  const terms: LLMAction = {
    type: "update_terms",
    payload: { startDate: "next week" },
  };
  assert(isEditAction(terms));
  assertEquals(planToolCalls([terms, PERMIT]), {
    edits: [terms, PERMIT],
    notDone: [],
  });
  assertStringIncludes(notDoneLine("en", ["update_terms"]), "change the terms");
  assertStringIncludes(
    notDoneLine("es", ["update_terms"]),
    "cambiar los términos",
  );
});

// REQ-654 (demo-loop cycle 5, M10, pair 7): "please put the job details in
// spanish on the agreement too" got "The job details already say that —
// nothing changed." The Spanish copy already existed, but only behind the
// Preview's Español toggle, and the reply never said so.
Deno.test("REQ-654 M10 jobDetailsChangeLine: the other language is already there → say where to see it, in en and es", () => {
  const current = {
    description: "Demo\nCabinets",
    descriptionByLang: { en: "Demo\nCabinets", es: "Demolición\nGabinetes" },
  };
  const change = jobDetailsChangeOf("en", current, {
    en: "Demo\nCabinets",
    es: "Demolición\nGabinetes",
  });
  assertEquals(change.langs, []);
  assertEquals(
    jobDetailsChangeLine("en", change),
    "The Spanish job details are already on the agreement — switch Preview to Español to see them.",
  );
  // the model sent only the Spanish copy, unchanged
  assertEquals(
    jobDetailsChangeLine(
      "en",
      jobDetailsChangeOf("en", current, { es: "Demolición\nGabinetes" }),
    ),
    "The Spanish job details are already on the agreement — switch Preview to Español to see them.",
  );
  // a Spanish reply about the English copy
  assertEquals(
    jobDetailsChangeLine(
      "es",
      jobDetailsChangeOf("es", current, { en: "Demo\nCabinets" }),
    ),
    "Los detalles del trabajo en inglés ya están en el acuerdo: cambia la vista previa a English para verlos.",
  );
  // only the reply's own language, unchanged → the plain line
  assertEquals(
    jobDetailsChangeLine(
      "en",
      jobDetailsChangeOf("en", current, { en: "Demo\nCabinets" }),
    ),
    t("en", "chatCoordinator.jobDetails.same"),
  );
});
