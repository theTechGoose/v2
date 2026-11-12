/**
 * The Quote + Agreement document for the public quote page (/q/:id).
 *
 * The quote IS the agreement (one document, one signature ceremony): this
 * renders the itemized job, the wizard-captured terms, the plain-English
 * legal clauses, and the signature block. Accepting the quote — via the
 * PublicSignQuote pad — is the signing.
 *
 * Rendered by a hydrating island (PublicQuoteView) that fetches the quote
 * client-side and paints a skeleton first, instead of blocking SSR on the
 * backend round-trip (which left the page blank-white until the first
 * byte). See problems.md #25.
 *
 * The presentational sections (header primitives, party cards, job-details
 * table, payment schedule, term grid) live in ./doc-parts.tsx so the invoice
 * (/i/:id) mirrors this layout without duplicating markup. This file keeps the
 * agreement-only bits: the 14 numbered legal clauses and the signature block.
 */
import PublicSignQuote from "../islands/PublicSignQuote.tsx";
import PublicQuoteActions from "../islands/PublicQuoteActions.tsx";
import { buildSignatureBlock } from "../../shared/quote-flow/signature-block.ts";
import { agreementTitle } from "../../shared/quote-flow/agreement-title.ts";
import { publicLogoUrl } from "../../shared/quote-flow/public-logo-url.ts";
import { senderInitials as senderInitialsOf } from "../../shared/identity/initials.ts";
import {
  type ConfirmChannel,
  signedNoteKey,
} from "../../shared/quote-flow/signed-note.ts";
import {
  deriveQuoteView,
  internalPreview,
  publicHeadlineState,
} from "../../shared/quote-flow/public-doc-state.ts";
import {
  localizeLineItems,
  quoteDescription,
} from "../../shared/quote-flow/quote-translations.ts";
import {
  docHeadline,
  type LinkedChangeOrderLike,
  type LinkedInvoiceLike,
  payNowTarget,
  pendingChangeOrderNotices,
  relatedDocumentRows,
  shortDate,
  versionChangeLine,
} from "../../shared/documents/linked-view.ts";
import type { VersionChanges } from "../../shared/documents/versions.ts";
import { agreementClauses } from "../../shared/documents/warranty-clause.ts";
import { localizeTermValue } from "../lib/term-i18n.ts";
import { withLang } from "../../shared/quote-flow/public-lang.ts";
import { fmtMoneyExact, fmtPhone, telHref } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  computeMilestones,
  CREAM,
  fmtDate,
  GREEN,
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
  /** REQ-038 (NW-06b): the business website, when provided. */
  websiteUrl?: string;
  addressLine?: string;
  state?: string;
  /** Outgoing-comms language (roadmap p.13) — drives this page's copy. */
  commsLanguage?: string;
  /** True when the contractor uploaded a business logo — rendered via the
   *  public-logo endpoint above the brand strip (roadmap p.2). */
  hasLogo?: boolean;
  /** REQ-613 (M31): the logo's version — part of its URL, so a replaced logo is a new URL. */
  logoVersion?: string;
}

export interface QuotePublic {
  id: string;
  /** REQ-333 (M24): the language the base text was typed in — that language
   *  renders the typed text, never a cached "translation" of it. */
  lang?: string;
  /** REQ-198/201: the document's number ("Q-001"), version and headline state. */
  number?: string;
  version?: number;
  state?: string;
  publishedAt?: string;
  /** REQ-304: what this version changed against the one before it. */
  changesFromPrevious?: VersionChanges;
  /** REQ-205: the documents billed / changed against this agreement. */
  invoices?: LinkedInvoiceLike[];
  changeOrders?: LinkedChangeOrderLike[];
  customerId?: string;
  status?: string;
  estimatedTotal?: number;
  effectiveDate?: string;
  startDate?: string;
  estimatedCompletionDate?: string;
  /** Persisted accepted state (P-11) — who signed and when. */
  acceptedAt?: string;
  acceptedName?: string;
  /** Captured signature mark (compact data-URL PNG) — present once accepted
   *  (P-40). */
  acceptedSignature?: string;
  contractor?: Contractor;
  customer?: { name?: string; phoneNumber?: string; email?: string };
  /** REQ-403 (m11): which confirmation the signed page may promise. */
  confirmChannel?: ConfirmChannel;
  summary?: string;
  jobName?: string;
  description?: string;
  /** Per-language title/summary/description (keyed by lang code). When
   *  present, the doc renders these in its own language instead of the
   *  single-language fields above. */
  descriptionByLang?: Record<string, string>;
  jobNameByLang?: Record<string, string>;
  summaryByLang?: Record<string, string>;
  /** REQ-263 (demo ai-assistant-m2): where the job is. */
  serviceAddress?: string;
  /** REQ-256: the onboarding "see what your customer sees" sample — shown
   *  as a sample (no number, not sent) to a placeholder customer. */
  isSample?: boolean;
  /** REQ-306 (demo B3): the viewer is the business itself (owner, acting
   *  admin, impersonation) — a preview, not the customer; the pad is
   *  replaced by a banner. Never present for the customer. */
  internal?: boolean;
  /** REQ-460 (demo-loop cycle 3, M16): why this open quote cannot be signed
   *  yet (`not_issued` / `terms_incomplete`) — the pad becomes a notice. */
  signRefusal?: string;
  lineItems?: LineItem[];
  terms?: Term[];
  createdAt?: string;
}

/** The public agreement's copy table — one table so the whole document
 *  flips together when the viewer toggles EN | ES (REQ-048). */
function cstr(lang: Lang, terms?: Term[]) {
  return {
    docTag: tFor(lang, "quoteDoc.docTag"),
    signed: (d: string) => tFor(lang, "quoteDoc.signed", { date: d }),
    declined: tFor(lang, "status.declined"),
    awaiting: tFor(lang, "quoteDoc.awaiting"),
    between: tFor(lang, "quoteDoc.between"),
    and: tFor(lang, "quoteDoc.and"),
    contractorTag: tFor(lang, "quoteDoc.contractorTag"),
    clientTag: tFor(lang, "quoteDoc.clientTag"),
    effective: tFor(lang, "quoteDoc.effective"),
    forJob: tFor(lang, "quoteDoc.forJob"),
    plainEnglish: tFor(lang, "quoteDoc.plainEnglish"),
    plainEnglishBody: (contractor: string, customer?: string) =>
      customer
        ? tFor(lang, "quoteDoc.plainEnglishNamed", { contractor, customer })
        : tFor(lang, "quoteDoc.plainEnglishUnnamed", { contractor }),
    to: tFor(lang, "quoteDoc.to"),
    serviceAddress: tFor(lang, "quoteDoc.serviceAddress"),
    from: tFor(lang, "quoteDoc.from"),
    jobDetails: tFor(lang, "quoteDoc.jobDetails"),
    tableDescription: tFor(lang, "quoteDoc.tableDescription"),
    tableQty: tFor(lang, "quoteDoc.tableQty"),
    tableAmount: tFor(lang, "quoteDoc.tableAmount"),
    unitEach: tFor(lang, "quoteDoc.unitEach"),
    contractValue: tFor(lang, "quoteDoc.contractValue"),
    allIn: tFor(lang, "quoteDoc.allIn"),
    paymentSchedule: tFor(lang, "quoteDoc.paymentSchedule"),
    // NW-54 (REQ-014): the clause list is "Terms and Conditions" on web + PDF.
    // REQ-035 (NW-55): the grid section is "Terms"; the 14 notices sit
    // collapsed under a "Terms and Conditions" summary (NW-54's name).
    terms: tFor(lang, "quoteDoc.terms"),
    termsAndConditions: tFor(lang, "quoteDoc.termsAndConditions"),
    cancellationValue: tFor(lang, "quoteDoc.termValue.cancellation"),
    start: tFor(lang, "quoteDoc.start"),
    startTbd: tFor(lang, "quoteDoc.startTbd"),
    estCompletion: tFor(lang, "quoteDoc.estCompletion"),
    estimated: (v: string) => tFor(lang, "quoteDoc.estimated", { value: v }),
    signHere: tFor(lang, "quoteDoc.signHere"),
    bothCaptured: tFor(lang, "quoteDoc.bothCaptured"),
    bySigning: (first?: string) =>
      first
        ? tFor(lang, "quoteDoc.bySigningNamed", { name: first })
        : tFor(lang, "quoteDoc.bySigning"),
    contractorSignature: tFor(lang, "quoteDoc.contractorSignature"),
    by: tFor(lang, "quoteDoc.by"),
    date: tFor(lang, "quoteDoc.date"),
    today: tFor(lang, "quoteDoc.today"),
    yourSignature: tFor(lang, "quoteDoc.yourSignature"),
    signTypeBelow: tFor(lang, "quoteDoc.signTypeBelow"),
    clientSignature: tFor(lang, "quoteDoc.clientSignature"),
    signatureOf: (n: string) => tFor(lang, "quoteDoc.signatureOf", { name: n }),
    signedBinding: tFor(lang, "quoteDoc.signedBinding"),
    acceptedPill: tFor(lang, "status.accepted"),
    qBefore: tFor(lang, "quoteDoc.qBefore"),
    qSigned: tFor(lang, "quoteDoc.qSigned"),
    downloadPdf: tFor(lang, "quoteDoc.downloadPdf"),
    callWord: tFor(lang, "quoteDoc.callWord"),
    orWord: tFor(lang, "quoteDoc.orWord"),
    emailWord: tFor(lang, "quoteDoc.emailWord"),
    emailWordStart: tFor(lang, "quoteDoc.emailWordStart"),
    lookForward: tFor(lang, "quoteDoc.lookForward"),
    poweredBy: tFor(lang, "quoteDoc.poweredBy"),
    termLabels: {
      customer: tFor(lang, "quoteDoc.termLabel.customer"),
      start_date: tFor(lang, "quoteDoc.termLabel.startDate"),
      wraps: tFor(lang, "quoteDoc.termLabel.wraps"),
      payment_terms: tFor(lang, "quoteDoc.termLabel.paymentTerms"),
      warranty: tFor(lang, "quoteDoc.termLabel.warranty"),
      cancellation: tFor(lang, "quoteDoc.termLabel.cancellation"),
    } as Record<string, string>,
    // REQ-463 (demo m31): clause 7 states the warranty from the terms —
    // the period when one is set, a no-warranty body otherwise.
    clauses: agreementClauses({
      terms,
      lang,
      prefix: "quoteDoc.clause",
      t: (key, vars) => tFor(lang, key, vars),
      localize: localizeTermValue,
    }),
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
          {tFor(lang, "quoteDoc.cantOpen")}
        </div>
        <p style={`margin:8px 0 0;color:${MUTED};font-size:14px`}>{message}</p>
      </div>
    </>
  );
}

export function QuoteDoc(
  { quote, lang, onSigned, search, onSignInPerson }: {
    quote: QuotePublic;
    /** REQ-048: the viewer's language — English first, or their own pick /
     *  toggle (PublicQuoteView owns it). The contractor's outgoing-comms
     *  language no longer decides what the customer sees first. */
    lang: Lang;
    /** REQ-311: the sign island's success callback (PublicQuoteView refetches
     *  and swaps the signed document in place). */
    onSigned?: (signed: { name: string }) => void;
    /** REQ-306: the page's query string — `?as=customer&confirm=1` is the
     *  in-person override that shows the pad to the business's own viewer. */
    search?: string;
    /** REQ-405 (demo m14): "Sign in person" — the view lays the override onto
     *  the current URL in place and re-renders the pad (no navigation). */
    onSignInPerson?: () => void;
  },
) {
  // REQ-306 (demo B3): the business's own preview — banner instead of pad.
  const preview = internalPreview(quote, search);
  // Shared view derivation (P-11/P-13/P-40/P-63) — accepted state, the
  // stored signature image, the post-signed footer variant, and the PDF
  // download URL all come from the same pure module the tests pin.
  const view = deriveQuoteView(quote);
  const signed = view.mode === "accepted";
  const declined = view.mode === "declined";
  // REQ-460 (demo-loop cycle 3, M16): never sent, or no payment terms yet.
  const unready = view.mode === "unready";
  const total = quote.estimatedTotal ?? sumLineTotals(quote.lineItems);
  // REQ-032 (NW-28): the signer's typed name is a name too — the named
  // sentence must not fall back to "you agree" once someone has signed.
  const customerName = quote.customer?.name?.trim() ||
    quote.acceptedName?.trim() || undefined;
  const contractor = quote.contractor;
  const t = cstr(lang, quote.terms);
  const businessLabel = contractor?.businessName?.trim() ||
    contractor?.name?.trim() || tFor(lang, "brand.name");
  const contractorName = contractor?.name?.trim();
  const contractorFirst = contractorName?.split(/\s+/)[0];
  // REQ-502 (demo c3 p8-pair10-b): the sidebar's rule — name + business —
  // so "Carl" of "Jensen Electric LLC" is "CJ" here too, never "CA".
  const senderInitials = senderInitialsOf(contractor, businessLabel);

  // REQ-264 (M15): line items in the document's language (server-filled
  // lineItems[].descriptionByLang), else their base text. REQ-333 (M24): in
  // the quote's own language that is the typed text, never a cache.
  const items = localizeLineItems(quote.lineItems, lang, quote.lang);
  // Title/summary in the document's language when the per-language fields are
  // present (populated from the picked job option); else the single value.
  const summary = (quote.summaryByLang?.[lang] ?? quote.summary ??
    tFor(lang, "quoteDoc.serviceAgreement"))
    .replace(/^\s*quote\s*:\s*/i, "").trim();
  const jobNameRaw = (quote.jobNameByLang?.[lang] ?? quote.jobName)?.trim();
  const jobTitle = (jobNameRaw && jobNameRaw.length > 0)
    ? jobNameRaw
    : summary.replace(/\b\w/g, (c) => c.toUpperCase());
  // REQ-036 (NW-57): "<Customer>'s <Job> Agreement" — never a bare job name
  // (or a leaked "New job") once a customer is known.
  const heroTitle = agreementTitle({
    customer: customerName,
    job: jobTitle,
    lang,
    fallback: tFor(lang, "quoteDoc.serviceAgreement"),
  });

  const effective = quote.effectiveDate ?? quote.createdAt;
  const milestones = computeMilestones(total, quote.terms, lang);

  // REQ-201/205: "Q-001 · Version 2 · Accepted and signed · Nov 6, 2026" —
  // the number is for life, the version advances on publish, the state and
  // its date come from the public projection. Rows written before numbering
  // keep the old #ID reference.
  const docNumber = quote.number ?? `#${quote.id.slice(0, 8).toUpperCase()}`;
  // REQ-256: the onboarding sample has no number and was sent to no one.
  const headline = quote.isSample
    ? tFor(lang, "quoteDoc.sampleHeadline")
    : docHeadline(
      {
        number: docNumber,
        version: quote.version ?? 1,
        // REQ-320 (demo m15): the state word follows the signature pad's
        // derive — none at all while the server still calls it a draft.
        state: publicHeadlineState(quote),
        date: signed ? view.acceptedAt : quote.publishedAt,
      },
      lang,
    );
  // REQ-304 (demo M28): "What changed in Version 2: Total $9,500.00 →
  // $10,700.00" — the customer sees the comparison, not just "Revised".
  const changedLine = quote.changesFromPrevious && !quote.isSample
    ? versionChangeLine(quote.changesFromPrevious, lang)
    : "";
  const related = relatedDocumentRows(quote, lang);
  // REQ-251 (demo m13): a signed agreement hands the customer straight to
  // the open invoice the signature billed — not just a small related row.
  const payNow = signed ? payNowTarget(quote) : undefined;
  // REQ-457 (demo M27, cycle 3): a change order still waiting for the
  // customer is named on the signed agreement with the job's new total —
  // not hidden until they find the /co link some other way.
  const pendingCos = signed ? pendingChangeOrderNotices(quote) : [];

  // Signature-block copy (deck p14) — shared with the backend renderers via
  // the pure module so the web page, the PDF, and the email never drift.
  // REQ-032 (NW-28): the module speaks both languages — no EN-only fork.
  const sig = customerName
    ? buildSignatureBlock({
      clientName: customerName,
      contractorName: contractorName ?? businessLabel,
      businessName: contractor?.businessName,
      signedDateISO: effective ?? new Date().toISOString(),
      lang,
    })
    : undefined;
  const agreementLine = sig ? sig.agreementLine : t.bySigning(undefined);
  const contractorByLine = contractorName
    ? (sig ? sig.contractor.byLine : `${t.by} ${contractorName}`)
    : undefined;
  const contractorDateLine = sig
    ? sig.contractor.dateLine
    : `${t.date} ${effective ? fmtDate(effective, lang) : t.today}`;
  const customerInstruction = sig ? sig.customer.instruction : t.signTypeBelow;

  // Sequential section numbers. Sections are conditionally rendered, so
  // hardcoding 01/02/03 leaves gaps (01,03,…) when one is absent — which
  // reads as a mistake. Each rendered SectionHeader pulls the next number
  // in source order via short-circuit eval, so the sequence is always
  // gapless regardless of which optional sections appear.
  let sec = 0;
  const num = () => String(++sec).padStart(2, "0");

  // REQ-311 (demo-loop c1 m19): the signed document opens with a thank-you
  // and the next step at the top — the customer who lands here later (or
  // scrolls up) sees "signed, now pay" before anything else.
  const signerName = quote.acceptedName?.trim() || customerName;

  return (
    <>
      {signed && signerName && (
        <div
          data-cy="quote-signed-banner"
          role="status"
          class="ctr__no-print"
          style={`margin-bottom:18px;padding:16px 20px;background:linear-gradient(135deg,rgba(81,152,67,0.14) 0%,rgba(81,152,67,0.05) 100%);border:1px solid rgba(72,158,95,0.35);border-radius:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap`}
        >
          <div
            aria-hidden="true"
            style={`width:36px;height:36px;border-radius:50%;background:${GREEN};color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0`}
          >
            <svg
              width="18"
              height="18"
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
          <div style="flex:1;min-width:200px">
            <div style={`font-weight:800;color:${GREEN};font-size:15px`}>
              {tFor(lang, "quoteDoc.signedBanner.thanks", {
                name: signerName,
                date: view.acceptedAt ? fmtDate(view.acceptedAt, lang) : "",
              })}
            </div>
            <div style={`margin-top:4px;font-size:14px;color:${INK}`}>
              {payNow
                ? (
                  <a
                    data-cy="quote-signed-banner-pay"
                    href={withLang(payNow.url, lang)}
                    style={`color:${PINK_DARK};font-weight:800;text-decoration:none`}
                  >
                    {tFor(lang, "quoteDoc.signedBanner.next", {
                      amount: fmtMoneyExact(payNow.balanceCents),
                    })}
                  </a>
                )
                : tFor(lang, "quoteDoc.signedBanner.nextNoInvoice")}
            </div>
          </div>
        </div>
      )}
      {pendingCos.map((co) => (
        <div
          key={co.id}
          data-cy="quote-pending-change-order"
          role="status"
          class="ctr__no-print"
          style={`margin-bottom:18px;padding:14px 20px;background:#fff8e6;border:1px solid #f0c96a;border-radius:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:14px;color:${INK}`}
        >
          <span style="flex:1;min-width:200px;font-weight:700">
            {tFor(lang, "quoteDoc.pendingChangeOrder", {
              number: co.number,
              delta: `${co.deltaAmountCents >= 0 ? "+" : "−"}${
                fmtMoneyExact(Math.abs(co.deltaAmountCents))
              }`,
              total: fmtMoneyExact(co.newTotalCents),
            })}
          </span>
          <a
            href={co.url}
            style={`color:${PINK_DARK};font-weight:800;text-decoration:none;white-space:nowrap`}
          >
            {tFor(lang, "quoteDoc.pendingChangeOrderCta")} →
          </a>
        </div>
      ))}
      {/* Sticky brand strip */}
      <div class="ctr__no-print" style={`text-align:center;margin-bottom:18px`}>
        {contractor?.hasLogo
          ? (
            <img
              src={publicLogoUrl("quote", quote.id, contractor.logoVersion)}
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
                {t.docTag}
              </span>
              <div
                data-cy="quote-doc-headline"
                style={`margin-top:8px;font-size:13px;font-weight:800;color:${TEAL};letter-spacing:.01em`}
              >
                {headline}
              </div>
              {!signed && quote.publishedAt
                ? (
                  <div style={`margin-top:2px;font-size:12px;color:${MUTED}`}>
                    {tFor(lang, "public.doc.publishedOn", {
                      date: shortDate(quote.publishedAt, lang),
                    })}
                  </div>
                )
                : null}
              {changedLine
                ? (
                  <div
                    data-cy="public-doc-changes"
                    style={`margin-top:4px;font-size:12px;font-weight:700;color:${TEAL}`}
                  >
                    {tFor(lang, "public.doc.whatChanged", {
                      n: String(quote.version ?? 1),
                      changes: changedLine,
                    })}
                  </div>
                )
                : null}
            </div>
            {signed
              ? (
                <Pill
                  bg="rgba(81,152,67,0.15)"
                  color={GREEN}
                  label={t.signed(
                    view.acceptedAt ? fmtDate(view.acceptedAt, lang) : "",
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
              : unready
              ? (
                <Pill
                  bg="rgba(20,72,82,0.06)"
                  color={MUTED}
                  label={tFor(lang, "public.doc.notReady")}
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
              {
                /* REQ-036 (NW-57): the job name sits between the parties
                  and the effective date. */
              }
              {jobNameRaw
                ? (
                  <>
                    {" "}
                    {t.forJob}{" "}
                    <strong style={`color:${INK}`}>{jobNameRaw}</strong>
                  </>
                )
                : null}
              {effective
                ? (
                  <>
                    {" "}· {t.effective}{" "}
                    <strong style={`color:${INK}`}>
                      {fmtDate(effective, lang)}
                    </strong>
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
              name={customerName ??
                (quote.isSample
                  ? tFor(lang, "quoteDoc.sampleCustomer")
                  : undefined)}
              email={quote.customer?.email}
              phone={quote.customer?.phoneNumber}
            />
            <PartyCard
              role={t.from}
              name={contractorName}
              businessName={contractor?.businessName?.trim()}
              email={contractor?.email}
              phone={contractor?.phoneNumber}
              website={contractor?.websiteUrl}
              address={contractor?.addressLine}
            />
          </section>
          {
            /* REQ-263 (demo ai-assistant-m2): the job site the contractor
              typed ("412 Oak St Austin") — the customer agrees to work AT
              this address. */
          }
          {quote.serviceAddress?.trim()
            ? (
              <div
                data-cy="quote-doc-service-address"
                style={`margin-top:12px;background:#fff;border:1px solid ${LINE};border-radius:12px;padding:12px 16px;font-size:13.5px;color:${INK}`}
              >
                <span
                  style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin-right:10px`}
                >
                  {t.serviceAddress}
                </span>
                <strong style="overflow-wrap:anywhere">
                  {quote.serviceAddress.trim()}
                </strong>
              </div>
            )
            : null}

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
              description={quoteDescription(quote, lang)}
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
              row is hidden when "No warranty" was chosen — clause 7 then
              says no workmanship warranty is included (REQ-463). */
          }
          {(() => {
            return (
              <section style="margin-top:36px">
                <SectionHeader n={num()} title={t.terms} />
                {
                  /* Always rendered: even a quote without wizard terms
                    keeps a Start row ("To be scheduled") so the schedule
                    seam is visible on every agreement (deck p12). */
                }
                <TermGrid
                  startDate={quote.startDate}
                  estimatedCompletionDate={quote.estimatedCompletionDate}
                  terms={quote.terms}
                  contractorState={contractor?.state}
                  lang={lang}
                  startFallback={t.startTbd}
                  labels={{
                    start: t.start,
                    estCompletion: t.estCompletion,
                    termLabels: t.termLabels,
                  }}
                  // REQ-035 (NW-55): every agreement states the cancelation
                  // notice as a term row, not only inside clause 10.
                  extraRows={[{
                    k: t.termLabels.cancellation,
                    v: t.cancellationValue,
                  }]}
                />
                <div style={`margin-top:22px;height:1px;background:${LINE}`} />
                {
                  /* REQ-035 (NW-55): the 14 notices are an expandable
                    "Terms and Conditions" at the bottom — collapsed on load,
                    one tap to read them all. The PDF stays flat. */
                }
                <details class="ctr__terms-details" data-cy="terms-details">
                  <summary
                    style={`margin-top:18px;cursor:pointer;font-weight:800;font-size:14px;color:${INK}`}
                  >
                    {t.termsAndConditions}
                  </summary>
                  <ol
                    style={`margin:16px 0 0;padding-left:20px;color:${INK};font-size:14px;line-height:1.65`}
                  >
                    {t.clauses.map(([title, body]) => (
                      <li key={title}>
                        <strong>{title}.</strong> {body}
                      </li>
                    ))}
                  </ol>
                </details>
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
                        /* Mirrors the contractor column — bold name, the
                          signature, By: and Date: lines. REQ-205: the
                          customer's own drawn mark (P-40) IS the signature
                          on the accepted document; the cursive typed name
                          stands in only when no mark was stored. */
                      }
                      <div
                        style={`margin-top:2px;font-size:14px;font-weight:800;color:${INK}`}
                      >
                        {customerName ?? quote.acceptedName ?? "—"}
                      </div>
                      {view.signatureImage
                        ? (
                          <img
                            data-cy="quote-signature-image"
                            src={view.signatureImage}
                            alt={tFor(lang, "public.doc.signedBy", {
                              name: quote.acceptedName ?? customerName ?? "",
                            })}
                            style="margin-top:6px;max-height:64px;max-width:240px;object-fit:contain;display:block"
                          />
                        )
                        : (
                          <div
                            style={`margin-top:6px;font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:26px;color:${TEAL};line-height:1.1`}
                          >
                            {quote.acceptedName ?? customerName ?? "—"}
                          </div>
                        )}
                      <div
                        style={`margin-top:6px;font-size:11px;color:${MUTED}`}
                      >
                        {t.by} {quote.acceptedName ?? customerName ?? "—"}
                      </div>
                      <div
                        style={`margin-top:2px;font-size:11px;color:${MUTED}`}
                      >
                        {t.date} {view.acceptedAt
                          ? fmtDate(view.acceptedAt, lang)
                          : t.today}
                      </div>
                    </div>
                  )
                  /* Unsigned: "YOUR Signature" column (deck p14) — the
                     heading, the "Sign & type name below" instruction, and
                     the actual sign pad (PublicSignQuote with its Undo /
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
                      {unready ? null : (
                        <div
                          style={`margin-top:8px;font-size:12px;font-weight:700;color:${TEAL}`}
                        >
                          {customerInstruction}
                        </div>
                      )}
                      {unready
                        ? (
                          // REQ-460 (demo-loop cycle 3, M16): no pad and no
                          // "Sign in person" before it is sent with its terms.
                          <div
                            data-cy="quote-not-ready"
                            role="status"
                            class="ctr__no-print"
                            style="margin-top:12px;background:#f3f6f7;border:1px solid rgba(20,72,82,0.14);border-radius:14px;padding:16px 18px;color:#3d5a60;font-size:13px;line-height:1.5"
                          >
                            <div style="font-weight:800;font-size:14px">
                              {tFor(lang, "public.doc.notReady")}
                            </div>
                            <div style="margin-top:4px">
                              {tFor(lang, "public.doc.notReadyBody")}
                            </div>
                          </div>
                        )
                        : preview
                        ? (
                          <div
                            data-cy="quote-internal-preview"
                            role="status"
                            class="ctr__no-print"
                            style="margin-top:12px;background:#fff6e5;border:1px solid rgba(255,170,40,0.45);border-radius:14px;padding:16px 18px;color:#8a5a10;font-size:13px;line-height:1.5"
                          >
                            <div style="font-weight:800;font-size:14px">
                              {tFor(lang, "public.doc.internalPreview")}
                            </div>
                            <div style="margin-top:4px">
                              {tFor(lang, "public.doc.internalPreviewBody")}
                            </div>
                            {
                              /* REQ-405 (demo m14): a button, not a link —
                                the pad appears in place, no reload. */
                            }
                            <button
                              type="button"
                              data-cy="quote-sign-in-person"
                              onClick={() => onSignInPerson?.()}
                              style="display:inline-block;margin-top:10px;padding:0;background:none;border:0;cursor:pointer;font:inherit;font-weight:700;color:#8a5a10;text-decoration:underline;text-align:left"
                            >
                              {tFor(
                                lang,
                                "public.doc.internalPreviewSignInPerson",
                              )}
                            </button>
                          </div>
                        )
                        : (
                          <PublicSignQuote
                            quoteId={quote.id}
                            version={quote.version}
                            lang={lang}
                            override={quote.internal === true}
                            onSigned={onSigned}
                          />
                        )}
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
                      {
                        /* UX-39 / REQ-403 (m11): promise only a confirmation
                          that can arrive — email, a text to a number whose
                          last text did not fail, else the signed copy + PDF. */
                      }
                      {tFor(lang, signedNoteKey(quote))}
                    </div>
                  </div>
                </div>
              )}
              {
                /* REQ-251 (demo m13): the primary pay hand-off once signed —
                  the first open invoice billed against this agreement. */
              }
              {payNow && (
                <div
                  class="ctr__no-print"
                  style="margin-top:18px;text-align:center"
                >
                  <a
                    data-cy="quote-pay-now"
                    href={withLang(payNow.url, lang)}
                    style={`display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 28px;border-radius:999px;background:${PINK};color:#fff;text-decoration:none;font-weight:800;font-size:16px;box-shadow:0 6px 18px rgba(255,107,107,0.35)`}
                  >
                    {tFor(lang, "quoteDoc.payNow", {
                      amount: fmtMoneyExact(payNow.balanceCents),
                    })}
                  </a>
                </div>
              )}
              {
                /* P-63: the accepted agreement offers the same PDF download
                  the invoice page has (deriveQuoteView emits the URL for
                  every accepted quote). */
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
              {
                /* Still-open quote: decline / ask-a-question secondary
                  actions (audit P5.1). Accepting happens through the pad
                  above — one ceremony — so this panel carries only the
                  other two verbs. */
              }
              {view.pendingSignature && (
                <div class="ctr__no-print">
                  <PublicQuoteActions
                    quoteId={quote.id}
                    contractorFirstName={contractorFirst}
                    customerName={customerName}
                    lang={lang}
                  />
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
                    /* P-63: once accepted, the footer stops asking "Questions
                      before signing?" — deriveQuoteView's footerVariant
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
                      {/* REQ-350: with no phone, "email" opens the sentence */}
                      {contractor?.phoneNumber ? t.emailWord : t.emailWordStart}
                      {" "}
                      {
                        /* P-58: long contractor emails overflowed the 390px
                          viewport — overflow-wrap:anywhere lets the address
                          break mid-string ONLY when it fits no line by itself.
                          REQ-328 (demo p10): no word-break:break-all — that
                          allowed a break between any two characters, so the
                          address split "exampl|e!" at whatever character hit
                          the line end even when the whole address fit the
                          next line. */
                      }
                      <a
                        href={`mailto:${contractor.email}`}
                        style={`color:${TEAL};text-decoration:none;font-weight:700;overflow-wrap:anywhere`}
                      >
                        {contractor.email}
                      </a>
                    </>
                  )}
                  {
                    /* REQ-350: the contact sentence ends here; the closing is
                    its own sentence ("¡Espero poder trabajar contigo!") */
                  }
                  {". "}
                  <span data-cy="quote-contact-close">{t.lookForward}</span>
                </div>
              </div>
            </footer>
          )}
        </div>
      </article>
      {
        /* REQ-205: the documents that belong to this agreement — every
          invoice billed against it (number, state, amount, balance) and the
          approved change orders, plus (REQ-457) the ones waiting for the
          customer's approval — each a link to its own public page. */
      }
      {related.length > 0 && (
        <section
          class="ctr__no-print"
          data-cy="related-documents"
          style={`margin-top:20px;background:#fff;border:1px solid ${LINE};border-radius:16px;padding:16px 20px`}
        >
          <div
            style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
          >
            {tFor(lang, "public.doc.relatedDocuments")}
          </div>
          <div style="margin-top:8px">
            {related.map((r) => (
              <a
                key={`${r.kind}:${r.id}`}
                data-cy={r.kind === "invoice"
                  ? "related-doc-invoice"
                  : "related-doc-change-order"}
                href={withLang(r.url, lang)}
                style={`display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:9px 0;border-bottom:1px solid ${LINE};text-decoration:none;color:${INK};font-size:14px`}
              >
                <span style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">
                  <strong style={`color:${TEAL}`}>{r.number}</strong>
                  <span style={`color:${MUTED};font-size:12.5px`}>
                    {r.stateLabel}
                  </span>
                  {r.description
                    ? (
                      <span style={`color:${MUTED};font-size:12.5px`}>
                        {r.description}
                      </span>
                    )
                    : null}
                </span>
                <span style="text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap">
                  {r.kind === "invoice"
                    ? (
                      <>
                        <strong>{fmtMoneyExact(r.amountCents)}</strong>
                        <span
                          style={`display:block;font-size:11.5px;color:${MUTED}`}
                        >
                          {tFor(lang, "public.doc.balance", {
                            amount: fmtMoneyExact(r.balanceCents),
                          })}
                        </span>
                      </>
                    )
                    : (
                      <strong>
                        {(r.deltaAmountCents ?? 0) >= 0 ? "+" : "−"}
                        {fmtMoneyExact(Math.abs(r.deltaAmountCents ?? 0))}
                      </strong>
                    )}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
      <div
        style={`display:flex;align-items:center;justify-content:center;gap:8px;margin-top:18px;font-size:11px;color:#a8b2b3;letter-spacing:.04em`}
      >
        <img
          src="/logo.png"
          alt=""
          height="16"
          style="height:16px;width:auto;opacity:0.7;display:block"
        />
        {t.poweredBy} {docNumber}
      </div>
    </>
  );
}
