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
import { buildSignatureBlock } from "../../shared/quote-flow/signature-block.ts";
import { deriveContractView } from "../../shared/quote-flow/public-doc-state.ts";
import { fmtPhone, telHref } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  computeMilestones,
  CREAM,
  fmtDate,
  GREEN,
  initialsFromName,
  INK,
  JobDetailsSection,
  LINE,
  type LineItem,
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
  /** Captured signature mark (compact data-URL PNG) — present once signed
   *  (P-40). */
  customerSignature?: string;
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
    contractorTag: tFor(lang, "contractDoc.contractorTag"),
    clientTag: tFor(lang, "contractDoc.clientTag"),
    effective: tFor(lang, "contractDoc.effective"),
    plainEnglish: tFor(lang, "contractDoc.plainEnglish"),
    plainEnglishBody: (contractor: string, customer?: string) =>
      customer
        ? tFor(lang, "contractDoc.plainEnglishNamed", { contractor, customer })
        : tFor(lang, "contractDoc.plainEnglishUnnamed", { contractor }),
    to: tFor(lang, "contractDoc.to"),
    from: tFor(lang, "contractDoc.from"),
    jobDetails: tFor(lang, "contractDoc.jobDetails"),
    tableDescription: tFor(lang, "contractDoc.tableDescription"),
    tableQty: tFor(lang, "contractDoc.tableQty"),
    tableAmount: tFor(lang, "contractDoc.tableAmount"),
    unitEach: tFor(lang, "contractDoc.unitEach"),
    contractValue: tFor(lang, "contractDoc.contractValue"),
    allIn: tFor(lang, "contractDoc.allIn"),
    paymentSchedule: tFor(lang, "contractDoc.paymentSchedule"),
    terms: tFor(lang, "contractDoc.terms"),
    start: tFor(lang, "contractDoc.start"),
    startTbd: tFor(lang, "contractDoc.startTbd"),
    estCompletion: tFor(lang, "contractDoc.estCompletion"),
    estimated: (v: string) => tFor(lang, "contractDoc.estimated", { value: v }),
    signHere: tFor(lang, "contractDoc.signHere"),
    bothCaptured: tFor(lang, "contractDoc.bothCaptured"),
    bySigning: (first?: string) =>
      first
        ? tFor(lang, "contractDoc.bySigningNamed", { name: first })
        : tFor(lang, "contractDoc.bySigning"),
    contractorSignature: tFor(lang, "contractDoc.contractorSignature"),
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
    qSigned: tFor(lang, "contractDoc.qSigned"),
    downloadPdf: tFor(lang, "contractDoc.downloadPdf"),
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

export function ContractDoc(
  { contract, lang: langOverride }: {
    contract: ContractPublic;
    /** Customer's own language (pm_lang cookie, resolved by the /c route).
     *  Wins over the contractor's outgoing-comms language when present. */
    lang?: Lang;
  },
) {
  // Shared view derivation (P-11/P-13/P-40/P-63) — signed state, the
  // stored signature image, the post-signed footer variant, and the PDF
  // download URL all come from the same pure module the tests pin.
  const view = deriveContractView(contract);
  const signed = view.signed;
  const declined = contract.status === "declined";
  const total = contract.totalAmount ??
    sumLineTotals(contract.jobDetails?.lineItems);
  const customerName = contract.customer?.name?.trim();
  const contractor = contract.contractor;
  const lang: Lang = langOverride ??
    (contractor?.commsLanguage === "es" ? "es" : "en");
  const t = cstr(lang);
  const businessLabel = contractor?.businessName?.trim() ||
    contractor?.name?.trim() || tFor(lang, "brand.name");
  const contractorName = contractor?.name?.trim();
  const senderInitials = initialsFromName(contractorName ?? businessLabel);

  const items = contract.jobDetails?.lineItems ?? [];
  // Title/summary in the document's language when the per-language fields are
  // present (populated from the picked job option); else the single value.
  const summary = (contract.jobDetails?.summaryByLang?.[lang] ??
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

  // Signature-block copy (deck p14) — shared with the backend renderers via
  // the pure module so the web page, the PDF, and the email never drift.
  // The module speaks English; the ES page mirrors it through i18n.
  const sig = customerName
    ? buildSignatureBlock({
      clientName: customerName,
      contractorName: contractorName ?? businessLabel,
      businessName: contractor?.businessName,
      signedDateISO: effective ?? new Date().toISOString(),
    })
    : undefined;
  const agreementLine = lang === "en" && sig
    ? sig.agreementLine
    : t.bySigning(customerName);
  const contractorByLine = contractorName
    ? (lang === "en" && sig
      ? sig.contractor.byLine
      : `${t.by} ${contractorName}`)
    : undefined;
  const contractorDateLine = lang === "en" && sig
    ? sig.contractor.dateLine
    : `${t.date} ${effective ? fmtDate(effective) : t.today}`;
  const customerInstruction = lang === "en" && sig
    ? sig.customer.instruction
    : t.signTypeBelow;

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
              <strong style={`color:${INK}`}>{businessLabel}</strong>{" "}
              {t.contractorTag} {t.and}{" "}
              <strong style={`color:${INK}`}>{customerName}</strong>{" "}
              {t.clientTag}
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

          {
            /* To / From block — auto-fit so the two cards stack on narrow
              phones instead of squeezing into ~175px columns (which wrapped
              the contractor's phone number mid-digit). Two-up on wider screens. */
          }
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

          {
            /* The deal in plain English (deck p12) — one no-legalese sentence
              stating who does what for whom, before the itemized sections. */
          }
          <section style="margin-top:36px">
            <SectionHeader n={num()} title={t.plainEnglish} />
            <p style={`margin:0;color:${INK};font-size:15px;line-height:1.6`}>
              {t.plainEnglishBody(businessLabel, customerName)}
            </p>
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
              forceTable
              labels={{
                tableDescription: t.tableDescription,
                tableQty: t.tableQty,
                tableAmount: t.tableAmount,
                unitEach: t.unitEach,
                valueLabel: t.contractValue,
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
            return (
              <section style="margin-top:36px">
                <SectionHeader n={num()} title={t.terms} />
                {
                  /* Always rendered: even a contract without wizard terms
                    keeps a Start row ("To be scheduled") so the schedule
                    seam is visible on every agreement (deck p12). */
                }
                <TermGrid
                  startDate={contract.startDate}
                  estimatedCompletionDate={contract.estimatedCompletionDate}
                  terms={contract.terms}
                  contractorState={contractor?.state}
                  lang={lang}
                  startFallback={t.startTbd}
                  labels={{
                    start: t.start,
                    estCompletion: t.estCompletion,
                    termLabels: t.termLabels,
                  }}
                />
                <div style={`margin-top:22px;height:1px;background:${LINE}`} />
                <ol
                  style={`margin:22px 0 0;padding-left:20px;color:${INK};font-size:14px;line-height:1.65`}
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
                {signed ? t.bothCaptured : agreementLine}
              </div>
              <div style="margin-top:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;align-items:start">
                {/* Contractor signature column (deck p14) */}
                <div
                  style={`padding:14px 16px;background:#fff;border:1px solid ${LINE};border-radius:12px;min-height:96px;display:flex;flex-direction:column;justify-content:flex-end`}
                >
                  <div
                    style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                  >
                    {t.contractorSignature}
                  </div>
                  <div
                    style={`margin-top:2px;font-size:14px;font-weight:800;color:${INK}`}
                  >
                    {sig?.contractor.heading ?? businessLabel}
                  </div>
                  <div
                    style={`margin-top:6px;font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:26px;color:${TEAL};line-height:1.1`}
                  >
                    {contractorName ?? businessLabel}
                  </div>
                  {contractorByLine && (
                    <div style={`margin-top:6px;font-size:11px;color:${MUTED}`}>
                      {contractorByLine}
                    </div>
                  )}
                  <div style={`margin-top:2px;font-size:11px;color:${MUTED}`}>
                    {contractorDateLine}
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
                        {customerName
                          ? t.signatureOf(customerName)
                          : t.clientSignature}
                      </div>
                      {
                        /* P-40: the captured signature mark (drawn on the
                          pad, or the typed-name PNG) renders back on the
                          signed page; the cursive text is the fallback for
                          legacy rows without a stored image. */
                      }
                      {view.signatureImage
                        ? (
                          <img
                            src={view.signatureImage}
                            alt={contract.customerSignedName ??
                              customerName ?? ""}
                            style="margin-top:6px;display:block;max-width:240px;max-height:80px;object-fit:contain;object-position:left center"
                          />
                        )
                        : (
                          <div
                            style={`margin-top:6px;font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:26px;color:${TEAL};line-height:1.1`}
                          >
                            {contract.customerSignedName ?? customerName ?? "—"}
                          </div>
                        )}
                      <div
                        style={`margin-top:4px;font-size:11px;color:${MUTED}`}
                      >
                        {contract.signedAt
                          ? fmtDate(contract.signedAt)
                          : t.today}
                      </div>
                    </div>
                  )
                  /* Unsigned: "YOUR Signature" column (deck p14) — the
                     heading, the "Sign & type name below" instruction, and
                     the actual sign pad (PublicSignContract with its Undo /
                     Clear aids, name input, and Sign button) all live inside
                     this one card, mirroring the contractor column. */
                  : (
                    <div
                      style={`padding:14px 16px;background:#fff;border:1px solid ${LINE};border-radius:12px;min-height:96px;display:flex;flex-direction:column`}
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
                        style={`margin-top:8px;font-size:12px;font-weight:700;color:${TEAL}`}
                      >
                        {customerInstruction}
                      </div>
                      <PublicSignContract
                        contractId={contract.id}
                        lang={lang}
                      />
                    </div>
                  )}
              </div>
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
              {
                /* P-63: the signed agreement offers the same PDF download
                  the invoice page has (deriveContractView emits the URL
                  for every signed contract). */
              }
              {signed && view.pdfUrl && (
                <div
                  class="ctr__no-print"
                  style="margin-top:18px;text-align:center"
                >
                  <a
                    href={view.pdfUrl}
                    target="_blank"
                    rel="noopener"
                    style={`display:inline-flex;align-items:center;gap:8px;color:${MUTED};text-decoration:none;font-weight:700;font-size:13px`}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <path d="M7 10l5 5 5-5" />
                      <path d="M12 15V3" />
                    </svg>
                    {t.downloadPdf}
                  </a>
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
                  {
                    /* P-63: once signed, the footer stops asking "Questions
                      before signing?" — deriveContractView's footerVariant
                      picks the post-signed copy. */
                  }
                  {view.footerVariant === "signed" ? t.qSigned : t.qBefore}{" "}
                  {contractor?.phoneNumber && (
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
