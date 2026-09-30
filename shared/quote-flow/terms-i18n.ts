/**
 * Localized manual-terms strings (P-25): the duration / warranty / payment
 * controls must SUBMIT localized term strings — never "Lifetime", "3 weeks",
 * or "Net 30" inside a Spanish contract.
 *
 * ES values ground out of lang/es.json: asstChat.warranty.lifetime
 * "De por vida"; duration units día/semana/mes; settings.contractDefaults.net
 * "Neto {n}". Wiring targets: the preview/submit strings built in
 * AsstChat.tsx:7705 (duration), 8075-8081 (warranty), 8479-8483 (payment).
 */

export type DurationUnit = "days" | "weeks" | "months";

export type Term =
  | { kind: "duration"; value: { n: number; unit: DurationUnit } }
  | { kind: "warranty"; value: "lifetime" | "none" | { n: number; unit: string } }
  | { kind: "payment"; value: { net: number } | { splits: number[] } };

type Lang = "en" | "es";

const UNIT_LABELS: Record<Lang, Record<string, { one: string; other: string }>> = {
  en: {
    days: { one: "day", other: "days" },
    weeks: { one: "week", other: "weeks" },
    months: { one: "month", other: "months" },
    years: { one: "year", other: "years" },
  },
  es: {
    days: { one: "día", other: "días" },
    weeks: { one: "semana", other: "semanas" },
    months: { one: "mes", other: "meses" },
    years: { one: "año", other: "años" },
  },
};

function countLabel(n: number, unit: string, lang: Lang): string {
  const labels = UNIT_LABELS[lang][unit];
  if (!labels) return `${n} ${unit}`;
  return `${n} ${n === 1 ? labels.one : labels.other}`;
}

/** The localized term string as it should be SUBMITTED into the contract. */
export function termLabel(term: Term, lang: Lang): string {
  switch (term.kind) {
    case "duration":
      return countLabel(term.value.n, term.value.unit, lang);
    case "warranty": {
      const v = term.value;
      if (v === "lifetime") return lang === "es" ? "De por vida" : "Lifetime";
      if (v === "none") return lang === "es" ? "Sin garantía" : "No warranty";
      return countLabel(v.n, v.unit, lang);
    }
    case "payment": {
      const v = term.value;
      if ("net" in v) {
        if (v.net === 0) {
          return lang === "es"
            ? "Neto 0 — se paga al terminar"
            : "Net 0 — due on completion";
        }
        return lang === "es" ? `Neto ${v.net}` : `Net ${v.net}`;
      }
      return v.splits.join(" / ");
    }
  }
}

/**
 * REQ-046 / REQ-047: the stored (English, neutral-base) value of the terms
 * wizard's "TBD" pick on the start-date and duration steps. Every reader
 * localizes it like any other preset ("Por definir" in Spanish).
 */
export const TERM_VALUE_TBD = "TBD";

/**
 * True when a stored term value is the TBD pick. A TBD duration is not an
 * estimate: the web agreement, the in-app preview and both PDFs skip their
 * "Estimated …" wrapper for it — "Time to complete: TBD", never
 * "Estimated TBD" (REQ-047).
 */
export function isTbdTermValue(value: string | undefined): boolean {
  return (value ?? "").trim().toUpperCase() === TERM_VALUE_TBD;
}
