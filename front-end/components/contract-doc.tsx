/**
 * Contract rendering for the public agreement page (/c/:id).
 *
 * Extracted from the route so a hydrating island (PublicContractView) can
 * fetch the contract client-side and paint a skeleton first, instead of
 * blocking SSR on the backend round-trip (which left the page blank-white
 * until the first byte). See problems.md #25.
 *
 * The presentational sections (header primitives, party cards, job-details
 * table, payment schedule, term grid) live in ./doc-parts.tsx so the invoice
 * (/i/:id) mirrors this layout without duplicating markup. This file keeps the
 * agreement-only bits: the 14 numbered legal clauses and the signature block.
 */
import PublicSignContract from "../islands/PublicSignContract.tsx";
import { fmtPhone, telHref } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  computeMilestones,
  CREAM,
  fmtDate,
  GREEN,
  hasTermGrid,
  initialsFromName,
  INK,
  JobDetailsSection,
  KV,
  type LineItem,
  LINE,
  MUTED,
  PartyCard,
  PaymentScheduleSection,
  Pill,
  PINK,
  PINK_DARK,
  SectionHeader,
  sumLineTotals,
  TEAL,
  type Term,
  TermGrid,
} from "./doc-parts.tsx";

// Re-export the palette tokens the public route shell pulls from here.
export { BG, INK, LINE } from "./doc-parts.tsx";

interface Contractor {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  addressLine?: string;
  state?: string;
  /** Outgoing-comms language (roadmap p.13) — drives this page's copy. */
  commsLanguage?: string;
  /** True when the contractor uploaded a business logo — rendered via the
   *  public-logo endpoint above the brand strip (roadmap p.2). */
  hasLogo?: boolean;
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
        {contractor?.hasLogo
          ? (
            <img
              src={`/api/public-logo/contract/${contract.id}`}
              alt=""
              style="max-height:48px;max-width:160px;object-fit:contain;display:block;margin:0 auto 8px;border-radius:8px"
            />
          )
          : null}
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
            <JobDetailsSection
              n={num()}
              title={t.jobDetails}
              description={contract.jobDetails?.descriptionByLang?.[lang] ??
                contract.jobDetails?.description}
              items={items}
              total={total}
              labels={{
                tableDescription: t.tableDescription,
                tableQty: t.tableQty,
                tableAmount: t.tableAmount,
                unitEach: t.unitEach,
                valueLabel: t.agreementValue,
                valueSub: t.allIn,
              }}
            />
          )}

          {/* Payment milestones */}
          {milestones.length > 0 && (
            <PaymentScheduleSection
              n={num()}
              title={t.paymentSchedule}
              milestones={milestones}
            />
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
            const grid = hasTermGrid(contract);
            return (
              <section style="margin-top:36px">
                <SectionHeader n={num()} title={t.terms} />
                {grid && (
                  <TermGrid
                    startDate={contract.startDate}
                    estimatedCompletionDate={contract.estimatedCompletionDate}
                    terms={contract.terms}
                    contractorState={contractor?.state}
                    lang={lang}
                    labels={{
                      start: t.start,
                      estCompletion: t.estCompletion,
                      termLabels: t.termLabels,
                    }}
                  />
                )}
                {grid && (
                  <div style={`margin-top:22px;height:1px;background:${LINE}`} />
                )}
                <ol
                  style={`margin:${
                    grid ? "22px" : "0"
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
                  /* Unsigned: "YOUR Signature" card (roadmap slide 16) —
                     mirrors the contractor card and points the customer at
                     the actual sign pad (PublicSignContract) right below.
                     It deliberately has no dashed pad styling so it doesn't
                     read as a second signature box. */
                  : (
                    <div
                      style={`padding:14px 16px;background:#fff;border:1px solid ${LINE};border-radius:12px;min-height:96px;display:flex;flex-direction:column;justify-content:flex-end`}
                    >
                      <div
                        style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                      >
                        {t.yourSignature}
                      </div>
                      <div
                        style={`margin-top:2px;font-size:14px;font-weight:800;color:${INK}`}
                      >
                        {customerName ?? t.clientSignature}
                      </div>
                      <div
                        style={`margin-top:6px;flex:1;display:flex;align-items:flex-end`}
                      >
                        <div
                          style={`width:100%;border-bottom:1.5px dashed ${LINE}`}
                        />
                      </div>
                      <div
                        style={`margin-top:8px;font-size:12px;font-weight:700;color:${TEAL}`}
                      >
                        {t.signTypeBelow}
                      </div>
                    </div>
                  )}
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
