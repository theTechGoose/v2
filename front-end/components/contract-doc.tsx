/**
 * Contract rendering for the public agreement page (/c/:id).
 *
 * Extracted from the route so a hydrating island (PublicContractView) can
 * fetch the contract client-side and paint a skeleton first, instead of
 * blocking SSR on the backend round-trip (which left the page blank-white
 * until the first byte). See problems.md #25.
 */
import PublicSignContract from "../islands/PublicSignContract.tsx";
import { computePaymentSplit, type MilestoneRole } from "../lib/payment-split.ts";
import {
  detailLines,
  fmtMoneyExact,
  fmtPhone,
  telHref,
} from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import { localizeTermValue } from "../lib/term-i18n.ts";

interface Contractor {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  addressLine?: string;
  state?: string;
  /** Outgoing-comms language (roadmap p.13) — drives this page's copy. */
  commsLanguage?: string;
}

/** Two-letter US state abbreviations → full names. Used to expand the
 *  "Use my business state" / "Yes" wizard answers into customer-readable
 *  sentences on the contract page. */
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

function expandStateName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const upper = code.trim().toUpperCase();
  return US_STATES[upper] ?? code;
}

interface LineItem {
  description: string;
  price?: number;
  quantity?: number;
  unit?: string;
}

interface Term {
  stepId: string;
  label: string;
  value: string;
}

export interface ContractPublic {
  id: string;
  quoteId?: string;
  customerId?: string;
  status?: string;
  totalAmount?: number;
  effectiveDate?: string;
  startDate?: string;
  estimatedCompletionDate?: string;
  signedAt?: string;
  customerSignedName?: string;
  contractor?: Contractor;
  customer?: { name?: string; phoneNumber?: string; email?: string };
  jobDetails?: {
    summary?: string;
    jobName?: string;
    description?: string;
    /** Per-language title/summary/description (keyed by lang code). When
     *  present, the doc renders these in its own language instead of the
     *  single-language fields above. */
    descriptionByLang?: Record<string, string>;
    jobNameByLang?: Record<string, string>;
    summaryByLang?: Record<string, string>;
    lineItems?: LineItem[];
  };
  terms?: Term[];
  createdAt?: string;
}

const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";
const TEAL = "#144852";
const GREEN = "#519843";
export const INK = "#1c2c30";
const MUTED = "#6b7a7e";
export const LINE = "#e3e8e6";
const CREAM = "#fffdf7";
export const BG = "#f7f6f1";

/** Roadmap p.13: the public contract is customer-facing, so it renders in
 *  the contractor's OUTGOING-COMMS language (default en). One table so the
 *  whole document flips together. */
function cstr(lang: Lang) {
  const clauseKeys = [
    "governingLaw",
    "jobDetails",
    "paymentTerms",
    "changeOrders",
    "customerResponsibilities",
    "delays",
    "warranty",
    "limitationOfLiability",
    "rightToStopWork",
    "termination",
    "disputeResolution",
    "permits",
    "indemnification",
    "entireAgreement",
  ];
  return {
    docTag: tFor(lang, "contractDoc.docTag"),
    signed: (d: string) => tFor(lang, "contractDoc.signed", { date: d }),
    declined: tFor(lang, "status.declined"),
    awaiting: tFor(lang, "contractDoc.awaiting"),
    between: tFor(lang, "contractDoc.between"),
    and: tFor(lang, "contractDoc.and"),
    effective: tFor(lang, "contractDoc.effective"),
    to: tFor(lang, "contractDoc.to"),
    from: tFor(lang, "contractDoc.from"),
    jobDetails: tFor(lang, "contractDoc.jobDetails"),
    tableDescription: tFor(lang, "contractDoc.tableDescription"),
    tableQty: tFor(lang, "contractDoc.tableQty"),
    tableAmount: tFor(lang, "contractDoc.tableAmount"),
    unitEach: tFor(lang, "contractDoc.unitEach"),
    agreementValue: tFor(lang, "contractDoc.agreementValue"),
    allIn: tFor(lang, "contractDoc.allIn"),
    paymentSchedule: tFor(lang, "contractDoc.paymentSchedule"),
    terms: tFor(lang, "contractDoc.terms"),
    start: tFor(lang, "contractDoc.start"),
    estCompletion: tFor(lang, "contractDoc.estCompletion"),
    estimated: (v: string) => tFor(lang, "contractDoc.estimated", { value: v }),
    signHere: tFor(lang, "contractDoc.signHere"),
    bothCaptured: tFor(lang, "contractDoc.bothCaptured"),
    bySigning: (first?: string) =>
      first
        ? tFor(lang, "contractDoc.bySigningNamed", { name: first })
        : tFor(lang, "contractDoc.bySigning"),
    contractor: tFor(lang, "contractDoc.contractor"),
    by: tFor(lang, "contractDoc.by"),
    date: tFor(lang, "contractDoc.date"),
    today: tFor(lang, "contractDoc.today"),
    yourSignature: tFor(lang, "contractDoc.yourSignature"),
    signTypeBelow: tFor(lang, "contractDoc.signTypeBelow"),
    clientSignature: tFor(lang, "contractDoc.clientSignature"),
    signatureOf: (n: string) =>
      tFor(lang, "contractDoc.signatureOf", { name: n }),
    signedBinding: tFor(lang, "contractDoc.signedBinding"),
    signedNote: tFor(lang, "contractDoc.signedNote"),
    qBefore: tFor(lang, "contractDoc.qBefore"),
    callWord: tFor(lang, "contractDoc.callWord"),
    orWord: tFor(lang, "contractDoc.orWord"),
    emailWord: tFor(lang, "contractDoc.emailWord"),
    lookForward: tFor(lang, "contractDoc.lookForward"),
    poweredBy: tFor(lang, "contractDoc.poweredBy"),
    termLabels: {
      customer: tFor(lang, "contractDoc.termLabel.customer"),
      start_date: tFor(lang, "contractDoc.termLabel.startDate"),
      wraps: tFor(lang, "contractDoc.termLabel.wraps"),
      payment_terms: tFor(lang, "contractDoc.termLabel.paymentTerms"),
      warranty: tFor(lang, "contractDoc.termLabel.warranty"),
    } as Record<string, string>,
    clauses: clauseKeys.map((k) =>
      [
        tFor(lang, `contractDoc.clause.${k}.title`),
        tFor(lang, `contractDoc.clause.${k}.body`),
      ] as [string, string]
    ),
  };
}

export function ErrorCard(
  { message, lang = "en" }: { message: string; lang?: Lang },
) {
  return (
    <>
      <div
        style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN};text-align:center;margin-bottom:18px`}
      >
        {tFor(lang, "brand.name")}
      </div>
      <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center">
        <div style={`font-weight:800;color:${TEAL};font-size:18px`}>
          {tFor(lang, "contractDoc.cantOpen")}
        </div>
        <p style={`margin:8px 0 0;color:${MUTED};font-size:14px`}>{message}</p>
      </div>
    </>
  );
}

export function ContractDoc({ contract }: { contract: ContractPublic }) {
  const signed = contract.status === "signed";
  const declined = contract.status === "declined";
  const total = contract.totalAmount ??
    sumLineTotals(contract.jobDetails?.lineItems);
  const customerName = contract.customer?.name?.trim();
  const customerFirst = customerName?.split(/\s+/)[0];
  const contractor = contract.contractor;
  const es = contractor?.commsLanguage === "es";
  const lang: Lang = es ? "es" : "en";
  const t = cstr(lang);
  const businessLabel = contractor?.businessName?.trim() ||
    contractor?.name?.trim() || tFor(lang, "brand.name");
  const contractorName = contractor?.name?.trim();
  const senderInitials = initialsFromName(contractorName ?? businessLabel);

  const items = contract.jobDetails?.lineItems ?? [];
  const showQty = items.some((li) => (li.quantity ?? 1) > 1);
  // Title/summary in the document's language when the per-language fields are
  // present (populated from the picked job option); else the single value.
  const summary =
    (contract.jobDetails?.summaryByLang?.[lang] ??
      contract.jobDetails?.summary ?? tFor(lang, "contractDoc.serviceAgreement"))
      .replace(
        /^\s*quote\s*:\s*/i,
        "",
      ).trim();
  const jobNameRaw =
    (contract.jobDetails?.jobNameByLang?.[lang] ?? contract.jobDetails?.jobName)
      ?.trim();
  const heroTitle = (jobNameRaw && jobNameRaw.length > 0)
    ? jobNameRaw
    : summary.replace(/\b\w/g, (c) => c.toUpperCase());

  const effective = contract.effectiveDate ?? contract.createdAt;
  const milestones = computeMilestones(total, contract.terms, lang);

  // Sequential section numbers. Sections are conditionally rendered, so
  // hardcoding 01/02/03 leaves gaps (01,03,…) when one is absent — which
  // reads as a mistake. Each rendered SectionHeader pulls the next number
  // in source order via short-circuit eval, so the sequence is always
  // gapless regardless of which optional sections appear.
  let sec = 0;
  const num = () => String(++sec).padStart(2, "0");

  return (
    <>
      {/* Sticky brand strip */}
      <div class="ctr__no-print" style={`text-align:center;margin-bottom:18px`}>
        <div
          style={`font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${TEAL}`}
        >
          {businessLabel}
        </div>
        {contractor?.addressLine
          ? (
            <div style={`margin-top:4px;font-size:12px;color:${MUTED}`}>
              {contractor.addressLine}
            </div>
          )
          : null}
      </div>

      <article
        class="ctr"
        style={`background:${CREAM};border-radius:24px;box-shadow:0 14px 50px rgba(20,72,82,0.10);overflow:hidden;border:1px solid rgba(255,107,107,0.10)`}
      >
        {/* Pink ribbon header */}
        <div
          style={`height:8px;background:linear-gradient(90deg,${PINK} 0%,${PINK_DARK} 100%)`}
        />

        <div class="ctr__inner" style="padding:36px 44px 40px">
          {/* Top row: doc tag + status pill */}
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
            <div>
              <span
                style={`display:inline-block;background:rgba(20,72,82,0.10);color:${TEAL};font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;padding:6px 12px;border-radius:999px`}
              >
                {t.docTag} · #{contract.id.slice(0, 8).toUpperCase()}
              </span>
            </div>
            {signed
              ? (
                <Pill
                  bg="rgba(81,152,67,0.15)"
                  color={GREEN}
                  label={t.signed(
                    contract.signedAt ? fmtDate(contract.signedAt) : "",
                  )}
                />
              )
              : declined
              ? (
                <Pill
                  bg="rgba(168,59,59,0.10)"
                  color="#a83b3b"
                  label={t.declined}
                />
              )
              : (
                <Pill
                  bg="rgba(20,72,82,0.10)"
                  color={TEAL}
                  label={t.awaiting}
                />
              )}
          </div>

          {/* Hero title */}
          <h1
            class="ctr__title"
            style={`margin:18px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:42px;letter-spacing:-0.025em;color:${TEAL};line-height:1.02`}
          >
            {heroTitle}
          </h1>
          {customerName && (
            <div style={`margin-top:10px;color:${MUTED};font-size:14px`}>
              {t.between}{" "}
              <strong style={`color:${INK}`}>{businessLabel}</strong> {t.and}
              {" "}
              <strong style={`color:${INK}`}>{customerName}</strong>
              {effective
                ? (
                  <>
                    {" "}· {t.effective}{" "}
                    <strong style={`color:${INK}`}>{fmtDate(effective)}</strong>
                  </>
                )
                : null}
            </div>
          )}

          {/* To / From block — auto-fit so the two cards stack on narrow
              phones instead of squeezing into ~175px columns (which wrapped
              the contractor's phone number mid-digit). Two-up on wider screens. */}
          <section
            style="margin-top:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px"
            class="ctr__tofrom"
          >
            <PartyCard
              role={t.to}
              name={customerName}
              email={contract.customer?.email}
              phone={contract.customer?.phoneNumber}
            />
            <PartyCard
              role={t.from}
              name={contractorName}
              businessName={contractor?.businessName?.trim()}
              email={contractor?.email}
              phone={contractor?.phoneNumber}
              address={contractor?.addressLine}
            />
          </section>

          {/* Job details */}
          {items.length > 0 && (
            <section style="margin-top:36px">
              <SectionHeader n={num()} title={t.jobDetails} />
              {(() => {
                const lines = detailLines(
                  contract.jobDetails?.descriptionByLang?.[lang] ??
                    contract.jobDetails?.description,
                );
                if (lines.length === 0) return null;
                return lines.length > 1
                  ? (
                    <ul
                      style={`margin:0;padding:0;list-style:none;color:${INK};font-size:15px;line-height:1.6`}
                    >
                      {lines.map((l, i) => (
                        <li
                          key={i}
                          style="position:relative;padding:5px 0 5px 22px"
                        >
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
                  );
              })()}
              {
                /* Line-item breakdown only for multi-line quotes — a single
                  line just repeats the total card, and the Job details
                  bullets above already describe the scope. */
              }
              {items.length > 1 && (
                <table style="width:100%;border-collapse:collapse;margin-top:14px">
                  <thead>
                    <tr>
                      <th
                        style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:left`}
                      >
                        {t.tableDescription}
                      </th>
                      {showQty && (
                        <th
                          style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:right`}
                        >
                          {t.tableQty}
                        </th>
                      )}
                      <th
                        style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:right`}
                      >
                        {t.tableAmount}
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
                              {li.quantity ?? 1} {li.unit ?? t.unitEach}
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
              {/* Total card — the money moment */}
              <div
                style={`margin-top:20px;background:linear-gradient(135deg,#e8f3e2 0%,#dceadb 100%);border:1px solid rgba(81,152,67,0.25);border-radius:16px;padding:22px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px`}
              >
                <div>
                  <div
                    style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}
                  >
                    {t.agreementValue}
                  </div>
                  <div style={`margin-top:4px;color:${MUTED};font-size:12px`}>
                    {t.allIn}
                  </div>
                </div>
                <div
                  class="ctr__total-amt"
                  style={`font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:42px;letter-spacing:-0.03em;color:${TEAL};line-height:1;font-variant-numeric:tabular-nums`}
                >
                  {fmtMoneyExact(total)}
                </div>
              </div>
            </section>
          )}

          {/* Payment milestones */}
          {milestones.length > 0 && (
            <section style="margin-top:36px">
              <SectionHeader n={num()} title={t.paymentSchedule} />
              <div
                class="ctr__milestones"
                style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px"
              >
                {milestones.map((m, i) => (
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
          )}

          {
            /* Terms — the wizard-captured term grid (Start, completion,
              payment, warranty) and the plain-English legal clauses, under a
              single "Terms" header. The grid is conditional; the clauses are
              always present, so this whole section always renders. Warranty
              row is hidden when "No warranty" was chosen — clause 7 still
              applies. */
          }
          {(() => {
            const hasTermGrid =
              !!(contract.startDate || contract.estimatedCompletionDate ||
                (contract.terms && contract.terms.length > 0));
            return (
              <section style="margin-top:36px">
                <SectionHeader n={num()} title={t.terms} />
                {hasTermGrid && (
                  <div
                    class="ctr__terms-grid"
                    style="display:grid;grid-template-columns:1fr 1fr;gap:12px"
                  >
                    {contract.startDate && (
                      <KV k={t.start} v={fmtDate(contract.startDate)} />
                    )}
                    {contract.estimatedCompletionDate && (
                      <KV
                        k={t.estCompletion}
                        v={fmtDate(contract.estimatedCompletionDate)}
                      />
                    )}
                    {(contract.terms ?? [])
                      .filter((term) =>
                        term.stepId !== "customer" && !isEmptyWarranty(term)
                      )
                      .map((term) => (
                        <KV
                          key={term.stepId}
                          k={t.termLabels[term.stepId] ?? term.label}
                          v={expandTermValue(term, contractor?.state, lang)}
                        />
                      ))}
                  </div>
                )}
                {hasTermGrid && (
                  <div
                    style={`margin-top:22px;height:1px;background:${LINE}`}
                  />
                )}
                <ol
                  style={`margin:${
                    hasTermGrid ? "22px" : "0"
                  } 0 0;padding-left:20px;color:${INK};font-size:14px;line-height:1.65`}
                >
                  {t.clauses.map(([title, body]) => (
                    <li key={title}>
                      <strong>{title}.</strong> {body}
                    </li>
                  ))}
                </ol>
              </section>
            );
          })()}

          {
            /* Signature block — both cards render in both states; the
              right card swaps from "type your name below" placeholder to
              the customer's filled cursive name + date after signing. */
          }
          {!declined && (
            <section style="margin-top:36px">
              <SectionHeader n={num()} title={t.signHere} />
              <div
                style={`margin:-4px 0 0;color:${MUTED};font-size:13px;line-height:1.5`}
              >
                {signed ? t.bothCaptured : t.bySigning(customerFirst)}
              </div>
              <div style="margin-top:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px;align-items:stretch">
                {/* Contractor card */}
                <div
                  style={`padding:14px 16px;background:#fff;border:1px solid ${LINE};border-radius:12px;min-height:96px;display:flex;flex-direction:column;justify-content:flex-end`}
                >
                  <div
                    style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                  >
                    {t.contractor}
                  </div>
                  <div
                    style={`margin-top:2px;font-size:14px;font-weight:800;color:${INK}`}
                  >
                    {businessLabel}
                  </div>
                  <div
                    style={`margin-top:6px;font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:26px;color:${TEAL};line-height:1.1`}
                  >
                    {contractorName ?? businessLabel}
                  </div>
                  {contractorName && (
                    <div style={`margin-top:6px;font-size:11px;color:${MUTED}`}>
                      {t.by} {contractorName}
                    </div>
                  )}
                  <div style={`margin-top:2px;font-size:11px;color:${MUTED}`}>
                    {t.date} {effective ? fmtDate(effective) : t.today}
                  </div>
                </div>
                {/* Customer card — placeholder OR filled */}
                {signed
                  ? (
                    <div
                      style={`padding:14px 16px;background:#fff;border:1px solid ${LINE};border-radius:12px;min-height:96px;display:flex;flex-direction:column;justify-content:flex-end`}
                    >
                      <div
                        style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                      >
                        {customerFirst
                          ? t.signatureOf(customerName ?? customerFirst)
                          : t.clientSignature}
                      </div>
                      <div
                        style={`margin-top:6px;font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:26px;color:${TEAL};line-height:1.1`}
                      >
                        {contract.customerSignedName ?? customerName ?? "—"}
                      </div>
                      <div
                        style={`margin-top:4px;font-size:11px;color:${MUTED}`}
                      >
                        {contract.signedAt
                          ? fmtDate(contract.signedAt)
                          : t.today}
                      </div>
                    </div>
                  )
                  /* Unsigned: no preview slot here — the actual signature pad
                     (PublicSignContract) below is the single target. Showing a
                     dashed "YOUR SIGNATURE" placeholder here duplicated the
                     label and looked like two signature boxes. */
                  : null}
              </div>
              {!signed && (
                <PublicSignContract contractId={contract.id} lang={lang} />
              )}
              {signed && (
                <div
                  style={`margin-top:22px;padding:18px 22px;background:linear-gradient(135deg,rgba(81,152,67,0.12) 0%,rgba(81,152,67,0.04) 100%);border:1px solid rgba(72,158,95,0.35);border-radius:16px;display:flex;align-items:center;gap:14px`}
                >
                  <div
                    style={`width:40px;height:40px;border-radius:50%;background:${GREEN};color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0`}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </div>
                  <div>
                    <div
                      style={`font-weight:800;color:${GREEN};font-size:16px`}
                    >
                      {t.signedBinding}
                    </div>
                    <div style={`margin-top:2px;color:${MUTED};font-size:13px`}>
                      {t.signedNote}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Contact card */}
          {(contractor?.phoneNumber || contractor?.email) && (
            <footer
              style={`margin-top:36px;padding-top:22px;border-top:1px solid ${LINE};display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap`}
            >
              <div
                style={`width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,${GREEN} 0%,#71a85f 100%);color:#fff;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;letter-spacing:.04em;flex-shrink:0`}
              >
                {senderInitials}
              </div>
              <div style="min-width:0;flex:1">
                <div style={`color:${INK};font-size:14px;line-height:1.5`}>
                  {t.qBefore} {contractor?.phoneNumber && (
                    <>
                      {t.callWord}{" "}
                      <a
                        href={telHref(contractor.phoneNumber)}
                        style={`color:${TEAL};text-decoration:none;font-weight:700;white-space:nowrap`}
                      >
                        {fmtPhone(contractor.phoneNumber)}
                      </a>
                    </>
                  )}
                  {contractor?.phoneNumber && contractor?.email ? t.orWord : ""}
                  {contractor?.email && (
                    <>
                      {t.emailWord}{" "}
                      <a
                        href={`mailto:${contractor.email}`}
                        style={`color:${TEAL};text-decoration:none;font-weight:700`}
                      >
                        {contractor.email}
                      </a>
                    </>
                  )}
                  {t.lookForward}
                </div>
              </div>
            </footer>
          )}
        </div>
      </article>
      <div
        style={`display:flex;align-items:center;justify-content:center;gap:8px;margin-top:18px;font-size:11px;color:#a8b2b3;letter-spacing:.04em`}
      >
        <img
          src="/logo.png"
          alt=""
          height="16"
          style="height:16px;width:auto;opacity:0.7;display:block"
        />
        {t.poweredBy} #{contract.id.slice(0, 8).toUpperCase()}
      </div>
    </>
  );
}

function Pill(
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
function SectionHeader({ n, title }: { n: string; title: string }) {
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

function KV({ k, v }: { k: string; v: string }) {
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

function PartyCard(props: {
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

function sumLineTotals(items: LineItem[] | undefined): number {
  if (!items) return 0;
  return items.reduce((s, li) => s + (li.price ?? 0) * (li.quantity ?? 1), 0);
}

function initialsFromName(name?: string): string {
  if (!name) return "PM";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0] ?? "PM").slice(0, 2).toUpperCase();
}

function fmtDate(iso: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(isDateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function termValue(
  terms: Term[] | undefined,
  stepId: string,
): string | undefined {
  return terms?.find((t) => t.stepId === stepId)?.value;
}

/** Expand wizard-shorthand answers into customer-readable sentences.
 *  E.g. "Use my business state" → "California". "Yes" / "No" for state
 *  notices → a sentence the customer can actually act on. */
/** Localize a wizard-captured term value for the customer copy. Maps the
 *  known preset option labels to Spanish and converts numeric durations
 *  ("12 months" → "12 meses"); custom free-text and universal ratios
 *  ("50/50") pass through unchanged. Mirrors the backend PDF renderer. */
function expandTermValue(
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
    // User picked a specific state ("Pick a different state — TX")
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
 *  legal-text warranty clause in the Fine Print still applies. The warranty
 *  step id from the wizard is `warranty`; some users type "none" / "n/a". */
function isEmptyWarranty(term: Term): boolean {
  if (term.stepId !== "warranty") return false;
  const v = term.value.trim().toLowerCase();
  return v === "" || v === "no warranty" || v === "none" || v === "n/a" ||
    v === "no";
}

function computeMilestones(
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
  };
  const roleLabel: Record<MilestoneRole, { label: string; when: string }> = {
    deposit: { label: L.deposit, when: L.beforeStart },
    midpoint: { label: L.midpoint, when: L.atMidpoint },
    milestone: { label: L.midpoint, when: L.atMidpoint },
    completion: { label: L.balance, when: L.onCompletion },
    full: { label: L.final, when: L.onCompletion },
  };
  return computePaymentSplit(termValue(terms, "payment_terms"), total).map((
    p,
  ) => ({ ...roleLabel[p.role], amount: p.amountCents }));
}
