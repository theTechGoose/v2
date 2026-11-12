import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { ssrBackendGetAuthed } from "../../lib/backend-fetch.ts";
import { getSessionId } from "../../lib/auth.ts";
import { fmtMoneyExact, fmtPhone, telHref } from "../../lib/format.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import {
  langToggleHref,
  resolvePublicLang,
} from "../../../shared/quote-flow/public-lang.ts";
import { projectLineItems } from "../../../shared/quote-flow/public-doc-state.ts";
import { localizeLineItems } from "../../../shared/quote-flow/quote-translations.ts";
import {
  claimedNoteKey,
  type ReceiptChannel,
  receiptChannelOf,
} from "../../../shared/documents/receipt-note.ts";
import {
  fmtVisitDate,
  type VisitGroup,
} from "../../../shared/quote-flow/visit-groups.ts";
import PublicInvoiceClaim from "../../islands/PublicInvoiceClaim.tsx";
import PublicInvoiceRefresh from "../../islands/PublicInvoiceRefresh.tsx";
import OwnerClaimReview from "../../islands/OwnerClaimReview.tsx";
import PublicLangToggle from "../../islands/PublicLangToggle.tsx";
import {
  invoiceHeadline,
  shortDate,
  stateLabel,
} from "../../../shared/documents/linked-view.ts";
import { receivedNoteBody } from "../../../shared/documents/received-note.ts";
import { receiptSentViaOf } from "../../../shared/documents/delivery-truth.ts";
import { claimRejectedNote } from "../../../shared/documents/claim-rejected-note.ts";
import {
  ownerClaimNote,
  ownerClaimNoteShown,
} from "../../../shared/documents/owner-claim-note.ts";
import {
  BG,
  computeMilestones,
  fmtDate,
  GREEN,
  hasTermGrid,
  INK,
  JobDetailsSection,
  LINE,
  type LineItem,
  MUTED,
  PartyCard,
  PaymentScheduleSection,
  PINK,
  PINK_DARK,
  SectionHeader,
  sumLineTotals,
  TEAL,
  type Term,
  TermGrid,
} from "../../components/doc-parts.tsx";

interface Contractor {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  addressLine?: string;
  /** REQ-168: the business website, shown as a link under the address. */
  websiteUrl?: string;
  /** 2-letter state code — expands governing-law / state-notices term values
   *  to customer-readable text in the term grid (matches the agreement page). */
  state?: string;
  acceptedPaymentMethods?: Record<string, { enabled?: boolean }>;
  /** Outgoing-comms language (roadmap p.13) — drives this page's copy. */
  commsLanguage?: string;
  /** True when the contractor uploaded a business logo (roadmap p.2). */
  hasLogo?: boolean;
}

interface InvoicePublic {
  /** REQ-479 (demo M30): the viewer is the business itself (owner, admin,
   *  staff impersonating) — a preview, not the customer. */
  internal?: boolean;
  id: string;
  /** REQ-198/201: the document's number ("INV-5000"), version and headline state. */
  number?: string;
  version?: number;
  state?: string;
  publishedAt?: string;
  /** REQ-202: one current balance, whatever page is open. */
  paidCents?: number;
  balanceCents?: number;
  overpaidCents?: number;
  /** REQ-205: the agreement this bill belongs to, by number. */
  quote?: {
    id: string;
    number: string;
    url: string;
    version?: number;
    accepted?: boolean;
    signedAt?: string;
  };
  changeOrders?: Array<{
    id: string;
    number: string;
    url: string;
    status?: string;
    description?: string;
    deltaAmountCents: number;
    approvedName?: string;
  }>;
  /** REQ-206: a standalone invoice is complete on its own. */
  subtotalCents?: number;
  taxRateBp?: number;
  taxCents?: number;
  discountCents?: number;
  discountReason?: string;
  serviceAddress?: string;
  serviceDateFrom?: string;
  serviceDateTo?: string;
  paymentInstructions?: string;
  netDays?: number;
  /** REQ-173: a batch invoice's visits, grouped under their address */
  visits?: VisitGroup[];
  quoteId?: string;
  customerId?: string;
  status?: string;
  amount?: number;
  dueDate?: string;
  issuedDate?: string;
  paidAt?: string;
  installmentIndex?: number;
  installmentTotal?: number;
  paymentIntent?: {
    method: string;
    amount: number;
    reference?: string;
    claimedAt: string;
    claimedBy?: string;
  };
  /** REQ-488: the contractor said the last claim never arrived. */
  claimRejectedAt?: string;
  claimRejectedMethod?: string;
  contractor?: Contractor;
  customer?: {
    name?: string;
    email?: string;
    phoneNumber?: string;
    businessName?: string;
    address?: string;
  };
  jobDetails?: {
    summary?: string;
    jobName?: string;
    description?: string;
    jobNameByLang?: Record<string, string>;
    summaryByLang?: Record<string, string>;
    descriptionByLang?: Record<string, string>;
    /** Per-language line-item descriptions, positionally aligned with
     *  `lineItems`. */
    lineItemsByLang?: Record<string, string[]>;
    lineItems?: LineItem[];
  };
  /** Agreement context mirrored from the linked quote (quote-linked
   *  invoices only) — lets the doc show the same itemized job + term grid as
   *  the signed agreement, minus the legal clauses + signature. */
  agreementTotal?: number;
  terms?: Term[];
  startDate?: string;
  estimatedCompletionDate?: string;
  effectiveDate?: string;
  /** "/q/<quoteId>" — present only once the linked quote is accepted. */
  signedQuoteUrl?: string;
  signedAgreement?: { id: string; signedAt?: string };
  siblings?: Array<{
    id: string;
    /** REQ-205: the sibling's own number and public link */
    number?: string;
    url?: string;
    amount?: number;
    status?: string;
    paidAt?: string;
    installmentIndex?: number;
    installmentTotal?: number;
  }>;
  acceptedMethods?: Array<{ method: string; handle?: string }>;
  /** REQ-523 (demo m16): where the payment receipt can arrive — "email",
   *  "text" (a number that can take one) or "none". */
  receiptChannel?: string;
  /** REQ-556 (demo-loop cycle 4, M7): where the paid receipt actually went —
   *  "email" | "text" | "none" (absent on invoices paid before it was kept). */
  receiptSentVia?: string;
}

export default define.page(async function PublicInvoice(ctx) {
  const id = ctx.params.id;
  // REQ-479 (demo M30): the read carries the viewer's session, so the
  // backend can tell the business's own preview from the customer.
  const r = await ssrBackendGetAuthed<InvoicePublic>(
    `/invoices/${id}/public`,
    getSessionId(ctx.req),
  );
  const invoice = r.ok ? r.data : undefined;
  // Chrome language — REQ-272: the link's ?lang= (the EN | ES toggle below)
  // first, then the visitor's own saved choice (pm_lang cookie), over the
  // document's generation language (P-12). The claim + change-order islands
  // below receive this same resolved language.
  const url = new URL(ctx.req.url);
  const lang: Lang = resolvePublicLang({
    query: url.searchParams.get("lang"),
    cookie: ctx.req.headers.get("cookie"),
    docLang: invoice?.contractor?.commsLanguage,
    header: ctx.req.headers.get("accept-language"),
  });
  const err = r.ok ? undefined : tFor(lang, "publicInvoice.error.expired");
  // <html lang> says what this page actually paints (REQ-122 contract).
  ctx.state.lang = lang;

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => tFor(l, "publicInvoice.docTitle")}
        />
        <link key="css-landing" rel="stylesheet" href={asset("/landing.css")} />
        <link
          key="css-public-lang"
          rel="stylesheet"
          href={asset("/public-lang.css")}
        />
      </Head>
      <div
        style={`min-height:100dvh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};display:flex;flex-direction:column;scroll-padding-bottom:var(--kb-inset, 0px)`}
      >
        <div style="flex:1;width:100%;max-width:712px;margin:0 auto;padding:32px 16px calc(64px + var(--kb-inset, 0px))">
          {/* REQ-272: the same EN | ES switch the contract has (REQ-048) */}
          <PublicLangToggle
            lang={lang}
            hrefs={{
              en: langToggleHref(url.href, "en"),
              es: langToggleHref(url.href, "es"),
            }}
          />
          {err || !invoice
            ? (
              <ErrorCard
                message={err ?? tFor(lang, "publicInvoice.error.notAvailable")}
                lang={lang}
              />
            )
            : <InvoiceDoc invoice={invoice} lang={lang} search={url.search} />}
        </div>
        <SiteFooter lang={lang} document />
      </div>
    </>
  );
});

function ErrorCard({ message, lang }: { message: string; lang: Lang }) {
  return (
    <>
      <div
        style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN};text-align:center;margin-bottom:18px`}
      >
        {tFor(lang, "brand.name")}
      </div>
      <div
        style={`background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center`}
      >
        <div style={`font-weight:800;color:${TEAL};font-size:18px`}>
          {tFor(lang, "publicInvoice.error.heading")}
        </div>
        <p style={`margin:8px 0 0;color:${MUTED};font-size:14px`}>{message}</p>
      </div>
    </>
  );
}

/** REQ-168: "https://a2zlandscape.com/" → "a2zlandscape.com" */
function siteLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function InvoiceDoc(
  { invoice, lang, search }: {
    invoice: InvoicePublic;
    lang: Lang;
    /** REQ-479: the page's query, for the claim's in-person override. */
    search: string;
  },
) {
  const paid = invoice.status === "paid" || !!invoice.paidAt;
  const claimed = invoice.status === "claimed" && !!invoice.paymentIntent;
  const pastDue = !paid && !claimed && isPastDue(invoice.dueDate);
  const es = lang === "es";
  const contractorFirst = invoice.contractor?.name?.split(/\s+/)[0];
  const businessLabel = invoice.contractor?.businessName?.trim() ||
    invoice.contractor?.name?.trim() ||
    tFor(lang, "brand.name");
  const jobName =
    (invoice.jobDetails?.jobNameByLang?.[lang] ?? invoice.jobDetails?.jobName)
      ?.trim() ||
    (invoice.jobDetails?.summaryByLang?.[lang] ?? invoice.jobDetails?.summary)
      ?.trim() ||
    tFor(lang, "publicInvoice.jobNameFallback");
  const idx = invoice.installmentIndex;
  const total = invoice.installmentTotal;
  const milestoneLabel = idx && total
    ? milestoneTitle(idx, total, es)
    : undefined;
  const paidSoFar = (invoice.siblings ?? [])
    .filter((s) =>
      s.id !== invoice.id &&
      (s.status === "paid" || (s as { paidAt?: string }).paidAt)
    )
    .map((s) => ({
      amount: s.amount ?? 0,
      index: s.installmentIndex,
      number: s.number,
    }));
  // REQ-205: the other installments of the same agreement, by number
  const otherInstallments = (invoice.siblings ?? []).filter((s) =>
    s.id !== invoice.id
  );
  // REQ-201/202: "INV-5000 · Version 2 · Revised invoice — replaces previous
  // version" / "· Paid", and the one current balance.
  const docNumber = invoice.number ??
    `#${invoice.id.slice(0, 8).toUpperCase()}`;
  const headline = invoiceHeadline(
    {
      number: docNumber,
      version: invoice.version ?? 1,
      state: invoice.state ?? (paid ? "paid" : claimed ? "claimed" : "sent"),
      date: paid ? invoice.paidAt : invoice.publishedAt,
    },
    lang,
  );
  const amountCents = invoice.amount ?? 0;
  const paidCents = invoice.paidCents ?? (paid ? amountCents : 0);
  const balanceCents = invoice.balanceCents ??
    Math.max(0, amountCents - paidCents);
  const overpaidCents = invoice.overpaidCents ?? 0;
  const serviceDates = invoice.serviceDateFrom || invoice.serviceDateTo
    ? [invoice.serviceDateFrom, invoice.serviceDateTo]
      .filter((d): d is string => !!d)
      .map((d) => fmtDate(d, lang))
      .join(" → ")
    : undefined;
  const hasExtras = !!(invoice.serviceAddress || serviceDates ||
    invoice.paymentInstructions || invoice.taxCents || invoice.discountCents ||
    invoice.subtotalCents);

  // Agreement mirror — for quote-linked invoices getInvoicePublic projects the
  // linked quote's line items, total, and term grid. A standalone invoice
  // carries its own line items in the same field (REQ-487) and no agreement.
  // The itemized job in the BILL's language (descriptions only — the money
  // is language-neutral).
  // REQ-264 (M15): each line's server-filled translation first.
  const items = projectLineItems(
    localizeLineItems(invoice.jobDetails?.lineItems, lang),
    invoice.jobDetails?.lineItemsByLang,
    lang,
  );
  const agreementTotal = invoice.agreementTotal ??
    (items.length ? sumLineTotals(items) : undefined);
  const milestones = agreementTotal
    ? computeMilestones(agreementTotal, invoice.terms, lang)
    : [];
  // PDF p6: the invoice mirrors the quote's info (job name, details, line
  // items, total) but NEVER the numbered Terms grid nor any signature block —
  // those live on the signed agreement, which is linked BELOW the document
  // instead (outside [data-cy=invoice-doc] so no signature wording ever
  // renders inside the invoice itself, in either language).
  const rich = items.length > 0 || agreementTotal != null;
  let sec = 0;
  const num = () => String(++sec).padStart(2, "0");

  return (
    <>
      <article
        data-cy="invoice-doc"
        style={`background:#fff;border-radius:24px;box-shadow:0 14px 50px rgba(20,72,82,0.10);overflow:hidden;border:1px solid rgba(255,107,107,0.10)`}
      >
        <div
          style={`height:8px;background:linear-gradient(90deg,${PINK} 0%,${PINK_DARK} 100%)`}
        />
        <div style="padding:32px 36px 36px">
          {/* Eyebrow */}
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
            <div>
              {invoice.contractor?.hasLogo
                ? (
                  <img
                    src={`/api/public-logo/invoice/${invoice.id}`}
                    alt=""
                    style="max-height:44px;max-width:150px;object-fit:contain;display:block;margin-bottom:8px;border-radius:8px"
                  />
                )
                : null}
              <div
                style={`font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${PINK_DARK}`}
              >
                {businessLabel}
              </div>
              {/* REQ-201: number · version · state (· date) */}
              <div
                data-cy="invoice-headline"
                style={`margin-top:6px;font-size:13px;font-weight:800;color:${TEAL}`}
              >
                {headline}
              </div>
              {invoice.contractor?.addressLine
                ? (
                  <div style={`margin-top:3px;font-size:12px;color:${MUTED}`}>
                    {invoice.contractor.addressLine}
                  </div>
                )
                : null}
              {invoice.contractor?.websiteUrl
                ? (
                  <a
                    data-cy="invoice-website"
                    href={invoice.contractor.websiteUrl}
                    style={`display:inline-block;margin-top:3px;font-size:12px;color:${TEAL};text-decoration:none;font-weight:700`}
                  >
                    {siteLabel(invoice.contractor.websiteUrl)}
                  </a>
                )
                : null}
            </div>
            <StatusPill
              paid={paid}
              claimed={claimed}
              pastDue={pastDue}
              es={es}
            />
          </div>

          {/* Hero */}
          <h1
            style={`margin:18px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:32px;letter-spacing:-0.025em;color:${TEAL};line-height:1.1`}
          >
            {jobName}
          </h1>
          {milestoneLabel
            ? (
              <div style={`margin-top:6px;color:${MUTED};font-size:14px`}>
                {milestoneLabel}
              </div>
            )
            : null}

          {
            /* Standalone job description (quote-less invoices) — the itemized
            job-details section below only renders for quote-linked invoices, so
            carry the contractor's note here when it's absent. */
          }
          {/* REQ-173: a batch invoice — the address is the heading, the visits sit under it */}
          {invoice.visits?.length
            ? (
              <section data-cy="invoice-visits" style="margin-top:18px">
                {invoice.visits.map((g) => (
                  <div style="margin-top:14px">
                    <h2
                      data-cy="invoice-visit-address"
                      style={`margin:0;font-size:15px;font-weight:800;color:${TEAL};letter-spacing:-0.01em`}
                    >
                      {g.address}
                    </h2>
                    <div style={`margin-top:6px;border-top:1px solid ${LINE}`}>
                      {g.visits.map((v) => (
                        <div
                          data-cy="invoice-visit"
                          style={`display:flex;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px`}
                        >
                          <span
                            style={`flex:0 0 64px;color:${MUTED};font-variant-numeric:tabular-nums`}
                          >
                            {fmtVisitDate(v.date, lang)}
                          </span>
                          <span style={`flex:1;color:${INK};font-weight:600`}>
                            {v.service}
                          </span>
                          <span
                            style={`color:${INK};font-variant-numeric:tabular-nums`}
                          >
                            {fmtMoneyExact(v.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )
            : null}
          {!rich && !invoice.visits?.length &&
              (invoice.jobDetails?.descriptionByLang?.[lang] ??
                invoice.jobDetails?.description)
            ? (
              <p
                style={`margin:14px 0 0;color:${INK};font-size:15px;line-height:1.6;white-space:pre-wrap`}
              >
                {invoice.jobDetails?.descriptionByLang?.[lang] ??
                  invoice.jobDetails?.description}
              </p>
            )
            : null}

          {
            /* Bill to / From — on every invoice, standalone ones included
              (REQ-487, demo m58). `customer` is the bill-to snapshot, else
              the CRM record (getInvoicePublic). */
          }
          <section
            data-cy="invoice-parties"
            style="margin-top:22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px"
          >
            <PartyCard
              role={tFor(lang, "publicInvoice.billTo")}
              name={invoice.customer?.name}
              businessName={invoice.customer?.businessName}
              email={invoice.customer?.email}
              phone={invoice.customer?.phoneNumber}
              address={invoice.customer?.address}
            />
            <PartyCard
              role={tFor(lang, "quoteDoc.from")}
              name={invoice.contractor?.name}
              businessName={invoice.contractor?.businessName}
              email={invoice.contractor?.email}
              phone={invoice.contractor?.phoneNumber}
              address={invoice.contractor?.addressLine}
            />
          </section>

          {
            /* Balance block (REQ-202): Amount, Paid, Balance due — one
              current balance whatever page is open; an overpayment is
              flagged, never hidden. */
          }
          <div
            data-cy="invoice-balance-block"
            style={`margin-top:22px;background:linear-gradient(135deg,#e8f3e2 0%,#dceadb 100%);border:1px solid rgba(81,152,67,0.25);border-radius:18px;padding:22px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap`}
          >
            <div>
              <div
                style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}
              >
                {paid
                  ? tFor(lang, "status.paid")
                  : tFor(lang, "public.doc.balanceDue")}
              </div>
              {invoice.dueDate
                ? (
                  <div style={`margin-top:4px;color:${MUTED};font-size:12px`}>
                    {paid
                      ? tFor(lang, "publicInvoice.paidOn", {
                        date: fmtDate(invoice.paidAt ?? "", lang),
                      })
                      : tFor(lang, "publicInvoice.dueOn", {
                        date: fmtDate(invoice.dueDate, lang),
                      })}
                  </div>
                )
                : null}
              <div
                style={`margin-top:8px;display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:${INK}`}
              >
                <span data-cy="invoice-amount">
                  {tFor(lang, "public.doc.amountLabel")}{" "}
                  <strong style="font-variant-numeric:tabular-nums">
                    {fmtMoneyExact(amountCents)}
                  </strong>
                </span>
                <span data-cy="invoice-paid">
                  {tFor(lang, "public.doc.paidLabel")}{" "}
                  <strong style="font-variant-numeric:tabular-nums">
                    {fmtMoneyExact(paidCents)}
                  </strong>
                </span>
              </div>
              {overpaidCents > 0
                ? (
                  <div
                    data-cy="invoice-overpaid"
                    style="margin-top:6px;font-size:12.5px;font-weight:800;color:#a83b3b"
                  >
                    {tFor(lang, "public.doc.overpaid", {
                      amount: fmtMoneyExact(overpaidCents),
                    })}
                  </div>
                )
                : null}
            </div>
            <div
              data-cy="invoice-balance-due"
              style={`font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:38px;letter-spacing:-0.03em;color:${TEAL};line-height:1;font-variant-numeric:tabular-nums`}
            >
              {fmtMoneyExact(paid ? amountCents : balanceCents)}
            </div>
          </div>

          {
            /* REQ-206: what a standalone invoice carries on its own —
              where the work was done, when, how to pay, and the tax /
              discount lines. Rendered only when present. */
          }
          {hasExtras
            ? (
              <section
                data-cy="invoice-extras"
                style={`margin-top:18px;border:1px solid ${LINE};border-radius:14px;padding:14px 18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;font-size:14px`}
              >
                {invoice.serviceAddress
                  ? (
                    <div data-cy="invoice-service-address">
                      <div
                        style={`font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}`}
                      >
                        {tFor(lang, "public.doc.serviceAddress")}
                      </div>
                      <div style={`margin-top:3px;color:${INK}`}>
                        {invoice.serviceAddress}
                      </div>
                    </div>
                  )
                  : null}
                {serviceDates
                  ? (
                    <div data-cy="invoice-service-dates">
                      <div
                        style={`font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}`}
                      >
                        {tFor(lang, "public.doc.serviceDates")}
                      </div>
                      <div style={`margin-top:3px;color:${INK}`}>
                        {serviceDates}
                      </div>
                    </div>
                  )
                  : null}
                {invoice.paymentInstructions
                  ? (
                    <div
                      data-cy="invoice-payment-instructions"
                      style="grid-column:1 / -1"
                    >
                      <div
                        style={`font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}`}
                      >
                        {tFor(lang, "public.doc.paymentInstructions")}
                      </div>
                      <div
                        style={`margin-top:3px;color:${INK};white-space:pre-wrap`}
                      >
                        {invoice.paymentInstructions}
                      </div>
                    </div>
                  )
                  : null}
                {(invoice.subtotalCents || invoice.taxCents ||
                    invoice.discountCents)
                  ? (
                    <div
                      data-cy="invoice-tax-lines"
                      style="grid-column:1 / -1;display:flex;flex-direction:column;gap:4px"
                    >
                      {invoice.subtotalCents != null
                        ? (
                          <div style="display:flex;justify-content:space-between">
                            <span style={`color:${MUTED}`}>
                              {tFor(lang, "public.doc.subtotal")}
                            </span>
                            <span style="font-variant-numeric:tabular-nums">
                              {fmtMoneyExact(invoice.subtotalCents)}
                            </span>
                          </div>
                        )
                        : null}
                      {invoice.discountCents
                        ? (
                          <div style="display:flex;justify-content:space-between">
                            <span style={`color:${MUTED}`}>
                              {tFor(lang, "public.doc.discount")}
                              {invoice.discountReason
                                ? ` · ${invoice.discountReason}`
                                : ""}
                            </span>
                            <span
                              style={`color:${GREEN};font-variant-numeric:tabular-nums`}
                            >
                              −{fmtMoneyExact(invoice.discountCents)}
                            </span>
                          </div>
                        )
                        : null}
                      {invoice.taxCents
                        ? (
                          <div style="display:flex;justify-content:space-between">
                            <span style={`color:${MUTED}`}>
                              {tFor(lang, "public.doc.tax")}
                              {invoice.taxRateBp
                                ? ` (${(invoice.taxRateBp / 100).toFixed(2)}%)`
                                : ""}
                            </span>
                            <span style="font-variant-numeric:tabular-nums">
                              {fmtMoneyExact(invoice.taxCents)}
                            </span>
                          </div>
                        )
                        : null}
                    </div>
                  )
                  : null}
              </section>
            )
            : null}

          {/* Paid-so-far strip — only when there's prior installments paid. */}
          {paidSoFar.length > 0
            ? (
              <section style="margin-top:24px">
                <div
                  style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                >
                  {tFor(lang, "publicInvoice.paidSoFar")}
                </div>
                <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
                  {paidSoFar.map((p, i) => (
                    <span
                      key={i}
                      style={`background:rgba(81,152,67,0.10);color:${GREEN};font-size:12px;font-weight:700;padding:6px 12px;border-radius:999px`}
                    >
                      {p.number
                        ? `${p.number} · `
                        : p.index
                        ? `#${p.index} · `
                        : ""}
                      {fmtMoneyExact(p.amount)}
                    </span>
                  ))}
                </div>
              </section>
            )
            : null}

          {/* Already-claimed strip OR active pay UI */}
          {paid
            ? (
              <ReceivedNote
                paidAt={invoice.paidAt}
                channel={receiptSentViaOf(invoice.receiptSentVia) ??
                  receiptChannelOf(invoice)}
                contractorFirst={invoice.contractor?.name?.split(/\s+/)[0]}
                es={es}
              />
            )
            : claimed
            ? (
              <>
                {
                  /* REQ-557 (demo M25): the business's own preview of a
                  claimed invoice is addressed to her — who says they paid,
                  and Confirm received / Didn't get it. The customer keeps
                  their own note. */
                }
                {ownerClaimNoteShown(invoice, search)
                  ? <OwnerClaimedNote invoice={invoice} lang={lang} />
                  : (
                    <ClaimedNote
                      invoice={invoice}
                      contractorFirst={contractorFirst}
                      es={es}
                    />
                  )}
                {
                  /* REQ-321 (demo M14): this page mounts no claim island, so it
                  re-reads the invoice itself — the owner's confirm flips it to
                  PAID without a manual reload. */
                }
                <PublicInvoiceRefresh
                  invoiceId={invoice.id}
                  status={invoice.status}
                  version={invoice.version}
                />
              </>
            )
            : (
              <>
                {
                  /* REQ-488 (demo m56): the contractor answered the last
                  claim with "Didn't get it" — say so, and where to check. */
                }
                <ClaimRejectedNote invoice={invoice} lang={lang} />
                <PublicInvoiceClaim
                  invoiceId={invoice.id}
                  acceptedMethods={invoice.acceptedMethods ?? []}
                  customerName={invoice.customer?.name}
                  receiptChannel={receiptChannelOf(invoice)}
                  balanceCents={balanceCents}
                  version={invoice.version}
                  lang={es ? "es" : "en"}
                  internal={invoice.internal === true}
                  status={invoice.status}
                  search={search}
                />
              </>
            )}

          {
            /* What this invoice covers — mirrors the signed agreement, minus the
            14 legal clauses + the signature block. A standalone invoice shows
            its own line items here (REQ-487). */
          }
          {rich
            ? (
              <>
                {items.length > 0 && (
                  <JobDetailsSection
                    n={num()}
                    title={tFor(lang, "quoteDoc.jobDetails")}
                    description={invoice.jobDetails?.descriptionByLang
                      ?.[lang] ??
                      invoice.jobDetails?.description}
                    items={items}
                    total={agreementTotal ?? sumLineTotals(items)}
                    // The itemized DESCRIPTION/AMOUNT table is the invoice
                    // standard — always rendered, single-line jobs included.
                    forceTable
                    // But totals never repeat: the agreement-value card only
                    // renders when it DIFFERS from this invoice's amount
                    // (i.e. this bill is one installment of a larger job) —
                    // the amount-due card up top is the single total.
                    // A standalone bill (REQ-487) has no agreement at all.
                    showTotal={invoice.agreementTotal != null &&
                      invoice.agreementTotal !== invoice.amount}
                    labels={{
                      tableDescription: tFor(
                        lang,
                        "quoteDoc.tableDescription",
                      ),
                      tableQty: tFor(lang, "quoteDoc.tableQty"),
                      tableAmount: tFor(lang, "quoteDoc.tableAmount"),
                      unitEach: tFor(lang, "quoteDoc.unitEach"),
                      valueLabel: tFor(lang, "quoteDoc.agreementValue"),
                      valueSub: tFor(lang, "quoteDoc.allIn"),
                    }}
                  />
                )}
                {
                  /* Wizard-captured terms (start / time to complete /
                    payment / warranty) mirrored from the agreement — the
                    numbered legal clauses and signatures stay on /q only. */
                }
                {hasTermGrid(invoice) && (
                  <section style="margin-top:36px">
                    <SectionHeader
                      n={num()}
                      title={tFor(lang, "quoteDoc.terms")}
                    />
                    <TermGrid
                      startDate={invoice.startDate}
                      estimatedCompletionDate={invoice
                        .estimatedCompletionDate}
                      terms={invoice.terms}
                      contractorState={invoice.contractor?.state}
                      lang={lang}
                      labels={{
                        start: tFor(lang, "quoteDoc.start"),
                        estCompletion: tFor(lang, "quoteDoc.estCompletion"),
                        termLabels: {
                          customer: tFor(lang, "quoteDoc.termLabel.customer"),
                          start_date: tFor(
                            lang,
                            "quoteDoc.termLabel.startDate",
                          ),
                          wraps: tFor(lang, "quoteDoc.termLabel.wraps"),
                          payment_terms: tFor(
                            lang,
                            "quoteDoc.termLabel.paymentTerms",
                          ),
                          warranty: tFor(lang, "quoteDoc.termLabel.warranty"),
                        },
                      }}
                    />
                  </section>
                )}
                {milestones.length > 1 && (
                  <PaymentScheduleSection
                    n={num()}
                    title={tFor(lang, "quoteDoc.paymentSchedule")}
                    milestones={milestones}
                  />
                )}
              </>
            )
            : null}

          {
            /* REQ-205: the change orders on this bill, by number, each a
              link to its own page — approved ones already moved the total. */
          }
          {invoice.changeOrders?.length
            ? (
              <section data-cy="invoice-change-orders" style="margin-top:24px">
                <div
                  style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                >
                  {tFor(lang, "public.doc.changeOrders")}
                </div>
                <div style="margin-top:6px">
                  {invoice.changeOrders.map((co) => (
                    <a
                      key={co.id}
                      data-cy="invoice-change-order"
                      href={co.url}
                      style={`display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px solid ${LINE};text-decoration:none;color:${INK};font-size:14px`}
                    >
                      <span style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">
                        <strong style={`color:${TEAL}`}>{co.number}</strong>
                        <span style={`color:${MUTED};font-size:12.5px`}>
                          {stateLabel(co.status ?? "pending", lang)}
                        </span>
                        {co.description
                          ? (
                            <span style={`color:${MUTED};font-size:12.5px`}>
                              {co.description}
                            </span>
                          )
                          : null}
                      </span>
                      <strong style="font-variant-numeric:tabular-nums;white-space:nowrap">
                        {co.deltaAmountCents >= 0 ? "+" : "−"}
                        {fmtMoneyExact(Math.abs(co.deltaAmountCents))}
                      </strong>
                    </a>
                  ))}
                </div>
              </section>
            )
            : null}

          {/* REQ-205: the other installments of the same agreement, by number */}
          {otherInstallments.length > 0
            ? (
              <section data-cy="invoice-installments" style="margin-top:24px">
                <div
                  style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                >
                  {tFor(lang, "public.doc.installments")}
                </div>
                <div style="margin-top:6px">
                  {otherInstallments.map((s) => (
                    <a
                      key={s.id}
                      data-cy="invoice-installment"
                      href={s.url ?? `/i/${s.id}`}
                      style={`display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px solid ${LINE};text-decoration:none;color:${INK};font-size:14px`}
                    >
                      <span style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">
                        <strong style={`color:${TEAL}`}>
                          {s.number ?? `#${s.id.slice(0, 8).toUpperCase()}`}
                        </strong>
                        <span style={`color:${MUTED};font-size:12.5px`}>
                          {s.status === "paid" || s.paidAt
                            ? tFor(lang, "status.paid")
                            : stateLabel(
                              s.status === "claimed" ? "claimed" : "sent",
                              lang,
                            )}
                        </span>
                        {s.paidAt
                          ? (
                            <span style={`color:${MUTED};font-size:12.5px`}>
                              {shortDate(s.paidAt, lang)}
                            </span>
                          )
                          : null}
                      </span>
                      <strong style="font-variant-numeric:tabular-nums;white-space:nowrap">
                        {fmtMoneyExact(s.amount)}
                      </strong>
                    </a>
                  ))}
                </div>
              </section>
            )
            : null}

          {
            /* Download PDF — works for any invoice (mirrors the agreement,
            minus clauses + signature) */
          }
          <div style="margin-top:24px;text-align:center">
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
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
              {tFor(lang, "publicInvoice.downloadPdf")}
            </a>
          </div>

          {/* Contact footer — REQ-169: thank the customer for trusting the business, then where to turn */}
          <footer
            style={`margin-top:30px;padding-top:22px;border-top:1px solid ${LINE};color:${INK};font-size:14px;line-height:1.5`}
          >
            <p data-cy="invoice-thanks" style="margin:0 0 10px">
              {tFor(lang, "publicInvoice.footer.thanks", {
                business: businessLabel,
              })}
            </p>
            {(invoice.contractor?.phoneNumber || invoice.contractor?.email)
              ? (
                <p style="margin:0">
                  {
                    /* REQ-499 (demo p6): the lead-in follows the status, so a
                      paid invoice never asks for questions "before paying" —
                      on a reload too, not only after an in-session claim. */
                  }
                  <span data-invoice-question>
                    {tFor(
                      lang,
                      paid
                        ? "publicInvoice.footer.questionsPaid"
                        : claimed
                        ? "publicInvoice.footer.questionsClaimed"
                        : "publicInvoice.footer.questions",
                    )}
                  </span>{" "}
                  {invoice.contractor.phoneNumber
                    ? (
                      <>
                        {tFor(lang, "publicInvoice.footer.call")}{" "}
                        <a
                          href={telHref(invoice.contractor.phoneNumber)}
                          style={`color:${TEAL};text-decoration:none;font-weight:700;white-space:nowrap`}
                        >
                          {fmtPhone(invoice.contractor.phoneNumber)}
                        </a>
                      </>
                    )
                    : null}
                  {invoice.contractor.phoneNumber && invoice.contractor.email
                    ? tFor(lang, "publicInvoice.footer.or")
                    : ""}
                  {invoice.contractor.email
                    ? (
                      <>
                        {tFor(lang, "publicInvoice.footer.email")}{" "}
                        <a
                          href={`mailto:${invoice.contractor.email}`}
                          style={`color:${TEAL};text-decoration:none;font-weight:700`}
                        >
                          {invoice.contractor.email}
                        </a>
                      </>
                    )
                    : null}
                  {tFor(lang, "publicInvoice.footer.closing")}
                </p>
              )
              : null}
          </footer>
        </div>
        <div
          style={`display:flex;align-items:center;justify-content:center;gap:8px;padding:16px;font-size:11px;color:#a8b2b3;letter-spacing:.04em`}
        >
          <img
            src="/logo.png"
            alt=""
            height="16"
            style="height:16px;width:auto;opacity:0.7;display:block"
          />
          {tFor(lang, "public.doc.poweredByInvoice", { number: docNumber })}
        </div>
      </article>

      {
        /* REQ-205: "Original quote: Q-001" — the agreement this bill belongs
        to, by number, whether or not it is signed yet (signed adds the date).
        Rendered OUTSIDE [data-cy=invoice-doc] — the invoice document itself
        carries no signature language in any language. Pre-numbering rows
        keep the old signed-agreement link. */
      }
      {(invoice.quote || invoice.signedQuoteUrl || invoice.signedAgreement)
        ? (
          <div style="margin-top:20px;display:flex;justify-content:center">
            <a
              data-cy={invoice.quote
                ? "invoice-quote-link"
                : "invoice-signed-quote-link"}
              href={invoice.quote?.url ?? invoice.signedQuoteUrl ??
                `/c/${invoice.signedAgreement!.id}`}
              style={`display:inline-flex;align-items:center;gap:10px;padding:13px 18px;border:1px solid ${LINE};border-radius:12px;background:#fff;color:${TEAL};text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 6px 22px rgba(20,72,82,0.06)`}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="m9 15 2 2 4-4" />
              </svg>
              <span>
                {invoice.quote
                  ? tFor(lang, "public.doc.originalQuote", {
                    number: invoice.quote.number,
                  })
                  : tFor(lang, "publicInvoice.viewSignedAgreement")}
                {(invoice.quote?.signedAt ?? invoice.signedAgreement?.signedAt)
                  ? (
                    <span
                      style={`display:block;font-weight:600;font-size:12px;color:${MUTED}`}
                    >
                      {tFor(lang, "publicInvoice.signedOn", {
                        date: fmtDate(
                          (invoice.quote?.signedAt ??
                            invoice.signedAgreement?.signedAt)!,
                          lang,
                        ),
                      })}
                    </span>
                  )
                  : null}
              </span>
            </a>
          </div>
        )
        : null}
    </>
  );
}

function StatusPill(
  { paid, claimed, pastDue, es }: {
    paid: boolean;
    claimed: boolean;
    pastDue: boolean;
    es: boolean;
  },
) {
  const lang = es ? "es" : "en";
  if (paid) {
    return (
      <Pill
        bg={`rgba(81,152,67,0.15)`}
        color={GREEN}
        label={tFor(lang, "status.paid")}
      />
    );
  }
  if (claimed) {
    return (
      <Pill
        bg={`rgba(255,170,40,0.15)`}
        color="#a06800"
        label={tFor(lang, "publicInvoice.status.awaitingConfirmation")}
      />
    );
  }
  if (pastDue) {
    return (
      <Pill
        bg={`rgba(168,59,59,0.10)`}
        color="#a83b3b"
        label={tFor(lang, "publicInvoice.status.pastDue")}
      />
    );
  }
  return (
    <Pill
      bg={`rgba(255,107,107,0.10)`}
      color={PINK_DARK}
      label={tFor(lang, "publicInvoice.status.due")}
    />
  );
}

function Pill(
  { bg, color, label }: { bg: string; color: string; label: string },
) {
  return (
    <span
      // UX-35: stable hook so the claim island can flip the SSR badge
      // in place the moment the customer claims (no manual reload).
      data-status-pill
      style={`background:${bg};color:${color};font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px`}
    >
      {label}
    </span>
  );
}

/** REQ-557 (demo M25): the claimed note for the business's own viewer —
 *  who says they paid, with Confirm received / Didn't get it. */
function OwnerClaimedNote(
  { invoice, lang }: { invoice: InvoicePublic; lang: Lang },
) {
  const l = lang === "es" ? "es" : "en";
  const intent = invoice.paymentIntent!;
  return (
    <OwnerClaimReview
      invoiceId={invoice.id}
      copy={ownerClaimNote((k, v) => tFor(l, k, v), {
        customer: (intent.claimedBy ?? invoice.customer?.name)?.trim()
          .split(/\s+/)[0],
        methodName: methodFriendly(intent.method, l),
        reference: intent.reference,
      })}
    />
  );
}

function ClaimedNote(
  { invoice, contractorFirst, es }: {
    /** the claimed invoice — its claim, and (REQ-523, demo m16) where the
     *  receipt can arrive: a text is promised only when it can */
    invoice: InvoicePublic;
    contractorFirst?: string;
    es: boolean;
  },
) {
  const intent = invoice.paymentIntent!;
  const lang = es ? "es" : "en";
  const friendly = methodFriendly(intent.method, lang);
  const who = contractorFirst ??
    tFor(lang, "publicInvoice.contractorFallback.lower");
  return (
    <section
      style={`margin-top:24px;background:rgba(255,170,40,0.06);border:1px solid rgba(255,170,40,0.30);border-radius:14px;padding:18px 22px`}
    >
      <div
        style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#a06800`}
      >
        {tFor(lang, "publicInvoice.claimed.heading", { who })}
      </div>
      <p
        style={`margin:8px 0 0;color:${INK};font-size:14.5px;line-height:1.55`}
      >
        {tFor(lang, "publicInvoice.claimed.method")}:{" "}
        <strong>{friendly}</strong>
        {intent.reference
          ? (
            <>
              · {tFor(lang, "publicInvoice.claimed.reference")}:{" "}
              <strong>{intent.reference}</strong>
            </>
          )
          : null}
        <br />
        {tFor(lang, claimedNoteKey(receiptChannelOf(invoice)), { who })}
      </p>
    </section>
  );
}

function ClaimRejectedNote(
  { invoice, lang }: { invoice: InvoicePublic; lang: Lang },
) {
  const l = lang === "es" ? "es" : "en";
  const method = invoice.claimRejectedMethod;
  const note = claimRejectedNote((k, v) => tFor(l, k, v), {
    status: invoice.status,
    claimRejectedAt: invoice.claimRejectedAt,
    methodName: method ? methodFriendly(method, l) : "",
    handle: (invoice.acceptedMethods ?? []).find((m) => m.method === method)
      ?.handle,
    who: invoice.contractor?.name?.split(/\s+/)[0] ??
      tFor(l, "publicInvoice.contractorFallback.lower"),
  });
  if (!note) return null;
  return (
    <section
      data-claim-rejected
      role="status"
      style={`margin-top:24px;background:rgba(220,60,60,0.05);border:1px solid rgba(220,60,60,0.30);border-radius:14px;padding:18px 22px`}
    >
      <div
        style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#b03030`}
      >
        {note.heading}
      </div>
      <p
        style={`margin:8px 0 0;color:${INK};font-size:14.5px;line-height:1.55`}
      >
        {note.body}
      </p>
    </section>
  );
}

function ReceivedNote(
  { paidAt, contractorFirst, es, channel }: {
    paidAt?: string;
    contractorFirst?: string;
    es: boolean;
    /** REQ-556: where the receipt went — the inbox sentence only for email */
    channel?: ReceiptChannel;
  },
) {
  const lang = es ? "es" : "en";
  const who = contractorFirst ??
    tFor(lang, "publicInvoice.contractorFallback.capital");
  return (
    <section
      style={`margin-top:24px;background:rgba(81,152,67,0.08);border:1px solid rgba(81,152,67,0.30);border-radius:14px;padding:18px 22px`}
    >
      <div
        style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}
      >
        {tFor(lang, "publicInvoice.received.heading")}
      </div>
      <p
        style={`margin:8px 0 0;color:${INK};font-size:14.5px;line-height:1.55`}
      >
        {receivedNoteBody((k, v) => tFor(lang, k, v), lang, {
          paidAt,
          who,
          channel,
        })}
      </p>
    </section>
  );
}

function milestoneTitle(idx: number, total: number, es = false): string {
  const lang = es ? "es" : "en";
  if (total === 1) return tFor(lang, "publicInvoice.milestone.oneOfOne");
  const head = tFor(lang, "publicInvoice.milestone.head", { idx, total });
  if (idx === 1) {
    return `${head} — ${tFor(lang, "publicInvoice.milestone.deposit")}`;
  }
  if (idx === total) {
    return `${head} — ${tFor(lang, "publicInvoice.milestone.finalPayment")}`;
  }
  return `${head} — ${tFor(lang, "publicInvoice.milestone.progressPayment")}`;
}

function methodFriendly(method: string, lang: "en" | "es"): string {
  switch (method) {
    case "check":
      return tFor(lang, "paymentMethod.check");
    case "venmo":
      return tFor(lang, "paymentMethod.venmo");
    case "zelle":
      return tFor(lang, "paymentMethod.zelle");
    case "cashapp":
      return tFor(lang, "paymentMethod.cashApp");
    case "paypal":
      return tFor(lang, "paymentMethod.paypal");
    case "cash":
      return tFor(lang, "paymentMethod.cash");
    case "ach":
      return tFor(lang, "paymentMethod.ach");
    case "other":
      return tFor(lang, "paymentMethod.other");
    default:
      return method;
  }
}

function isPastDue(dueDate: string | undefined): boolean {
  if (!dueDate) return false;
  const due = new Date(`${dueDate}T23:59:59Z`);
  return Number.isFinite(due.getTime()) && due.getTime() < Date.now();
}
