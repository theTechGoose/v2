/**
 * REQ-585 (demo-loop cycle 4, M4 + M30) — the agreement terms typed in the
 * chat. Pair 7 typed "we start monday nov 23. and I want a 50% deposit
 * upfront…" on the start-date card, "oops no, empezamos la próxima semana, no
 * el próximo mes" after picking "Next month", and "its 2 and a half weeks not
 * 2" — no chat tool could change a term, so the model answered something else
 * and "Start: Next month" stayed (fleet-6 stdout:226/251/254).
 *
 * The update_terms tool carries the contractor's own words; these pure rules
 * read them on the server (a date against today — "monday nov 23" is Nov 23,
 * never the next Monday; a duration keeps its half), pick the wizard option
 * they are, word the reply line, and find the terms a message asks to change
 * so a change the model did not make is said instead of passed over.
 *
 *   startPick / durationPick / paymentPick — one value → a wizard pick
 *   pickForStep        — the pick against the step (a preset's own words are
 *                        that preset)
 *   termsPicks         — the update_terms payload in wizard order
 *   mentionedTerms     — the start / time to complete a message asks for
 *   termsChangeLine    — "Changed the start date: Next month → Next week."
 *   termsNotAppliedLine — "I didn't change the start date …"
 *   readDeadline / deadlineCheck / deadlineLine — REQ-653: "finish before
 *                        Thanksgiving" against the start + time to complete
 */
import type { WizardStep } from "@agents/dto/wizard.ts";
import { type Lang, t } from "@core/i18n/mod.ts";
import { formatTermDate } from "#quote-flow/format-helpers.ts";
import { completionFromTerms } from "#quote-flow/completion-schedule.ts";
import {
  TERMS_WIZARD_SERVICE_V1,
  TERMS_WIZARD_V1,
} from "@agents/domain/business/terms-wizard-spec/mod.ts";
import {
  extractPaymentTerms,
  wizardPrefillFor,
} from "#quote-flow/quote-facts.ts";
import { PAYMENT_TERMS_PRESETS } from "@agents/domain/business/terms-prefill/mod.ts";

/** A wizard pick for one step — what a tap would send. */
export interface TermPick {
  stepId: string;
  optionId: string;
  customValue?: string;
}

/** A step's value: a preset option, or the custom option with its value. */
export interface TermValue {
  optionId: string;
  customValue?: string;
}

/** The steps update_terms can change, in wizard order. */
export const TERM_STEPS = ["start_date", "wraps", "payment_terms"] as const;
export type TermStepId = typeof TERM_STEPS[number];

/** Accent-, case- and space-blind text (ñ → n), so one rule reads EN + ES. */
const fold = (s: string) =>
  (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\s+/g, " ").trim();

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  ene: 1,
  enero: 1,
  feb: 2,
  february: 2,
  febrero: 2,
  mar: 3,
  march: 3,
  marzo: 3,
  apr: 4,
  april: 4,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  june: 6,
  junio: 6,
  jul: 7,
  july: 7,
  julio: 7,
  aug: 8,
  august: 8,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  october: 10,
  octubre: 10,
  nov: 11,
  november: 11,
  noviembre: 11,
  dec: 12,
  december: 12,
  dic: 12,
  diciembre: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length)
  .join("|");

/** JS getDay() numbering (0 = Sunday), EN + ES, accents folded. */
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  domingo: 0,
  monday: 1,
  mon: 1,
  lunes: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  martes: 2,
  wednesday: 3,
  wed: 3,
  miercoles: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  jueves: 4,
  friday: 5,
  fri: 5,
  viernes: 5,
  saturday: 6,
  sat: 6,
  sabado: 6,
};
const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length)
  .join("|");

const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  doce: 12,
};
const NUM_RE = String.raw`\d+(?:[.,]\d+)?|` +
  Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join("|");
const numberOf = (tok: string): number =>
  /^\d/.test(tok) ? Number(tok.replace(",", ".")) : NUM_WORDS[tok] ?? NaN;

/** A calendar day for month/day(/year): a day already gone — no year, or a
 *  year in the past the model made up — is the next such day. */
function resolveDay(
  month: number,
  day: number,
  year: number | null,
  today: Date,
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = dayOf(today);
  let y = year ?? start.getFullYear();
  if (y < 100) y += 2000;
  let d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1) return null; // Feb 30
  if (d < start) {
    d = new Date(start.getFullYear(), month - 1, day);
    if (d < start) d = new Date(start.getFullYear() + 1, month - 1, day);
    if (d.getMonth() !== month - 1) return null; // Feb 29 → no leap year
  }
  return isoOf(d);
}

/** An explicit calendar date in the text: ISO, "nov 23", "23 de noviembre",
 *  "11/23". A weekday next to it ("monday nov 23") is only a weekday. */
function explicitDate(s: string, today: Date): string | null {
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return resolveDay(Number(m[2]), Number(m[3]), Number(m[1]), today);
  m = s.match(
    new RegExp(
      String
        .raw`\b(${MONTH_RE})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(?:de\s+)?(\d{4}))?`,
    ),
  );
  if (m) {
    return resolveDay(
      MONTHS[m[1]],
      Number(m[2]),
      m[3] ? Number(m[3]) : null,
      today,
    );
  }
  m = s.match(
    new RegExp(
      String
        .raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:de\s+|of\s+)?(${MONTH_RE})\b(?:,?\s+(?:de\s+|del\s+)?(\d{4}))?`,
    ),
  );
  if (m) {
    return resolveDay(
      MONTHS[m[2]],
      Number(m[1]),
      m[3] ? Number(m[3]) : null,
      today,
    );
  }
  m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/);
  if (m) {
    let [month, day] = [Number(m[1]), Number(m[2])];
    if (month > 12 && day <= 12) [month, day] = [day, month];
    return resolveDay(month, day, m[3] ? Number(m[3]) : null, today);
  }
  return null;
}

const START_PRESETS: [string, RegExp][] = [
  [
    "next_week",
    /\b(?:next[\s_]week|proxima semana|semana que viene|semana entrante)\b/,
  ],
  [
    "next_month",
    /\b(?:next[\s_]month|proximo mes|mes que viene|mes entrante)\b/,
  ],
  [
    "asap",
    /\b(?:asap|right away|right now|immediately|as soon as possible|de inmediato|inmediatamente|ya mismo|lo antes posible|cuanto antes|lo mas pronto posible)\b/,
  ],
  [
    "tbd",
    /\b(?:tbd|to be determined|not sure(?: yet)?|undecided|por definir|por determinar|no se (?:todavia|aun)|sin fecha)\b/,
  ],
];

/**
 * The start-date pick a value names: a preset (next week / next month / right
 * away / TBD, EN or ES), or the custom option with an ISO day read against
 * `today` — "monday nov 23" is Nov 23, "monday" the next Monday, "tomorrow"
 * tomorrow. Null when it names no day.
 */
export function startPick(
  text: string,
  today: Date = new Date(),
): TermPick | null {
  const s = fold(text);
  if (!s) return null;
  const custom = (iso: string): TermPick => ({
    stepId: "start_date",
    optionId: "custom",
    customValue: iso,
  });
  const date = explicitDate(s, today);
  if (date) return custom(date);
  for (const [optionId, re] of START_PRESETS) {
    if (re.test(s) || s === optionId) {
      return { stepId: "start_date", optionId };
    }
  }
  const start = dayOf(today);
  if (/\bpasado manana\b/.test(s)) return custom(isoOf(plusDays(start, 2)));
  if (/\b(?:tomorrow|manana)\b/.test(s)) {
    return custom(isoOf(plusDays(start, 1)));
  }
  if (/\b(?:today|hoy)\b/.test(s)) return custom(isoOf(start));
  const w = s.match(new RegExp(String.raw`\b(${WEEKDAY_RE})\b`));
  if (w) {
    const ahead = ((WEEKDAYS[w[1]] - start.getDay()) + 7) % 7 || 7;
    return custom(isoOf(plusDays(start, ahead)));
  }
  const rel = s.match(
    new RegExp(
      String
        .raw`\b(?:in|en|dentro de)\s+(${NUM_RE})\s+(days?|dias?|weeks?|semanas?)\b`,
    ),
  );
  if (rel) {
    const n = numberOf(rel[1]);
    if (Number.isInteger(n) && n > 0) {
      const days = /^(?:d)/.test(rel[2]) ? n : n * 7;
      return custom(isoOf(plusDays(start, days)));
    }
  }
  return null;
}

type Unit = "hours" | "days" | "weeks" | "months";
const unitOf = (u: string): Unit =>
  /^(?:h|hora)/.test(u)
    ? "hours"
    : /^d/.test(u)
    ? "days"
    : /^(?:w|semana)/.test(u)
    ? "weeks"
    : "months";
const UNIT_RE = String
  .raw`hours?|hrs?|horas?|days?|dias?|weeks?|wks?|semanas?|months?|meses|mes`;
const HALF_BEFORE = String.raw`(\s+and\s+a\s+half|\s+1\/2|\s*½)?`;
const HALF_AFTER = String.raw`(\s+and\s+a\s+half|\s+y\s+medi[ao])?`;
const SINGULAR: Record<Unit, string> = {
  hours: "hour",
  days: "day",
  weeks: "week",
  months: "month",
};
const durationValue = (n: number, unit: Unit) =>
  `${Number(n.toFixed(2))} ${n === 1 ? SINGULAR[unit] : unit}`;

/**
 * The time-to-complete pick a value names — "2 and a half weeks", "dos
 * semanas y media", "2 1/2 weeks" are 2.5 weeks (the half is kept), "2-3
 * days", "half a day", TBD. Stored in English like every term (the readers
 * localize it). Null when it names no duration.
 */
export function durationPick(text: string): TermPick | null {
  const s = fold(text);
  if (!s) return null;
  if (
    /\b(?:tbd|to be determined|not sure|por definir|por determinar)\b/.test(s)
  ) {
    return { stepId: "wraps", optionId: "tbd" };
  }
  const custom = (customValue: string): TermPick => ({
    stepId: "wraps",
    optionId: "custom",
    customValue,
  });
  const range = s.match(
    new RegExp(
      String.raw`\b(\d{1,2})\s*(?:-|–|to|a)\s*(\d{1,2})\s+(${UNIT_RE})\b`,
    ),
  );
  if (range) {
    return custom(`${range[1]}–${range[2]} ${unitOf(range[3])}`);
  }
  if (/\b(?:half a day|half day|medio dia)\b/.test(s)) {
    return custom("Half a day");
  }
  const re = new RegExp(
    String
      .raw`(?:\b(${NUM_RE})${HALF_BEFORE}\s+)?\b(${UNIT_RE})\b${HALF_AFTER}`,
    "g",
  );
  for (const m of s.matchAll(re)) {
    const half = m[2] || m[4] ? 0.5 : 0;
    const n = m[1] ? numberOf(m[1]) : half ? 1 : NaN;
    if (!Number.isFinite(n) || n <= 0) continue;
    return custom(durationValue(n + half, unitOf(m[3])));
  }
  return null;
}

/**
 * The payment pick a value names: a preset id ("50_50", "due_now"), or the
 * contractor's words read the way the wizard's own prefill reads them (REQ-
 * 265/387 — "50% deposit upfront, rest when done" is 50/50, a stated custom
 * schedule is the custom option). Null when it names no payment terms.
 */
export function paymentPick(text: string): TermPick | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  const id = s.toLowerCase().replace(/[\s-]+/g, "_");
  if (PAYMENT_TERMS_PRESETS.includes(id)) {
    return { stepId: "payment_terms", optionId: id };
  }
  const pt = extractPaymentTerms(s);
  if (!pt) return null;
  const pre = wizardPrefillFor("payment_terms", {
    customerName: null,
    customerPhone: null,
    customerEmail: null,
    startDate: null,
    duration: null,
    paymentTerms: pt,
  });
  if (!pre) return null;
  return {
    stepId: "payment_terms",
    optionId: pre.optionId,
    ...(pre.customValue ? { customValue: pre.customValue } : {}),
  };
}

const presetKey = (s: string) => fold(s).replace(/[–—]/g, "-");

/**
 * The pick as `step` takes it: an option the step has, and a custom value
 * that is one of the step's own presets ("2 weeks") is that preset. Null for
 * an option the step doesn't have or a custom option with no value.
 */
export function pickForStep(
  pick: TermPick,
  step: WizardStep,
): TermPick | null {
  if (pick.stepId !== step.id) return null;
  const option = step.options.find((o) => o.id === pick.optionId);
  if (!option) return null;
  if (!option.isCustom) return { stepId: step.id, optionId: option.id };
  const value = (pick.customValue ?? "").trim();
  if (!value) return null;
  const preset = step.options.find((o) =>
    !o.isCustom && presetKey(t("en", o.label)) === presetKey(value)
  );
  return preset
    ? { stepId: step.id, optionId: preset.id }
    : { stepId: step.id, optionId: option.id, customValue: value };
}

/** The update_terms payload's values as wizard picks, in wizard order, and
 *  the steps whose value could not be read. */
export function termsPicks(
  payload: { startDate?: string; duration?: string; paymentTerms?: string },
  today: Date = new Date(),
): { picks: TermPick[]; unread: TermStepId[] } {
  const picks: TermPick[] = [];
  const unread: TermStepId[] = [];
  const read: [
    TermStepId,
    string | undefined,
    (s: string) => TermPick | null,
  ][] = [
    ["start_date", payload.startDate, (s) => startPick(s, today)],
    ["wraps", payload.duration, durationPick],
    ["payment_terms", payload.paymentTerms, paymentPick],
  ];
  for (const [stepId, raw, read1] of read) {
    if (!raw?.trim()) continue;
    const pick = read1(raw);
    if (pick) picks.push(pick);
    else unread.push(stepId);
  }
  return { picks, unread };
}

const START_WORD = String
  .raw`\b(?:start(?:s|ing|ed)?|begin(?:s|ning)?|kick(?:s|ing)? off|empez\w*|empiez\w*|inici\w*|comienz\w*|comenz\w*|arranc\w*)\b`;
const DATE_WORD = String
  .raw`\b(?:next|this|coming|tomorrow|today|asap|right away|proxim\w*|que viene|manana|hoy|de inmediato|${WEEKDAY_RE}|${MONTH_RE})\b|\b\d{1,2}(?:st|nd|rd|th)?\b`;
const START_MENTION = new RegExp(
  String
    .raw`${START_WORD}[^.?!\n]{0,40}?(?:${DATE_WORD})|(?:${DATE_WORD})[^.?!\n]{0,30}?${START_WORD}`,
);
const DURATION_PHRASE = String
  .raw`(?:${NUM_RE})(?:\s+and\s+a\s+half|\s+1\/2)?\s+(?:hours?|days?|weeks?|months?|horas?|dias?|semanas?|mes(?:es)?)\b(?:\s+y\s+medi[ao])?`;
const DURATION_MENTION = new RegExp(
  [
    String
      .raw`\b(?:it'?s|it\s+is|takes?|taking|will\s+take|should\s+be|would\s+be|is|son|seran?|es\s+de|toma|tarda|dura|lleva)\s+(?:about\s+|like\s+|como\s+|unas?\s+)?\b${DURATION_PHRASE}`,
    String
      .raw`\b${DURATION_PHRASE}\s*,?\s*(?:not|no|instead|en\s+vez|en\s+lugar)\b`,
  ].join("|"),
);
const DURATION_WORD =
  /\b(?:time to complete|how long|duration|duracion|cuanto (?:dura|tarda|tiempo)|tiempo (?:de trabajo|para terminar))\b/;

/**
 * The terms a message asks to change — a start word with a day ("the start
 * should be next week", "empezamos la próxima semana", "we start monday nov
 * 23"), a time to complete stated as one ("its 2 and a half weeks not 2").
 * A line price, a labor sum ("3 guys x 3 weeks") or a job-details edit names
 * none.
 */
export function mentionedTerms(text: string): ("start_date" | "wraps")[] {
  const s = fold(text).replace(/[’`]/g, "'");
  const out: ("start_date" | "wraps")[] = [];
  if (START_MENTION.test(s)) out.push("start_date");
  if (
    DURATION_MENTION.test(s) ||
    (DURATION_WORD.test(s) && new RegExp(DURATION_PHRASE).test(s))
  ) {
    out.push("wraps");
  }
  return out;
}

/** "the start date" / "la fecha de inicio" — the term as a reply names it. */
function termName(lang: Lang, stepId: string): string {
  return (TERM_STEPS as readonly string[]).includes(stepId)
    ? t(lang, `chatCoordinator.terms.name.${stepId}`)
    : t(lang, "chatCoordinator.terms.name.other");
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ES_UNITS: [RegExp, string][] = [
  [/\bhours\b/gi, "horas"],
  [/\bhour\b/gi, "hora"],
  [/\bdays\b/gi, "días"],
  [/\bday\b/gi, "día"],
  [/\bweeks\b/gi, "semanas"],
  [/\bweek\b/gi, "semana"],
  [/\bmonths\b/gi, "meses"],
  [/\bmonth\b/gi, "mes"],
];

/** A custom term value as the contractor reads it: a picked day in their
 *  language ("23 nov 2026"), a duration's units in Spanish ("2.5 semanas"). */
export function termValueText(value: string, lang: Lang): string {
  const v = (value ?? "").trim();
  const dated = formatTermDate(v, lang);
  if (dated !== v || lang !== "es") return dated;
  if (v === "Half a day") return t(lang, "termsWizard.wraps.halfDay");
  return ES_UNITS.reduce((s, [re, es]) => s.replace(re, es), v);
}

/** A step's value as the wizard shows it: the preset's label, else the
 *  custom value. */
export function stepValueText(
  lang: Lang,
  step: WizardStep,
  value: TermValue,
): string {
  const option = step.options.find((o) => o.id === value.optionId);
  if (option && !option.isCustom) return t(lang, option.label);
  return termValueText(value.customValue ?? "", lang);
}

/** What happened to one term the contractor gave in the chat. */
export interface TermsOutcome {
  kind: "answered" | "changed" | "same" | "later" | "sent" | "signed";
  step: WizardStep;
  /** the value it had (changed / sent) */
  from?: TermValue;
  to: TermValue;
  /** later: the preset is pre-selected for when the wizard gets there */
  prefilled?: boolean;
}

/** The reply line for one term, in the contractor's language. */
export function termsChangeLine(lang: Lang, o: TermsOutcome): string {
  const term = termName(lang, o.step.id);
  const value = stepValueText(lang, o.step, o.to);
  switch (o.kind) {
    case "answered":
      return t(lang, "chatCoordinator.terms.answered", { term, value });
    case "changed":
      return t(lang, "chatCoordinator.terms.changed", {
        term,
        from: o.from ? stepValueText(lang, o.step, o.from) : "—",
        to: value,
      });
    case "same":
      return t(lang, "chatCoordinator.terms.same", {
        term: capitalize(term),
        value,
      });
    case "later":
      return o.prefilled
        ? t(lang, "chatCoordinator.terms.later", { term, value })
        : t(lang, "chatCoordinator.terms.laterCustom", {
          term: capitalize(term),
          value,
        });
    case "sent":
      return t(lang, "chatCoordinator.terms.sent", {
        term,
        value: o.from ? stepValueText(lang, o.step, o.from) : value,
      });
    case "signed":
      return t(lang, "chatCoordinator.terms.signed", { term });
  }
}

/** "I didn't change the start date or the time to complete — …" for the
 *  terms a message asked for that no tool changed; "" for none. */
export function termsNotAppliedLine(
  lang: Lang,
  stepIds: readonly string[],
): string {
  if (!stepIds.length) return "";
  const names = stepIds.map((id) => termName(lang, id));
  const terms = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") +
    ` ${t(lang, "chatCoordinator.terms.notApplied.or")} ` +
    names[names.length - 1];
  return t(lang, "chatCoordinator.terms.notApplied", { terms });
}

// ---------------------------------------------------------------------------
// REQ-653 (demo-loop cycle 5, m50) — a deadline is schedule, not scope. Pair 7
// typed "client wants done before thanksgiving"; it became the bullet "Finish
// before Thanksgiving" next to start "Right away" + "3 weeks" (ends Dec 3),
// and "its NOT done before thanksgiving if we start now + 3 wks, fix that"
// got "I didn't change the start date — ask me again" (fleet-6 stdout:207).
// ---------------------------------------------------------------------------

/** The day a job must be done: `before` it (the day itself is too late) or
 *  `by` it (the day itself is fine). */
export interface Deadline {
  iso: string;
  before: boolean;
}

const DL_FINISH = String
  .raw`(?:finish(?:ed)?|done|complete(?:d)?|wrap(?:ped)? up|ready|terminad[oa]s?|terminar(?:lo)?|termina(?:mos|do)?|listos?|listas?|acabad[oa]s?|acabar(?:lo)?|entregad[oa]s?|entregar(?:lo)?|completad[oa]s?|completar(?:lo)?)`;
const DL_PREP = String
  .raw`(before|by|prior to|no later than|ahead of|in time for|antes de(?:l)?|para(?: el| la)?|a mas tardar(?: el| para)?)`;
const DEADLINE_ASK = new RegExp(
  String
    .raw`\b${DL_FINISH}\s+(?:it\s+|lo\s+)?${DL_PREP}\s+(?:the\s+|el\s+|la\s+)?([^.?!\n]{1,60})|\b(?:deadline|fecha limite|plazo)\s*(?::|is|es|of|de)?\s*(?:the\s+|el\s+|la\s+)?([^.?!\n]{1,60})`,
);
const BEFORE_PREP = /^(?:before|prior to|ahead of|in time for|antes de)/;

/** US Thanksgiving: the fourth Thursday of November. */
function thanksgiving(year: number): Date {
  const first = new Date(year, 10, 1);
  const toThu = (4 - first.getDay() + 7) % 7;
  return new Date(year, 10, 1 + toThu + 21);
}

/** The next time a yearly day comes round (today counts). */
function nextYearly(today: Date, at: (year: number) => Date): string {
  const start = dayOf(today);
  let d = at(start.getFullYear());
  if (d < start) d = at(start.getFullYear() + 1);
  return isoOf(d);
}

const HOLIDAYS: [RegExp, (y: number) => Date][] = [
  [/\b(?:thanksgiving|(?:dia de )?accion de gracias)\b/, thanksgiving],
  [/\b(?:christmas eve|nochebuena)\b/, (y) => new Date(y, 11, 24)],
  [/\b(?:christmas|xmas|navidad)\b/, (y) => new Date(y, 11, 25)],
  [
    /\b(?:new year'?s? eve|fin de ano)\b/,
    (y) => new Date(y, 11, 31),
  ],
  [/\b(?:new year'?s?(?: day)?|ano nuevo)\b/, (y) => new Date(y + 1, 0, 1)],
  [/\b(?:(?:the )?end of (?:the )?year)\b/, (y) => new Date(y, 11, 31)],
];

/** The day a deadline's words name: a holiday, a date, the end of the month,
 *  a weekday. Null when they name none ("by hand"). */
function deadlineDay(words: string, today: Date): string | null {
  const s = words.trim();
  for (const [re, at] of HOLIDAYS) {
    if (re.test(s)) return nextYearly(today, at);
  }
  if (/\b(?:end of (?:the )?month|fin de(?:l)? mes)\b/.test(s)) {
    const t0 = dayOf(today);
    return isoOf(new Date(t0.getFullYear(), t0.getMonth() + 1, 0));
  }
  const date = explicitDate(s, today);
  if (date) return date;
  const w = s.match(new RegExp(String.raw`\b(${WEEKDAY_RE})\b`));
  if (w) {
    const start = dayOf(today);
    const ahead = ((WEEKDAYS[w[1]] - start.getDay()) + 7) % 7 || 7;
    return isoOf(plusDays(start, ahead));
  }
  return null;
}

/**
 * The deadline a message names — "done before thanksgiving", "terminar antes
 * de Acción de Gracias", "finished by Dec 5", "listo para el 20 de
 * noviembre", "deadline: Christmas" — read against `today` (a day already gone
 * this year is next year's). `bare`: the text is only the deadline (the
 * update_terms finishBy value: "Thanksgiving", "2026-12-01"). Null when there
 * is none.
 */
export function readDeadline(
  text: string,
  today: Date = new Date(),
  bare = false,
): Deadline | null {
  const s = fold(text).replace(/[’`]/g, "'");
  if (!s) return null;
  const m = DEADLINE_ASK.exec(s);
  if (m) {
    const prep = m[1] ?? "";
    // the day comes first after the "before" word — at most four words
    const words = (m[2] ?? m[3] ?? "").split(/\s+|,/).filter(Boolean)
      .slice(0, 4).join(" ");
    const iso = deadlineDay(words, today);
    if (iso) return { iso, before: BEFORE_PREP.test(prep) };
  }
  if (!bare) return null;
  const prep = s.match(new RegExp(String.raw`^${DL_PREP}\s+`));
  const iso = deadlineDay(prep ? s.slice(prep[0].length) : s, today);
  return iso ? { iso, before: !!prep && BEFORE_PREP.test(prep[1]) } : null;
}

/** A term on the quote, as it is stored. */
type StoredTerm = { stepId: string; value: string };

/**
 * When the job ends — start + time to complete, the same reading the billing
 * schedule uses — and whether that misses the deadline. Null when the terms
 * hold no time to complete (none, TBD) to check.
 */
export function deadlineCheck(
  deadline: Deadline,
  input: {
    terms?: readonly StoredTerm[] | null;
    startDate?: string;
    today: Date;
  },
): { end: string; late: boolean } | null {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  // completionFromTerms counts in UTC days; give it today's calendar day
  const t0 = dayOf(input.today);
  const end = completionFromTerms({
    terms: input.terms ?? [],
    startDate: input.startDate,
    today: new Date(
      `${t0.getFullYear()}-${pad2(t0.getMonth() + 1)}-${
        pad2(t0.getDate())
      }T00:00:00Z`,
    ),
  });
  if (!end) return null;
  const late = deadline.before ? end >= deadline.iso : end > deadline.iso;
  return { end, late };
}

/** A stored term in the reader's language: a preset's label ("Right away" →
 *  "De inmediato"), else the custom value (a date, "3 semanas"). */
function storedTermText(lang: Lang, stepId: string, value: string): string {
  for (const spec of [TERMS_WIZARD_V1, TERMS_WIZARD_SERVICE_V1]) {
    const step = spec.steps.find((s) => s.id === stepId);
    const option = step?.options.find((o) =>
      !o.isCustom && presetKey(t("en", o.label)) === presetKey(value)
    );
    if (option) return t(lang, option.label);
  }
  return termValueText(value, lang);
}

/**
 * The reply line: the schedule misses the deadline (and what to change), or
 * it makes it. "" when the terms hold no start or time to complete.
 */
export function deadlineLine(
  lang: Lang,
  deadline: Deadline,
  check: { end: string; late: boolean },
  terms: readonly StoredTerm[],
): string {
  const value = (id: string) => terms.find((x) => x.stepId === id)?.value;
  const start = value("start_date");
  const duration = value("wraps") ?? value("time_to_complete");
  if (!duration) return "";
  const vars = {
    start: start
      ? storedTermText(lang, "start_date", start)
      : t(lang, "chatCoordinator.terms.deadline.today"),
    duration: storedTermText(lang, "wraps", duration),
    end: formatTermDate(check.end, lang),
    deadline: t(
      lang,
      deadline.before
        ? "chatCoordinator.terms.deadline.before"
        : "chatCoordinator.terms.deadline.by",
      { date: formatTermDate(deadline.iso, lang) },
    ),
  };
  return t(
    lang,
    check.late
      ? "chatCoordinator.terms.deadline.late"
      : "chatCoordinator.terms.deadline.fits",
    vars,
  );
}
