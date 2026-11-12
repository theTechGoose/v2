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
  { type: "update_job_details" | "change_order" | "revise_quote" }
>;

const EDIT_TOOLS: ReadonlySet<LLMToolName> = new Set([
  "update_job_details",
  "change_order",
  "revise_quote",
]);

const TOOLS: ReadonlySet<string> = new Set<LLMToolName>([
  "create_quote",
  "lock_quote",
  "request_terms_transition",
  "change_order",
  "revise_quote",
  "update_job_details",
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

/**
 * Which of the model's calls run. Two or more changes to the quote
 * (update_job_details / change_order / revise_quote) all run, the job details
 * first. A mix with a create / lock / terms call runs only the first call (as
 * before) and names the others, each tool once; the same tool as the one that
 * ran is not reported.
 */
export function planToolCalls(calls: readonly LLMAction[]): ToolCallPlan {
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

export interface JobDetailsChange {
  /** The job details before, in the reply's language. */
  before: string;
  /** … and after. */
  after: string;
  /** The languages whose text changed — named in the line; omitted (the
   *  price step's details on screen) → no languages named. */
  langs?: readonly string[];
}

/**
 * The reply over a job-details change, built from what changed: "Updated the
 * job details (English, Spanish): added Plumbing permit; removed Old line." —
 * only the languages when no line of the reply's language moved, and "already
 * say that" when nothing did. Never a bare "Done".
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
  const changes = [
    added.length
      ? t(lang, "chatCoordinator.jobDetails.added", { items: added.join(", ") })
      : "",
    removed.length
      ? t(lang, "chatCoordinator.jobDetails.removed", {
        items: removed.join(", "),
      })
      : "",
  ].filter(Boolean);
  if (changes.length) {
    return t(lang, "chatCoordinator.jobDetails.changed", {
      langs,
      changes: changes.join("; "),
    });
  }
  if (named.length || lineKey(change.before) !== lineKey(change.after)) {
    return t(lang, "chatCoordinator.jobDetails.reworded", { langs });
  }
  return t(lang, "chatCoordinator.jobDetails.same");
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
  return {
    before,
    after: byLang[lang]?.trim() || before,
    langs: (["en", "es"] as const).filter((l) => changed.has(l)),
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
