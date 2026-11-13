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

/** REQ-343: service trades (cleaning, lawn, junk) quote jobs in hours. */
export type DurationUnit = "hours" | "days" | "weeks" | "months";

export type Term =
  | { kind: "duration"; value: { n: number; unit: DurationUnit } }
  | { kind: "warranty"; value: "lifetime" | "none" | { n: number; unit: string } }
  | { kind: "payment"; value: { net: number } | { splits: number[] } };

type Lang = "en" | "es";

const UNIT_LABELS: Record<Lang, Record<string, { one: string; other: string }>> = {
  en: {
    hours: { one: "hour", other: "hours" },
    days: { one: "day", other: "days" },
    weeks: { one: "week", other: "weeks" },
    months: { one: "month", other: "months" },
    years: { one: "year", other: "years" },
  },
  es: {
    hours: { one: "hora", other: "horas" },
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
      return splitLabel(v.splits, lang);
    }
  }
}

/**
 * REQ-665 (demo-loop cycle 5, m47): a payment split as the agreement prints
 * it. A bare "100 / 0" was stored and signed — readable as $100 / $0. Every
 * share now carries its "%", a two-payment split names the deposit and the
 * balance, and the two one-payment splits are their presets: 100/0 is
 * "Due Now" (paid in full upfront), 0/100 is "Payment upon completion".
 * computePaymentSplit still reads every one of these strings to the same money.
 */
function splitLabel(splits: number[], lang: Lang): string {
  const es = lang === "es";
  const paying = splits.filter((n) => n > 0);
  if (paying.length === 1 && splits[0] > 0) {
    return es ? DUE_NOW_ES : DUE_NOW_EN;
  }
  if (paying.length === 1 && splits[splits.length - 1] > 0) {
    return es ? "Pago al finalizar" : "Payment upon completion";
  }
  if (splits.length === 2) {
    const [a, b] = splits;
    return es
      ? `${a}% por adelantado, ${b}% al terminar`
      : `${a}% upfront, ${b}% on completion`;
  }
  return splits.map((n) => `${n}%`).join(" / ");
}

const DUE_NOW_EN = "Due Now";
/** lang/es.json quoteDoc.termValue.dueNow — what "Due Now" reads as. */
const DUE_NOW_ES = "Pago inmediato";

/**
 * REQ-665: true when a stored payment term is owed at signing — the "Due Now"
 * preset, or the Spanish picker's "Pago inmediato" for a 100/0 split. The
 * invoice due date, the "on signing" milestone and the New-invoice days all
 * read it.
 */
export function isDueNowTermValue(value: string | null | undefined): boolean {
  return /\bdue now\b|\bpago inmediato\b/i.test(value ?? "");
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
