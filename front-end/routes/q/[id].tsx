import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import PublicQuoteActions from "../../islands/PublicQuoteActions.tsx";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";
import {
  detailLines,
  fmtMoneyExact,
  fmtPhone,
  telHref,
} from "../../lib/format.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { langFromCookie } from "../../lib/lang.ts";
import { deriveQuoteView } from "../../../shared/quote-flow/public-doc-state.ts";

interface QuotePublic {
  id: string;
  summary: string;
  description?: string;
  /** ≤3-word job title — the platform-wide identifier (roadmap p.10).
   *  Renders as this page's hero when present. */
  jobName?: string;
  /** Per-language title/summary/description (keyed by lang code), rendered in
   *  the doc's language when present. */
  descriptionByLang?: Record<string, string>;
  jobNameByLang?: Record<string, string>;
  summaryByLang?: Record<string, string>;
  customerId?: string;
  estimatedTotal?: number;
  lineItems: {
    description: string;
    quantity?: number;
    unit?: string;
    price?: number;
  }[];
  status?: string;
  /** Persisted accepted state (P-11) — who accepted and when. */
  acceptedName?: string;
  acceptedAt?: string;
  createdAt?: string;
  contractor?: {
    name?: string;
    businessName?: string;
    phoneNumber?: string;
    email?: string;
    addressLine?: string;
    commsLanguage?: string;
    /** True when the contractor uploaded a business logo (roadmap p.2). */
    hasLogo?: boolean;
  };
  customer?: { name?: string };
}

export default define.page(async function PublicQuote(ctx) {
  const id = ctx.params.id;
  let quote: QuotePublic | undefined;
  const r = await ssrBackendGet<QuotePublic>(`/quotes/${id}/public`);
  if (r.ok) quote = r.data;
  // Document language — the contractor's outgoing-comms language (roadmap
  // p.13; default en). Quote CONTENT (job name / summary / description)
  // renders in this language, whatever it was written in.
  const docLang: Lang = quote?.contractor?.commsLanguage === "es" ? "es" : "en";
  // UI-chrome language — the visitor's own saved choice (pm_lang cookie,
  // same as every other public route) wins; falls back to the doc language.
  const lang: Lang = langFromCookie(ctx.req.headers.get("cookie")) ?? docLang;
  const err = r.ok ? undefined : tFor(lang, "publicQuote.linkExpired");

  return (
    <>
      <Head>
        <title>
          {quote?.jobNameByLang?.[docLang] ?? quote?.jobName ??
            quote?.summaryByLang?.[docLang] ?? quote?.summary ??
            tFor(lang, "publicQuote.quote")} · {tFor(lang, "brand.name")}
        </title>
        <link rel="stylesheet" href="/landing.css" />
      </Head>
      <PublicShell
        brand={quote?.contractor?.businessName ?? quote?.contractor?.name}
        address={quote?.contractor?.addressLine}
        logoUrl={quote?.contractor?.hasLogo
          ? `/api/public-logo/quote/${id}`
          : undefined}
        lang={lang}
      >
        {err || !quote
          ? (
            <ErrorCard
              message={err ?? tFor(lang, "publicQuote.unavailable")}
              lang={lang}
            />
          )
          : <QuoteCard quote={quote} lang={lang} />}
      </PublicShell>
    </>
  );
});

function PublicShell(
  { children, brand, address, logoUrl, lang }: {
    children: preact.ComponentChildren;
    brand?: string;
    address?: string;
    /** Contractor's uploaded business logo (roadmap p.2). */
    logoUrl?: string;
    lang: Lang;
  },
) {
  const headline = brand && brand.trim()
    ? brand
    : tFor(lang, "publicQuote.contractorFallback");
  return (
    <div style="min-height:100dvh;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30;padding:32px 16px calc(32px + var(--kb-inset, 0px));scroll-padding-bottom:var(--kb-inset, 0px);">
      <div style="max-width:640px;margin:0 auto">
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            style="max-height:48px;max-width:160px;object-fit:contain;display:block;margin:0 auto 8px;border-radius:8px"
          />
        )}
        <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843;text-align:center;margin-bottom:6px">
          {headline}
        </div>
        {address && (
          <div style="font-size:12px;color:#6b7a7e;text-align:center;margin-bottom:18px">
            {address}
          </div>
        )}
        {!address && <div style="height:12px"></div>}
        {children}
        <div style="margin-top:18px;text-align:center;color:#b9c1bf;font-size:10px;letter-spacing:.08em">
          {tFor(lang, "publicQuote.poweredBy", {
            brand: tFor(lang, "brand.name"),
          })}
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ message, lang }: { message: string; lang: Lang }) {
  return (
    <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center">
      <div style="font-weight:800;color:#144852;font-size:18px">
        {tFor(lang, "publicQuote.errorHeading")}
      </div>
      <p style="margin:8px 0 0;color:#6b7a7e;font-size:14px">{message}</p>
    </div>
  );
}

function QuoteCard({ quote, lang }: { quote: QuotePublic; lang: Lang }) {
  const total = quote.estimatedTotal ??
    quote.lineItems.reduce(
      (s, li) => s + (li.price ?? 0) * (li.quantity ?? 1),
      0,
    );
  // P-11: the backend writes "approved" on accept (legacy rows may say
  // "accepted") — deriveQuoteView maps both to the accepted view, carrying
  // the persisted who/when so a reload renders the confirmation (SSR-safe).
  const view = deriveQuoteView(quote);
  const accepted = view.mode === "accepted";
  const declined = view.mode === "declined";
  // Multi-quantity items are rare for handyman work; only show the qty column
  // when at least one line is > 1, and drop the "ea" suffix entirely.
  const showQty = quote.lineItems.some((li) => (li.quantity ?? 1) > 1);
  const customerName = quote.customer?.name?.trim();
  const contractorFirst = quote.contractor?.name?.trim()?.split(/\s+/)[0];
  const contractor = quote.contractor;
  // `lang` (UI chrome) arrives from the route handler — pm_lang cookie
  // first, then the doc language. CONTENT stays in the document's language:
  // title + bullets use the outgoing-comms language (roadmap p.13) when the
  // per-language fields are present (populated from the picked job option).
  const docLang: Lang = contractor?.commsLanguage === "es" ? "es" : "en";
  const qSummary = quote.summaryByLang?.[docLang] ?? quote.summary;
  const qDesc = quote.descriptionByLang?.[docLang] ?? quote.description;
  // Hero = the platform-wide Job Name (roadmap p.10) when present, so the
  // quote heading matches the agreement, the invoice, and the SMS/email.
  const qName = (quote.jobNameByLang?.[docLang] ?? quote.jobName)?.trim();
  const heroTitle = qName || qSummary;
  return (
    <article style="background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
      <header style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843">
            {tFor(lang, "publicQuote.quote")}
          </div>
          <h1 style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852;margin:6px 0 0">
            {heroTitle}
          </h1>
          {qName && qSummary && qName !== qSummary
            ? (
              <div style="margin-top:4px;color:#4a5a5e;font-size:13.5px">
                {qSummary}
              </div>
            )
            : null}
          <div style="margin-top:4px;color:#6b7a7e;font-size:13px">
            #{quote.id.slice(0, 8)}
          </div>
        </div>
        {accepted
          ? (
            <span style="background:rgba(81,152,67,0.12);color:#519843;font-weight:800;font-size:11px;letter-spacing:.10em;text-transform:uppercase;padding:6px 12px;border-radius:999px">
              {tFor(lang, "status.accepted")}
            </span>
          )
          : declined
          ? (
            <span style="background:rgba(168,59,59,0.10);color:#a83b3b;font-weight:800;font-size:11px;letter-spacing:.10em;text-transform:uppercase;padding:6px 12px;border-radius:999px">
              {tFor(lang, "status.declined")}
            </span>
          )
          : null}
      </header>
      {customerName && (
        <div style="margin-top:14px;color:#1c2c30;font-size:14px">
          {tFor(lang, "publicQuote.greeting", {
            name: customerName.split(/\s+/)[0],
          })}
        </div>
      )}
      {(() => {
        const lines = detailLines(qDesc);
        if (lines.length > 1) {
          return (
            <ul style="margin:10px 0 0;padding:0;list-style:none;color:#1c2c30;font-size:14.5px;line-height:1.6">
              {lines.map((l, i) => (
                <li key={i} style="position:relative;padding:3px 0 3px 18px">
                  <span style="position:absolute;left:0;top:10px;width:6px;height:6px;border-radius:50%;background:#519843">
                  </span>
                  {l}
                </li>
              ))}
            </ul>
          );
        }
        if (lines.length === 1) {
          return (
            <p style="margin:10px 0 0;color:#1c2c30;font-size:14.5px;line-height:1.6;white-space:pre-wrap">
              {lines[0]}
            </p>
          );
        }
        // #26 — derived job-details framing when there's no description. The
        // line items table is still the canonical job details; this sentence
        // just orients the customer before they read it.
        if (!qSummary) return null;
        const n = quote.lineItems.length;
        const linesPhrase = tFor(
          lang,
          `publicQuote.linesOfWork.${n === 1 ? "one" : "other"}`,
          { n },
        );
        return (
          <p style="margin:10px 0 0;color:#4a5a5e;font-size:13.5px;line-height:1.55">
            {tFor(lang, "publicQuote.jobDetails", {
              details: jobDetailsBlurb(qSummary),
              lines: linesPhrase,
            })}
          </p>
        );
      })()}
      {
        /* Line-item breakdown only for multi-line quotes — a single line just
          repeats the estimated total, and the job-details bullets above
          already describe the scope. */
      }
      {quote.lineItems.length > 1 && (
        <>
          <div style="height:1px;background:#e3e8e6;margin:20px 0"></div>
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6b7a7e">
            {tFor(lang, "publicQuote.lineItems")}
          </div>
          <table style="width:100%;border-collapse:collapse;margin-top:8px">
            <thead>
              <tr>
                <th style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:left">
                  {tFor(lang, "publicQuote.colDescription")}
                </th>
                {
                  /* P-58: horizontal padding on the qty column + a left pad
                    on the amount column keep a painted gap between the two
                    right-aligned cells at 390px — never "32$1,120.00". */
                }
                {showQty && (
                  <th style="padding:8px 12px 8px 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:right">
                    {tFor(lang, "publicQuote.colQty")}
                  </th>
                )}
                <th style="padding:8px 0 8px 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:right">
                  {tFor(lang, "publicQuote.colAmount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {quote.lineItems.map((li, i) => {
                const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
                return (
                  <tr key={i}>
                    <td style="padding:10px 0;border-bottom:1px solid #e3e8e6;color:#1c2c30;font-size:14px">
                      {li.description}
                    </td>
                    {showQty && (
                      <td style="padding:10px 12px 10px 8px;border-bottom:1px solid #e3e8e6;color:#6b7a7e;font-size:13px;text-align:right">
                        {li.quantity ?? 1}
                      </td>
                    )}
                    <td style="padding:10px 0 10px 8px;border-bottom:1px solid #e3e8e6;color:#1c2c30;font-size:14px;font-weight:700;text-align:right;white-space:nowrap">
                      {fmtMoneyExact(lineTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <div style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#519843">
          {tFor(lang, "publicQuote.estimatedTotal")}
        </div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:#144852">
          {fmtMoneyExact(total)}
        </div>
      </div>
      {accepted && (
        <div style="margin-top:18px;background:rgba(81,152,67,0.10);border:1px solid rgba(72,158,95,0.30);border-radius:14px;padding:18px 20px;text-align:center">
          <div style="font-weight:800;color:#519843;font-size:16px">
            {"✓ "}
            {tFor(lang, "publicQuote.acceptedTitle")}
          </div>
          <div style="margin-top:6px;color:#1c2c30;font-size:13.5px">
            {view.acceptedBy
              ? tFor(lang, "publicQuote.acceptedByOn", {
                name: view.acceptedBy,
                date: fmtAcceptedDate(view.acceptedAt, lang),
              })
              : tFor(lang, "publicQuote.acceptedOn", {
                date: fmtAcceptedDate(view.acceptedAt, lang),
              })}
          </div>
        </div>
      )}
      {accepted || declined ? null : (
        <PublicQuoteActions
          quoteId={quote.id}
          contractorFirstName={contractorFirst}
          customerName={customerName}
          lang={lang}
        />
      )}
      {(contractor?.phoneNumber || contractor?.email) && (
        <div style="margin-top:22px;padding-top:16px;border-top:1px dashed #e3e8e6;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;color:#6b7a7e">
          <div>
            {tFor(lang, "publicQuote.contactPrompt")} {contractor?.name ||
              tFor(lang, "publicQuote.contractorNameFallback")}:
          </div>
          {
            /* P-58: long contractor emails overflowed the 390px viewport —
              the row wraps and the email itself may break mid-address so
              nothing ever paints past the card edge. */
          }
          <div style="display:flex;gap:14px;flex-wrap:wrap;min-width:0;max-width:100%">
            {contractor?.phoneNumber && (
              <a
                href={telHref(contractor.phoneNumber)}
                style="color:#144852;text-decoration:none;font-weight:700;white-space:nowrap"
              >
                {fmtPhone(contractor.phoneNumber)}
              </a>
            )}
            {contractor?.email && (
              <a
                href={`mailto:${contractor.email}`}
                style="color:#144852;text-decoration:none;font-weight:700;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-all"
              >
                {contractor.email}
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** Long-form acceptance date ("August 18, 2026" / "18 de agosto de 2026") —
 *  the year is always spelled out so the confirmation reads as a record.
 *  Falls back to today when the row predates the acceptedAt stamp. */
function fmtAcceptedDate(iso: string | undefined, lang: Lang): string {
  const d = iso ? new Date(iso) : new Date();
  const safe = isNaN(d.getTime()) ? new Date() : d;
  return safe.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Lower-case + strip the leading "Quote: " prefix the LLM sometimes emits,
 *  so the derived job-details sentence reads naturally. "Quote: 2-Car Garage
 *  Epoxy Floor" → "2-car garage epoxy floor". */
function jobDetailsBlurb(summary: string): string {
  return summary.replace(/^\s*quote\s*:\s*/i, "").toLowerCase();
}
