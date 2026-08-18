import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";
import { fmtMoneyExact, fmtPhone, telHref } from "../../lib/format.ts";
import { tFor } from "../../lib/i18n.ts";
import PublicInvoiceClaim from "../../islands/PublicInvoiceClaim.tsx";
import {
  BG,
  computeMilestones,
  fmtDate,
  GREEN,
  INK,
  JobDetailsSection,
  LINE,
  type LineItem,
  MUTED,
  PartyCard,
  PaymentScheduleSection,
  PINK,
  PINK_DARK,
  sumLineTotals,
  TEAL,
  type Term,
} from "../../components/doc-parts.tsx";

interface Contractor {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  addressLine?: string;
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
  id: string;
  contractId?: string;
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
  contractor?: Contractor;
  customer?: { name?: string; email?: string; phoneNumber?: string };
  jobDetails?: {
    summary?: string;
    jobName?: string;
    description?: string;
    jobNameByLang?: Record<string, string>;
    summaryByLang?: Record<string, string>;
    descriptionByLang?: Record<string, string>;
    lineItems?: LineItem[];
  };
  /** Agreement context mirrored from the linked contract (quote-linked
   *  invoices only) — lets the doc show the same itemized job + term grid as
   *  the signed agreement, minus the legal clauses + signature. */
  agreementTotal?: number;
  terms?: Term[];
  startDate?: string;
  estimatedCompletionDate?: string;
  effectiveDate?: string;
  /** "/c/<contractId>" — present only once the linked contract is signed. */
  signedQuoteUrl?: string;
  signedAgreement?: { id: string; signedAt?: string };
  siblings?: Array<{
    id: string;
    amount?: number;
    status?: string;
    paidAt?: string;
    installmentIndex?: number;
    installmentTotal?: number;
  }>;
  acceptedMethods?: Array<{ method: string; handle?: string }>;
}

export default define.page(async function PublicInvoice(ctx) {
  const id = ctx.params.id;
  let invoice: InvoicePublic | undefined;
  let err: string | undefined;
  const r = await ssrBackendGet<InvoicePublic>(`/invoices/${id}/public`);
  if (r.ok) invoice = r.data;
  else err = tFor("en", "publicInvoice.error.expired");

  return (
    <>
      <Head>
        <title>{tFor("en", "publicInvoice.docTitle")}</title>
        <link rel="stylesheet" href="/landing.css" />
      </Head>
      <div
        style={`min-height:100dvh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};padding:32px 16px calc(64px + var(--kb-inset, 0px));scroll-padding-bottom:var(--kb-inset, 0px)`}
      >
        <div style="max-width:680px;margin:0 auto">
          {err || !invoice
            ? (
              <ErrorCard
                message={err ?? tFor("en", "publicInvoice.error.notAvailable")}
              />
            )
            : <InvoiceDoc invoice={invoice} />}
        </div>
      </div>
    </>
  );
});

function ErrorCard({ message }: { message: string }) {
  return (
    <>
      <div
        style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN};text-align:center;margin-bottom:18px`}
      >
        {tFor("en", "brand.name")}
      </div>
      <div
        style={`background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center`}
      >
        <div style={`font-weight:800;color:${TEAL};font-size:18px`}>
          {tFor("en", "publicInvoice.error.heading")}
        </div>
        <p style={`margin:8px 0 0;color:${MUTED};font-size:14px`}>{message}</p>
      </div>
    </>
  );
}

function InvoiceDoc({ invoice }: { invoice: InvoicePublic }) {
  const paid = invoice.status === "paid" || !!invoice.paidAt;
  const claimed = invoice.status === "claimed" && !!invoice.paymentIntent;
  const pastDue = !paid && !claimed && isPastDue(invoice.dueDate);
  const es = invoice.contractor?.commsLanguage === "es";
  const lang = es ? "es" : "en";
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
    .map((s) => ({ amount: s.amount ?? 0, index: s.installmentIndex }));

  // Agreement mirror — present only for quote-linked invoices (getInvoicePublic
  // projects the linked contract's line items, total, and term grid). Standalone
  // invoices have none of this and keep the lightweight amount-only document.
  const items = invoice.jobDetails?.lineItems ?? [];
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
              {invoice.contractor?.addressLine
                ? (
                  <div style={`margin-top:3px;font-size:12px;color:${MUTED}`}>
                    {invoice.contractor.addressLine}
                  </div>
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
          {!rich &&
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

          {/* Bill to / From — only on the rich (quote-linked) document */}
          {rich
            ? (
              <section style="margin-top:22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
                <PartyCard
                  role={tFor(lang, "publicInvoice.billTo")}
                  name={invoice.customer?.name}
                  email={invoice.customer?.email}
                  phone={invoice.customer?.phoneNumber}
                />
                <PartyCard
                  role={tFor(lang, "contractDoc.from")}
                  name={invoice.contractor?.name}
                  businessName={invoice.contractor?.businessName}
                  email={invoice.contractor?.email}
                  phone={invoice.contractor?.phoneNumber}
                  address={invoice.contractor?.addressLine}
                />
              </section>
            )
            : null}

          {/* Amount card */}
          <div
            style={`margin-top:22px;background:linear-gradient(135deg,#e8f3e2 0%,#dceadb 100%);border:1px solid rgba(81,152,67,0.25);border-radius:18px;padding:22px 24px;display:flex;justify-content:space-between;align-items:center`}
          >
            <div>
              <div
                style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}
              >
                {paid
                  ? tFor(lang, "status.paid")
                  : tFor(lang, "publicInvoice.amountDue")}
              </div>
              {invoice.dueDate
                ? (
                  <div style={`margin-top:4px;color:${MUTED};font-size:12px`}>
                    {paid
                      ? tFor(lang, "publicInvoice.paidOn", {
                        date: invoice.paidAt ?? "",
                      })
                      : tFor(lang, "publicInvoice.dueOn", {
                        date: invoice.dueDate,
                      })}
                  </div>
                )
                : null}
            </div>
            <div
              style={`font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:38px;letter-spacing:-0.03em;color:${TEAL};line-height:1;font-variant-numeric:tabular-nums`}
            >
              {fmtMoneyExact(invoice.amount)}
            </div>
          </div>

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
                      {p.index ? `#${p.index} · ` : ""}
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
                contractorFirst={invoice.contractor?.name?.split(/\s+/)[0]}
                es={es}
              />
            )
            : claimed
            ? (
              <ClaimedNote
                intent={invoice.paymentIntent!}
                contractorFirst={invoice.contractor?.name?.split(/\s+/)[0]}
                es={es}
              />
            )
            : (
              <PublicInvoiceClaim
                invoiceId={invoice.id}
                acceptedMethods={invoice.acceptedMethods ?? []}
                customerName={invoice.customer?.name}
                lang={es ? "es" : "en"}
              />
            )}

          {
            /* What this invoice covers — mirrors the signed agreement, minus the
            14 legal clauses + the signature block. Quote-linked invoices only. */
          }
          {rich
            ? (
              <>
                {items.length > 0 && (
                  <JobDetailsSection
                    n={num()}
                    title={tFor(lang, "contractDoc.jobDetails")}
                    description={invoice.jobDetails?.descriptionByLang
                      ?.[lang] ??
                      invoice.jobDetails?.description}
                    items={items}
                    total={agreementTotal ?? sumLineTotals(items)}
                    labels={{
                      tableDescription: tFor(
                        lang,
                        "contractDoc.tableDescription",
                      ),
                      tableQty: tFor(lang, "contractDoc.tableQty"),
                      tableAmount: tFor(lang, "contractDoc.tableAmount"),
                      unitEach: tFor(lang, "contractDoc.unitEach"),
                      valueLabel: tFor(lang, "contractDoc.agreementValue"),
                      valueSub: tFor(lang, "contractDoc.allIn"),
                    }}
                  />
                )}
                {milestones.length > 0 && (
                  <PaymentScheduleSection
                    n={num()}
                    title={tFor(lang, "contractDoc.paymentSchedule")}
                    milestones={milestones}
                  />
                )}
              </>
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

          {/* Contact footer */}
          {(invoice.contractor?.phoneNumber || invoice.contractor?.email)
            ? (
              <footer
                style={`margin-top:30px;padding-top:22px;border-top:1px solid ${LINE};color:${INK};font-size:14px;line-height:1.5`}
              >
                {tFor(lang, "publicInvoice.footer.questions")}{" "}
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
              </footer>
            )
            : null}
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
          {tFor(lang, "publicInvoice.poweredBy", {
            id: invoice.id.slice(0, 8).toUpperCase(),
          })}
        </div>
      </article>

      {
        /* p6: "include a link to the signed quote if one exists". Rendered
        OUTSIDE [data-cy=invoice-doc] — the invoice document itself carries
        no signature language in any language. */
      }
      {(invoice.signedQuoteUrl || invoice.signedAgreement)
        ? (
          <div style="margin-top:20px;display:flex;justify-content:center">
            <a
              data-cy="invoice-signed-quote-link"
              href={invoice.signedQuoteUrl ??
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
                {tFor(lang, "publicInvoice.viewSignedAgreement")}
                {invoice.signedAgreement?.signedAt
                  ? (
                    <span
                      style={`display:block;font-weight:600;font-size:12px;color:${MUTED}`}
                    >
                      {tFor(lang, "publicInvoice.signedOn", {
                        date: fmtDate(invoice.signedAgreement.signedAt),
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
      style={`background:${bg};color:${color};font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px`}
    >
      {label}
    </span>
  );
}

function ClaimedNote(
  { intent, contractorFirst, es }: {
    intent: { method: string; reference?: string; claimedAt: string };
    contractorFirst?: string;
    es: boolean;
  },
) {
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
        {tFor(lang, "publicInvoice.claimed.body", { who })}
      </p>
    </section>
  );
}

function ReceivedNote(
  { paidAt, contractorFirst, es }: {
    paidAt?: string;
    contractorFirst?: string;
    es: boolean;
  },
) {
  const lang = es ? "es" : "en";
  const who = contractorFirst ??
    tFor(lang, "publicInvoice.contractorFallback.capital");
  const when = paidAt
    ? tFor(lang, "publicInvoice.received.onDate", { date: paidAt })
    : "";
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
        {tFor(lang, "publicInvoice.received.body", { who, when })}
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
