/**
 * Shared presentational parts for the public customer documents — the signed
 * agreement (/c/:id, contract-doc.tsx) and the invoice (/i/:id).
 *
 * Extracted from contract-doc.tsx so the invoice can mirror the agreement's
 * layout — business header, party cards, itemized job details, payment
 * schedule, term grid — WITHOUT duplicating markup (which would immediately
 * drift). The agreement keeps its 14 legal clauses + signature block locally
 * in contract-doc.tsx; the invoice composes these parts plus its own
 * amount-due / pay-now flow (and drops clauses + signature). See the invoice
 * feature brief: "all the information as the agreement, minus the 1–14 Terms
 * clauses and the signature block."
 */
import {
  computePaymentSplit,
  type MilestoneRole,
} from "../lib/payment-split.ts";
import {
  detailLines,
  fmtMoneyExact,
  fmtPhone,
  telHref,
} from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import { localizeTermValue } from "../lib/term-i18n.ts";
import { formatLongDate } from "../../shared/quote-flow/format-helpers.ts";

/* ---------- palette ---------- */
export const PINK = "#FF6B6B";
export const PINK_DARK = "#d94e4e";
export const TEAL = "#144852";
export const GREEN = "#519843";
export const INK = "#1c2c30";
export const MUTED = "#6b7a7e";
export const LINE = "#e3e8e6";
export const CREAM = "#fffdf7";
export const BG = "#f7f6f1";

/* ---------- shapes ---------- */
export interface DocContractor {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  addressLine?: string;
  state?: string;
  /** Outgoing-comms language (roadmap p.13) — drives the document's copy. */
  commsLanguage?: string;
  /** True when the contractor uploaded a business logo. */
  hasLogo?: boolean;
}

export interface LineItem {
  description: string;
  price?: number;
  quantity?: number;
  unit?: string;
}

export interface Term {
  stepId: string;
  label: string;
  value: string;
}

/* ---------- US states (governing-law / state expansion) ---------- */
const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

export function expandStateName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const upper = code.trim().toUpperCase();
  return US_STATES[upper] ?? code;
}

/* ---------- primitives ---------- */
export function Pill(
  { bg, color, label }: { bg: string; color: string; label: string },
) {
  return (
    <span
      style={`background:${bg};color:${color};font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px;flex-shrink:0`}
    >
      {label}
    </span>
  );
}

/** One consistent section header across the whole document: a teal numbered
 *  badge + an uppercase letter-spaced title + a full-width hairline rule.
 *  The header owns the spacing below it, so section content sits flush
 *  under the rule (content margin-top:0). */
export function SectionHeader({ n, title }: { n: string; title: string }) {
  return (
    <div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:11px">
        <span
          style={`display:inline-flex;align-items:center;justify-content:center;width:25px;height:25px;border-radius:50%;background:${TEAL};color:#fff;font-weight:800;font-size:11px;flex-shrink:0;font-variant-numeric:tabular-nums`}
        >
          {n}
        </span>
        <div
          style={`font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:800;color:${TEAL};font-size:13px;letter-spacing:.14em;text-transform:uppercase`}
        >
          {title}
        </div>
      </div>
      <div style={`margin-top:12px;height:1px;background:${LINE}`} />
    </div>
  );
}

export function KV({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={`background:#fff;border:1px solid ${LINE};border-radius:12px;padding:12px 14px`}
    >
      <div
        style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
      >
        {k}
      </div>
      <div
        style={`margin-top:5px;color:${INK};font-weight:700;font-size:14px;line-height:1.35`}
      >
        {v}
      </div>
    </div>
  );
}

export function PartyCard(props: {
  role: string;
  name?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  address?: string;
}) {
  const displayName = props.name?.trim();
  const biz = props.businessName?.trim();
  return (
    <div
      style={`background:#fff;border:1px solid ${LINE};border-radius:12px;padding:14px 16px`}
    >
      <div
        style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
      >
        {props.role}
      </div>
      <div
        style={`margin-top:6px;color:${INK};font-weight:800;font-size:15px;line-height:1.25`}
      >
        {displayName ?? "—"}
      </div>
      {biz && biz !== displayName && (
        <div
          style={`margin-top:2px;color:${MUTED};font-size:12.5px;line-height:1.3`}
        >
          {biz}
        </div>
      )}
      {props.phone && (
        <div style={`margin-top:4px;font-size:12.5px;line-height:1.35`}>
          <a
            href={telHref(props.phone)}
            style={`color:${TEAL};text-decoration:none;font-weight:600;white-space:nowrap`}
          >
            {fmtPhone(props.phone)}
          </a>
        </div>
      )}
      {props.email && (
        <div style={`margin-top:2px;font-size:12.5px;line-height:1.35`}>
          <a
            href={`mailto:${props.email}`}
            style={`color:${TEAL};text-decoration:none;font-weight:600`}
          >
            {props.email}
          </a>
        </div>
      )}
      {props.address && (
        <div
          style={`margin-top:4px;color:${MUTED};font-size:12px;line-height:1.35`}
        >
          {props.address}
        </div>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */
export function sumLineTotals(items: LineItem[] | undefined): number {
  if (!items) return 0;
  return items.reduce((s, li) => s + (li.price ?? 0) * (li.quantity ?? 1), 0);
}

export function initialsFromName(name?: string): string {
  if (!name) return "PM";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0] ?? "PM").slice(0, 2).toUpperCase();
}

/**
 * Long date in the DOCUMENT's language. Delegates to the one shared
 * formatter so the web page, the PDF and the email can never drift — and so
 * a Spanish agreement stops printing "FIRMADO AUGUST 18, 2026".
 * `lang` defaults to English only so an un-migrated caller keeps its old
 * output; every customer-facing call site passes the document language.
 */
export function fmtDate(iso: string, lang: Lang = "en"): string {
  return formatLongDate(iso, lang);
}

export function termValue(
  terms: Term[] | undefined,
  stepId: string,
): string | undefined {
  return terms?.find((t) => t.stepId === stepId)?.value;
}

/** Expand wizard-shorthand answers into customer-readable sentences.
 *  E.g. "Use my business state" → "California". Localizes preset option
 *  labels and numeric durations; custom free-text passes through. Mirrors
 *  the backend PDF renderer. */
export function expandTermValue(
  term: Term,
  contractorState: string | undefined,
  lang: Lang = "en",
): string {
  const stateName = expandStateName(contractorState);
  if (term.stepId === "wraps") {
    const v = localizeTermValue(term.value, lang);
    return tFor(lang, "contractDoc.estimated", { value: v });
  }
  if (term.stepId === "governing_state") {
    if (/use my business|business state/i.test(term.value)) {
      if (!stateName) return term.value;
      return tFor(lang, "contractDoc.termValue.stateLaw", { state: stateName });
    }
    if (/job\s*site|use the job/i.test(term.value)) {
      return tFor(lang, "contractDoc.termValue.jobSiteState");
    }
    return expandStateName(term.value) ?? term.value;
  }
  if (term.stepId === "state_notices") {
    const v = term.value.trim().toLowerCase();
    if (v === "yes") {
      return stateName
        ? tFor(lang, "contractDoc.termValue.stateNoticesYesState", {
          state: stateName,
        })
        : tFor(lang, "contractDoc.termValue.stateNoticesYes");
    }
    if (v === "no") {
      return tFor(lang, "contractDoc.termValue.stateNoticesNo");
    }
    if (v.startsWith("review")) {
      return tFor(lang, "contractDoc.termValue.stateNoticesReview");
    }
    return term.value;
  }
  return localizeTermValue(term.value, lang);
}

/** Hide warranty term row when the contractor selected "No warranty" — the
 *  legal-text warranty clause still applies on the agreement. */
export function isEmptyWarranty(term: Term): boolean {
  if (term.stepId !== "warranty") return false;
  const v = term.value.trim().toLowerCase();
  return v === "" || v === "no warranty" || v === "none" || v === "n/a" ||
    v === "no";
}

export function computeMilestones(
  total: number,
  terms: Term[] | undefined,
  lang: Lang = "en",
): { label: string; amount: number; when: string }[] {
  if (!total || total <= 0) return [];
  const L = {
    deposit: tFor(lang, "contractDoc.milestone.deposit"),
    balance: tFor(lang, "contractDoc.milestone.balance"),
    midpoint: tFor(lang, "contractDoc.milestone.midpoint"),
    final: tFor(lang, "contractDoc.milestone.final"),
    beforeStart: tFor(lang, "contractDoc.milestone.beforeStart"),
    onCompletion: tFor(lang, "contractDoc.milestone.onCompletion"),
    atMidpoint: tFor(lang, "contractDoc.milestone.atMidpoint"),
    onSigning: tFor(lang, "contractDoc.milestone.onSigning"),
  };
  const roleLabel: Record<MilestoneRole, { label: string; when: string }> = {
    deposit: { label: L.deposit, when: L.beforeStart },
    midpoint: { label: L.midpoint, when: L.atMidpoint },
    milestone: { label: L.midpoint, when: L.atMidpoint },
    completion: { label: L.balance, when: L.onCompletion },
    full: { label: L.final, when: L.onCompletion },
  };
  const term = termValue(terms, "payment_terms");
  const dueNow = /\bdue now\b/i.test(term ?? "");
  return computePaymentSplit(term, total).map((p) => ({
    ...roleLabel[p.role],
    ...(dueNow && p.role === "full" ? { when: L.onSigning } : {}),
    amount: p.amountCents,
  }));
}

/* ---------- section: job details + line items + total card ---------- */
/** The "Job details" section shared by the agreement and the invoice:
 *  description bullets, a line-item table (only when >1 item), and the
 *  gradient total card. Gate the call site with `items.length > 0` (a single
 *  line just repeats the total card). */
export function JobDetailsSection(props: {
  n: string;
  title: string;
  description?: string;
  items: LineItem[];
  total: number;
  /** Render the DESCRIPTION/AMOUNT table even for a single line item.
   *  The agreement (deck p12) always carries the line-item table; the
   *  invoice keeps the >1 gate (a single line just repeats the total). */
  forceTable?: boolean;
  labels: {
    tableDescription: string;
    tableQty: string;
    tableAmount: string;
    unitEach: string;
    valueLabel: string;
    valueSub: string;
  };
}) {
  const { items, labels } = props;
  const showQty = items.some((li) => (li.quantity ?? 1) > 1);
  const lines = detailLines(props.description);
  return (
    <section style="margin-top:36px">
      <SectionHeader n={props.n} title={props.title} />
      {lines.length === 0 ? null : lines.length > 1
        ? (
          <ul
            style={`margin:0;padding:0;list-style:none;color:${INK};font-size:15px;line-height:1.6`}
          >
            {lines.map((l, i) => (
              <li key={i} style="position:relative;padding:5px 0 5px 22px">
                <span
                  style={`position:absolute;left:2px;top:13px;width:6px;height:6px;border-radius:50%;background:${GREEN}`}
                >
                </span>
                {l}
              </li>
            ))}
          </ul>
        )
        : (
          <p
            style={`margin:0;color:${INK};font-size:15px;line-height:1.6;white-space:pre-wrap`}
          >
            {lines[0]}
          </p>
        )}
      {(items.length > 1 || (props.forceTable && items.length > 0)) && (
        <table style="width:100%;border-collapse:collapse;margin-top:14px">
          <thead>
            <tr>
              <th
                style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:left`}
              >
                {labels.tableDescription}
              </th>
              {showQty && (
                <th
                  style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:right`}
                >
                  {labels.tableQty}
                </th>
              )}
              <th
                style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:right`}
              >
                {labels.tableAmount}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((li, i) => {
              const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
              return (
                <tr key={i}>
                  <td
                    style={`padding:14px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;font-weight:600`}
                  >
                    {li.description}
                  </td>
                  {showQty && (
                    <td
                      style={`padding:14px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:13px;text-align:right`}
                    >
                      {li.quantity ?? 1} {li.unit ?? labels.unitEach}
                    </td>
                  )}
                  <td
                    style={`padding:14px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums`}
                  >
                    {fmtMoneyExact(lineTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div
        style={`margin-top:20px;background:linear-gradient(135deg,#e8f3e2 0%,#dceadb 100%);border:1px solid rgba(81,152,67,0.25);border-radius:16px;padding:22px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px`}
      >
        <div>
          <div
            style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}
          >
            {labels.valueLabel}
          </div>
          <div style={`margin-top:4px;color:${MUTED};font-size:12px`}>
            {labels.valueSub}
          </div>
        </div>
        <div
          class="ctr__total-amt"
          style={`font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:42px;letter-spacing:-0.03em;color:${TEAL};line-height:1;font-variant-numeric:tabular-nums`}
        >
          {fmtMoneyExact(props.total)}
        </div>
      </div>
    </section>
  );
}

/* ---------- section: payment schedule (milestones) ---------- */
export function PaymentScheduleSection(props: {
  n: string;
  title: string;
  milestones: { label: string; amount: number; when: string }[];
}) {
  if (props.milestones.length === 0) return null;
  return (
    <section style="margin-top:36px">
      <SectionHeader n={props.n} title={props.title} />
      <div
        class="ctr__milestones"
        style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px"
      >
        {props.milestones.map((m, i) => (
          <div
            key={i}
            style={`background:#fff;border:1px solid ${LINE};border-radius:14px;padding:14px 16px`}
          >
            <div
              style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
            >
              {m.label}
            </div>
            <div
              style={`margin-top:6px;color:${TEAL};font-weight:900;font-size:20px;font-variant-numeric:tabular-nums`}
            >
              {fmtMoneyExact(m.amount)}
            </div>
            <div style={`margin-top:2px;color:${MUTED};font-size:12px`}>
              {m.when}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- term grid (no legal clauses) ---------- */
export function hasTermGrid(
  p: { startDate?: string; estimatedCompletionDate?: string; terms?: Term[] },
): boolean {
  return !!(p.startDate || p.estimatedCompletionDate ||
    (p.terms && p.terms.length > 0));
}

/** The wizard-captured term grid (Start, Est. completion, payment, warranty).
 *  Used standalone by the invoice (no clauses) and as the top half of the
 *  agreement's Terms section. */
export function TermGrid(props: {
  startDate?: string;
  estimatedCompletionDate?: string;
  terms?: Term[];
  contractorState?: string;
  lang: Lang;
  /** Shown as the Start value when no startDate was captured (the agreement
   *  always shows a Start row — deck p12 Terms anatomy). Omit to hide the
   *  row entirely when startDate is absent (invoice behavior). */
  startFallback?: string;
  labels: {
    start: string;
    estCompletion: string;
    termLabels: Record<string, string>;
  };
}) {
  // Audit2 #24 — the agreement printed TWO contradictory start rows:
  // "INICIO / Por agendar" (this fallback) directly above "FECHA DE INICIO /
  // De inmediato" (the wizard's own start_date answer). Exactly one may
  // render: a concrete startDate wins outright, else the contractor's wizard
  // answer speaks for itself, and the "To be scheduled" placeholder only
  // fills in when there is neither (deck p12 keeps a Start row on every
  // agreement).
  const hasStartTerm = (props.terms ?? []).some(
    (t) => t.stepId === "start_date" && !!t.value,
  );
  const showStartFallback = !props.startDate && !!props.startFallback &&
    !hasStartTerm;
  return (
    <div
      class="ctr__terms-grid"
      style="display:grid;grid-template-columns:1fr 1fr;gap:12px"
    >
      {(props.startDate || showStartFallback) && (
        <KV
          k={props.labels.start}
          v={props.startDate
            ? fmtDate(props.startDate, props.lang)
            : props.startFallback!}
        />
      )}
      {props.estimatedCompletionDate && (
        <KV
          k={props.labels.estCompletion}
          v={fmtDate(props.estimatedCompletionDate, props.lang)}
        />
      )}
      {(props.terms ?? [])
        .filter((term) =>
          term.stepId !== "customer" && !isEmptyWarranty(term) &&
          // A concrete start date on the contract supersedes the coarse
          // wizard answer — never print both.
          !(term.stepId === "start_date" && !!props.startDate)
        )
        .map((term) => (
          <KV
            key={term.stepId}
            k={props.labels.termLabels[term.stepId] ?? term.label}
            v={expandTermValue(term, props.contractorState, props.lang)}
          />
        ))}
    </div>
  );
}
