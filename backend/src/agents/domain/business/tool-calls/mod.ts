/**
 * REQ-444 (demo-loop cycle 3, M21) — the pure rules behind a chat turn in
 * which the model made several tool calls, and the reply lines built from
 * what a change actually did.
 *
 * On Ready to send pair 7 asked, in one message, to fix the Spanish job
 * details AND "add a plumbing permit line $450". OpenAILLMClient kept only the
 * model's first call, the update_job_details branch answered "Done — the job
 * details on the quote are updated." whatever had changed, and the total
 * stayed $20,000.
 *
 *   toolCallsOf        — every call the model made (else its one action)
 *   planToolCalls      — which run: several changes to the quote all run, the
 *                        job details first; a mix that can't all run keeps
 *                        the first call and names the rest
 *   notDoneLine        — "I didn't lock the quote yet — ask me again …"
 *   jobDetailsChangeLine — "Updated the job details (English, Spanish):
 *                        added Plumbing permit." (jobDetailsChangeOf reads
 *                        the change off the quote; sameJobDetails compares)
 *   totalMoveLine / pricesSameLine / workingTotalCents — the total's move, or
 *                        that no price changed
 *
 * REQ-585 (demo-loop cycle 4, M4 + M30): an update_job_details that rides
 * along with a create_quote is folded into the create (pair 6's correct draft
 * sat under "Todavía no pude actualizar los detalles del trabajo…"); a long
 * line or a replaced one-line body is never echoed (pair 7's whole message,
 * twice); `proseAnswer` keeps the model's answer beside the outcome lines;
 * update_terms is a change like the others.
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import type {
  LLMAction,
  LLMResponse,
  LLMToolName,
} from "@agents/domain/business/llm/base/mod.ts";

/** A change to the bound quote that can run beside others in one turn. */
export type EditAction = Extract<
  LLMAction,
  {
    type:
      | "update_job_details"
      | "change_order"
      | "revise_quote"
      | "update_terms"; // REQ-585
  }
>;

const EDIT_TOOLS: ReadonlySet<LLMToolName> = new Set([
  "update_job_details",
  "change_order",
  "revise_quote",
  "update_terms", // REQ-585
]);

const TOOLS: ReadonlySet<string> = new Set<LLMToolName>([
  "create_quote",
  "lock_quote",
  "request_terms_transition",
  "change_order",
  "revise_quote",
  "update_job_details",
  "send_invoice", // REQ-583
  "record_payment", // REQ-583
  "update_terms", // REQ-585
]);

export function isEditAction(a: LLMAction): a is EditAction {
  return EDIT_TOOLS.has(a.type);
}

/** Every tool call the model made this turn, in its order; a response that
 *  carries only `action` (a fast path, a stub) is that one call. */
export function toolCallsOf(res: LLMResponse): LLMAction[] {
  if (res.actions && res.actions.length > 0) return [...res.actions];
  return res.action ? [res.action] : [];
}

export interface ToolCallPlan {
  /** Several changes to the quote: all run, in this order — the job details
   *  first, then each line change as the model made them. */
  edits?: EditAction[];
  /** One call — or the first of a mix that can't all run: the single-action
   *  path, as before. */
  single?: LLMAction;
  /** Tools that did NOT run this turn; the reply says so. */
  notDone: LLMToolName[];
}

type CreateAction = Extract<LLMAction, { type: "create_quote" }>;

/**
 * REQ-585 (demo-loop cycle 4, M4): the job details the model wrote beside a
 * create_quote ("Quote para Carmen Ruiz … Ella habla español" → create_quote
 * + update_job_details) belong to the draft it creates — folded into the
 * first create's `descriptionByLang` (merged per language, the later call
 * winning), never a separate call that could not run.
 */
function foldJobDetailsIntoCreate(calls: readonly LLMAction[]): LLMAction[] {
  const create = calls.find((a): a is CreateAction =>
    a.type === "create_quote"
  );
  const details = calls.filter((a) => a.type === "update_job_details");
  if (!create || details.length === 0) return [...calls];
  const byLang: Partial<Record<"en" | "es", string>> = {
    ...(create.payload.descriptionByLang ?? {}),
  };
  for (const d of details) {
    if (d.type !== "update_job_details") continue;
    for (const [l, v] of Object.entries(d.payload.descriptionByLang)) {
      if (v?.trim()) byLang[l as "en" | "es"] = v;
    }
  }
  const folded: CreateAction = {
    type: "create_quote",
    payload: { ...create.payload, descriptionByLang: byLang },
  };
  return calls
    .filter((a) => a.type !== "update_job_details")
    .map((a) => a === create ? folded : a);
}

/**
 * Which of the model's calls run. Two or more changes to the quote
 * (update_job_details / change_order / revise_quote / update_terms) all run,
 * the job details first. The job details beside a create_quote are part of
 * that create (REQ-585). A mix with a create / lock / terms call runs only the
 * first call (as before) and names the others, each tool once; the same tool
 * as the one that ran is not reported.
 */
export function planToolCalls(all: readonly LLMAction[]): ToolCallPlan {
  const calls = foldJobDetailsIntoCreate(all);
  if (calls.length === 0) return { notDone: [] };
  if (calls.length === 1) return { single: calls[0], notDone: [] };
  if (calls.every(isEditAction)) {
    const edits = calls as readonly EditAction[];
    return {
      edits: [
        ...edits.filter((a) => a.type === "update_job_details"),
        ...edits.filter((a) => a.type !== "update_job_details"),
      ],
      notDone: [],
    };
  }
  const [first, ...rest] = calls;
  const notDone: LLMToolName[] = [];
  for (const a of rest) {
    if (a.type !== first.type && !notDone.includes(a.type)) {
      notDone.push(a.type);
    }
  }
  return { single: first, notDone };
}

/** "I didn't lock the quote yet — ask me again for that part." — what this
 *  turn did not do, in the contractor's language; "" when nothing. */
export function notDoneLine(lang: Lang, tools: readonly string[]): string {
  const names = [...new Set(tools)]
    .filter((n) => TOOLS.has(n))
    .map((n) => t(lang, `chatCoordinator.tool.${n}`));
  if (names.length === 0) return "";
  const what = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} ${
      t(lang, "chatCoordinator.notDone.and")
    } ${names[names.length - 1]}`;
  return t(lang, "chatCoordinator.notDone", { what });
}

const lineKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const linesOf = (s: string) =>
  (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

/** REQ-585 (M30): a job-details line longer than this is never echoed in a
 *  reply — pair 7's one-line raw message came back whole, twice. */
const ECHO_MAX = 80;

/** A line as the reply names it: no closing period ("…del piso.." came back
 *  doubled once the template added its own). */
const asItem = (l: string) => l.replace(/[\s.;:,]+$/u, "");

export interface JobDetailsChange {
  /** The job details before, in the reply's language. */
  before: string;
  /** … and after. */
  after: string;
  /** The languages whose text changed — named in the line; omitted (the
   *  price step's details on screen) → no languages named. */
  langs?: readonly string[];
  /** REQ-654 (cycle 5, M10): the OTHER languages the update carried that
   *  the quote already has, word for word — the reply says where they are. */
  already?: readonly string[];
}

/**
 * The reply over a job-details change, built from what changed: "Updated the
 * job details (English, Spanish): added Plumbing permit; removed Old line." —
 * only the languages when no line of the reply's language moved, and "already
 * say that" when nothing did. Never a bare "Done".
 *
 * REQ-585 (M30): a changed line longer than ECHO_MAX, or a one-line body that
 * was replaced, is never echoed — the reply says the job details were
 * reworded (with their languages) instead.
 */
export function jobDetailsChangeLine(
  lang: Lang,
  change: JobDetailsChange,
): string {
  const before = linesOf(change.before);
  const after = linesOf(change.after);
  const had = new Set(before.map(lineKey));
  const has = new Set(after.map(lineKey));
  const added = after.filter((l) => !had.has(lineKey(l)));
  const removed = before.filter((l) => !has.has(lineKey(l)));
  const named = (change.langs ?? []).filter((l) => l === "en" || l === "es");
  const langs = named.length
    ? ` (${
      named.map((l) => t(lang, `chatCoordinator.jobDetails.lang.${l}`)).join(
        ", ",
      )
    })`
    : "";
  const echoed = [...added, ...removed];
  const reworded = echoed.some((l) => l.length > ECHO_MAX) ||
    (removed.length > 0 && before.length === 1);
  const changes = reworded ? [] : [
    added.length
      ? t(lang, "chatCoordinator.jobDetails.added", {
        items: added.map(asItem).join(", "),
      })
      : "",
    removed.length
      ? t(lang, "chatCoordinator.jobDetails.removed", {
        items: removed.map(asItem).join(", "),
      })
      : "",
  ].filter(Boolean);
  if (changes.length) {
    return t(lang, "chatCoordinator.jobDetails.changed", {
      langs,
      changes: changes.join("; "),
    });
  }
  if (
    echoed.length || named.length ||
    lineKey(change.before) !== lineKey(change.after)
  ) {
    return t(lang, "chatCoordinator.jobDetails.reworded", { langs });
  }
  // REQ-654 (demo-loop cycle 5, M10, pair 7): "put the job details in
  // spanish on the agreement too" when they already are — say where to see
  // them, never a bare "already say that".
  const other = (change.already ?? []).find((l) =>
    l !== lang && (l === "en" || l === "es")
  );
  if (other) {
    return t(lang, "chatCoordinator.jobDetails.alreadyIn", {
      lang: t(lang, `chatCoordinator.jobDetails.lang.${other}`),
      toggle: t(lang, `asstChat.previewLang.${other}`),
    });
  }
  return t(lang, "chatCoordinator.jobDetails.same");
}

/** A sentence of the model's prose that claims a change ("Done — I updated
 *  the start date…", "Listo, actualicé…", "I've added the permit") — the
 *  outcome lines already say what changed, from what actually did. */
const WORD_END = String.raw`(?![\p{L}\d])`;
const CLAIMS = [
  String.raw`done`,
  String.raw`all\s+set`,
  String.raw`listo`,
  String.raw`hecho`,
  String
    .raw`(?:i(?:['’]ve|\s+have)?|we(?:['’]ve|\s+have)?)\s+(?:just\s+|also\s+|now\s+)?(?:updated|changed|added|removed|set|made|fixed|switched|translated|rewrote|reworded|replaced|dropped|took|put|moved|adjusted|included|deleted|marked|noted|recorded|saved|applied|corrected|edited|revised|re-?priced)`,
  String
    .raw`(?:updated|changed|added|removed|switched|translated|reworded|replaced|dropped|adjusted|deleted|corrected|revised|set)\s+(?:the|your|it|that|this|a|an|them|both)`,
  String
    .raw`(?:the|your)\s+(?:quote|job\s+details|details|start(?:\s+date)?|date|terms|line|lines|total|price)\s+(?:has|have|is|are)\s+(?:now\s+)?(?:been\s+)?(?:updated|changed|set|added|removed|fixed)`,
  String
    .raw`(?:it['’]?s|it\s+is|that['’]?s|that\s+is)\s+(?:now\s+)?(?:updated|done|changed|set|fixed)`,
  String
    .raw`ya\s+(?:est[aá]|qued[oó]|lo|la|los|las|cambi[eé]|actualic[eé]|agregu[eé]|a[ñn]ad[ií]|quit[eé])`,
  String
    .raw`(?:actualic[eé]|cambi[eé]|agregu[eé]|a[ñn]ad[ií]|quit[eé]|elimin[eé]|puse|ajust[eé]|traduje|correg[ií]|reemplac[eé]|marqu[eé]|fij[eé]|anot[eé]|guard[eé]|modifiqu[eé])`,
  String
    .raw`(?:se|la|lo|las|los)\s+(?:actualiz[oó]|cambi[oó]|agreg[oó]|a[ñn]adi[oó]|quit[oó]|elimin[oó])`,
];
const CLAIM_RE = new RegExp(
  String
    .raw`^(?:(?:sure|ok(?:ay)?|got\s+it|great|perfect|claro|perfecto|vale|bueno)${WORD_END}[\s,!.:—–-]*)?(?:${
    CLAIMS.join("|")
  })${WORD_END}`,
  "iu",
);

/**
 * REQ-585 (demo-loop cycle 4, M4): the model's prose beside its edit calls,
 * as the reply keeps it — the answer to what the contractor asked ("is 50%
 * normal in texas?"), minus every sentence that claims a change, since the
 * outcome lines built from what actually changed say that. "" when nothing
 * but claims is left.
 */
export function proseAnswer(text: string): string {
  return (text ?? "")
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s && !CLAIM_RE.test(s))
    .join(" ")
    .trim();
}

interface DetailsLike {
  description?: string;
  descriptionByLang?: Record<string, string>;
}

/** A quote's job details in a language: that language's copy, else the base
 *  text. */
function detailsIn(q: DetailsLike, lang: string): string {
  return q.descriptionByLang?.[lang]?.trim() || q.description?.trim() || "";
}

/** Two job-details texts carry the same lines (whitespace and case aside). */
export function sameJobDetails(a: string, b: string): boolean {
  const x = linesOf(a).map(lineKey);
  const y = linesOf(b).map(lineKey);
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

/** What an update_job_details did to a quote: the reply language's job
 *  details before and after, and the languages whose text changed. */
export function jobDetailsChangeOf(
  lang: Lang,
  current: DetailsLike,
  byLang: Partial<Record<string, string>>,
): JobDetailsChange {
  const changed = new Set(
    Object.entries(byLang)
      .filter(([l, v]) =>
        !!v?.trim() && !sameJobDetails(v, detailsIn(current, l))
      )
      .map(([l]) => l),
  );
  const before = detailsIn(current, lang);
  // REQ-654: languages sent unchanged that the quote really has its own
  // copy of (never the base text standing in for a missing translation)
  const already = (["en", "es"] as const).filter((l) =>
    l !== lang && !!byLang[l]?.trim() && !changed.has(l) &&
    !!current.descriptionByLang?.[l]?.trim()
  );
  return {
    before,
    after: byLang[lang]?.trim() || before,
    langs: (["en", "es"] as const).filter((l) => changed.has(l)),
    ...(already.length ? { already } : {}),
  };
}

/** "$20,450.00" — the quote's money, as the change-order replies write it. */
export function quoteMoney(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** "Total $20,000.00 → $20,450.00." — "" when the total did not move. */
export function totalMoveLine(lang: Lang, from: number, to: number): string {
  if (from === to) return "";
  return t(lang, "chatCoordinator.revision.total", {
    from: quoteMoney(from),
    to: quoteMoney(to),
  });
}

/** "No price changed — the total is still $20,000.00. …" — for a change
 *  that moved no price on a message that named an amount. */
export function pricesSameLine(lang: Lang, total: number): string {
  return t(lang, "chatCoordinator.jobDetails.pricesSame", {
    total: quoteMoney(total),
  });
}

interface TotalLike {
  estimatedTotal?: number;
  lineItems?: { price?: number; quantity?: number }[];
  pendingRevision?: Record<string, unknown>;
}

function sumLines(lines: readonly { price?: number; quantity?: number }[]) {
  return lines.reduce((s, l) => s + (l.price ?? 0) * (l.quantity ?? 1), 0);
}

/** The total the contractor is working on: the pending revision's when one
 *  is waiting (a sent quote's changes land there), else the quote's. */
export function workingTotalCents(q: TotalLike): number {
  const pending = q.pendingRevision;
  if (pending) {
    if (typeof pending.estimatedTotal === "number") {
      return pending.estimatedTotal;
    }
    if (Array.isArray(pending.lineItems)) {
      return sumLines(
        pending.lineItems as { price?: number; quantity?: number }[],
      );
    }
  }
  if (typeof q.estimatedTotal === "number") return q.estimatedTotal;
  return sumLines(q.lineItems ?? []);
}
