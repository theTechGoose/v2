/**
 * REQ-347 (demo-loop cycle 1, issue M16) — "English preview of a Spanish quote
 * keeps Spanish terms; preview and sent document disagree".
 *
 * The send card right after the last wizard chip rendered its term rows from
 * the wizard transcript (the quote it held predated the persisted terms), and
 * the transcript is in the contractor's UI language — so a Spanish contractor
 * previewing in English saw "La próxima semana / Estimado: 1 día / 1 año".
 *
 * Target: shared/quote-flow/wizard-terms.ts (the shared wizard spec + the
 * preview's English-base term rows) and its wiring in islands/AsstChat.tsx.
 */
import * as fs from "fs";
import * as path from "path";
import {
  mergeFreshTerms,
  previewTermRows,
} from "../../shared/quote-flow/wizard-terms";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS: Record<string, Record<string, string>> = {
  en: JSON.parse(read("lang/en.json")),
  es: JSON.parse(read("lang/es.json")),
};
/** The dictionaries' own lookup (tFor / backend t semantics). */
const t = (lang: string, key: string, vars?: Record<string, string | number>) =>
  (DICTS[lang]?.[key] ?? DICTS.en[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_m, k) => (vars && k in vars ? String(vars[k]) : `{${k}}`),
  );
/** EN is the identity, like front-end/lib/term-i18n.ts localizeTermValue. */
const localizeEn = (v: string) => v;

/** The transcript the backend writes for a Spanish contractor (content in the
 *  UI language, ids on the payload) — what pair 6's send card walked. */
const spanishTranscript = [
  {
    kind: "text",
    content: "Cliente: Ana Pérez",
    payload: { wizardStepId: "customer", optionId: "use_active" },
  },
  {
    kind: "text",
    content: "Inicio: La próxima semana",
    payload: { wizardStepId: "start_date", optionId: "next_week" },
  },
  {
    kind: "text",
    content: "Tiempo para completar: 1 día",
    payload: { wizardStepId: "wraps", optionId: "1_day" },
  },
  {
    kind: "text",
    content: "Pago: Pago inmediato",
    payload: { wizardStepId: "payment_terms", optionId: "due_now" },
  },
  {
    kind: "text",
    content: "Garantía: 1 año",
    payload: { wizardStepId: "warranty", optionId: "12_months" },
  },
];

describe("REQ-347 M16 the preview's terms start from the English base", () => {
  test("REQ-347: Spanish-UI transcript, no quote.terms → the English preview reads Next week / Estimated: 1 day / 1 year", () => {
    const rows = previewTermRows({
      quoteTerms: undefined,
      messages: spanishTranscript,
      previewLang: "en",
      t,
      localize: localizeEn,
    });
    expect(rows.map((r) => [r.stepId, r.value])).toEqual([
      ["start_date", "Next week"],
      ["wraps", "Estimated: 1 day"],
      ["payment_terms", "Due Now"],
      ["warranty", "1 year"],
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      "Start",
      "Time to complete",
      "Payment",
      "Warranty",
    ]);
  });

  test("REQ-347: a custom pick's value is the contractor's free text; a re-edit's latest pick wins", () => {
    const rows = previewTermRows({
      quoteTerms: null,
      messages: [
        ...spanishTranscript,
        {
          kind: "text",
          content: "Garantía: 3 años en techos",
          payload: {
            wizardStepId: "warranty",
            optionId: "custom_months",
            customValue: "3 años en techos",
          },
        },
      ],
      previewLang: "en",
      t,
      localize: localizeEn,
    });
    expect(rows.find((r) => r.stepId === "warranty")?.value).toBe(
      "3 años en techos",
    );
  });

  test("REQ-347: quote.terms, when present, is the source and the transcript is ignored", () => {
    const rows = previewTermRows({
      quoteTerms: [
        { stepId: "start_date", label: "Start", value: "Next month" },
        { stepId: "wraps", label: "Time to complete", value: "2 weeks" },
        { stepId: "warranty", label: "Warranty", value: "No warranty" },
      ],
      messages: spanishTranscript,
      previewLang: "en",
      t,
      localize: localizeEn,
    });
    // "No warranty" drops its row (the agreement's fine print still applies).
    expect(rows.map((r) => r.value)).toEqual([
      "Next month",
      "Estimated: 2 weeks",
    ]);
  });

  test("REQ-347: after a wizard answer the fresh quote's terms replace the stale copy", () => {
    const cur = { id: "q-1", summary: "local edit", terms: undefined };
    const fresh = {
      id: "q-1",
      summary: "server",
      terms: [{ stepId: "start_date", label: "Start", value: "Next week" }],
      estimatedCompletionDate: "2026-11-20",
    };
    const merged = mergeFreshTerms(cur, fresh);
    expect(merged?.terms).toEqual(fresh.terms);
    expect(merged?.estimatedCompletionDate).toBe("2026-11-20");
    expect(merged?.summary).toBe("local edit");
    // A different quote (the user moved on) is left alone.
    expect(mergeFreshTerms({ id: "q-2" }, fresh)).toEqual({ id: "q-2" });
    expect(mergeFreshTerms(undefined, fresh)).toBeUndefined();
  });

  test("REQ-347: the island builds its term rows with the helper and re-reads the quote after a wizard answer", () => {
    const island = read("front-end/islands/AsstChat.tsx");
    expect(island).toMatch(
      /from "\.\.\/\.\.\/shared\/quote-flow\/wizard-terms\.ts"/,
    );
    expect(island).toMatch(/previewTermRows\(\{/);
    // No more splitting the localized transcript at its colon.
    expect(island).not.toMatch(/const colon = raw\.indexOf\(":"\)/);
    const fn = island.slice(island.indexOf("async function postWizardAnswer("));
    const body = fn.slice(0, fn.indexOf("async function goBackWizard("));
    expect(body).toMatch(/quotesClient\.get\(/);
    expect(body).toMatch(/mergeFreshTerms\(/);
  });

  test("REQ-347: the backend wizard spec is the shared one (one source of option labels)", () => {
    const spec = read(
      "backend/src/agents/domain/business/terms-wizard-spec/mod.ts",
    );
    expect(spec).toMatch(/#quote-flow\/wizard-terms\.ts/);
    const coord = read(
      "backend/src/agents/domain/coordinators/handle-wizard-answer/mod.ts",
    );
    expect(coord).toMatch(/termFromPick\(/);
  });
});

// Reconciled on demo-fixes: REQ-343's service wizard reuses the step id
// `wraps` with hour presets. A service pick in the transcript must still
// resolve to its English term in the preview (the shared default step list
// searches the step that offers the option), not drop the duration row.
describe("REQ-343 + REQ-347 a service trade's hour pick previews", () => {
  test("REQ-343: wraps/2_hours with no quote.terms → 'Estimated: 2 hours'", () => {
    const rows = previewTermRows({
      quoteTerms: undefined,
      messages: [{
        kind: "text",
        content: "Tiempo para completar: 2 horas",
        payload: { wizardStepId: "wraps", optionId: "2_hours" },
      }],
      previewLang: "en",
      t,
      localize: localizeEn,
    });
    expect(rows).toEqual([{
      stepId: "wraps",
      label: DICTS.en["termsWizard.wraps.label"],
      value: t("en", "asstChat.preview.estimatedValue", {
        value: DICTS.en["termsWizard.wraps.twoHours"],
      }),
    }]);
  });
});
