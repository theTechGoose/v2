import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import PublicQuoteActions from "../../islands/PublicQuoteActions.tsx";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";
import { fmtMoneyExact, fmtPhone, telHref } from "../../lib/format.ts";

interface QuotePublic {
  id: string;
  summary: string;
  customerId?: string;
  estimatedTotal?: number;
  lineItems: { description: string; quantity?: number; unit?: string; price?: number }[];
  status?: string;
  acceptedAt?: string;
  createdAt?: string;
  contractor?: { name?: string; businessName?: string; phoneNumber?: string; email?: string; addressLine?: string };
  customer?: { name?: string };
}

export default define.page(async function PublicQuote(ctx) {
  const id = ctx.params.id;
  let quote: QuotePublic | undefined;
  let err: string | undefined;
  const r = await ssrBackendGet<QuotePublic>(`/quotes/${id}/public`);
  if (r.ok) quote = r.data;
  else err = "This quote link expired or was revoked.";

  return (
    <>
      <Head>
        <title>{quote?.summary ?? "Quote"} · Paperwork Monsters</title>
        <link rel="stylesheet" href="/landing.css" />
      </Head>
      <PublicShell brand={quote?.contractor?.businessName ?? quote?.contractor?.name} address={quote?.contractor?.addressLine}>
        {err || !quote
          ? <ErrorCard message={err ?? "Quote not available."} />
          : <QuoteCard quote={quote} />}
      </PublicShell>
    </>
  );
});

function PublicShell({ children, brand, address }: { children: preact.ComponentChildren; brand?: string; address?: string }) {
  const headline = brand && brand.trim() ? brand : "Your contractor";
  return (
    <div style="min-height:100vh;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30;padding:32px 16px;">
      <div style="max-width:640px;margin:0 auto">
        <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843;text-align:center;margin-bottom:6px">
          {headline}
        </div>
        {address && (
          <div style="font-size:12px;color:#6b7a7e;text-align:center;margin-bottom:18px">{address}</div>
        )}
        {!address && <div style="height:12px"></div>}
        {children}
        <div style="margin-top:18px;text-align:center;color:#b9c1bf;font-size:10px;letter-spacing:.08em">powered by Paperwork Monsters</div>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center">
      <div style="font-weight:800;color:#144852;font-size:18px">Hmm, can't open this</div>
      <p style="margin:8px 0 0;color:#6b7a7e;font-size:14px">{message}</p>
    </div>
  );
}

function QuoteCard({ quote }: { quote: QuotePublic }) {
  const total = quote.estimatedTotal
    ?? quote.lineItems.reduce((s, li) => s + (li.price ?? 0) * (li.quantity ?? 1), 0);
  const accepted = quote.status === "accepted";
  const declined = quote.status === "lost";
  // Multi-quantity items are rare for handyman work; only show the qty column
  // when at least one line is > 1, and drop the "ea" suffix entirely.
  const showQty = quote.lineItems.some((li) => (li.quantity ?? 1) > 1);
  const customerName = quote.customer?.name?.trim();
  const contractorFirst = quote.contractor?.name?.trim()?.split(/\s+/)[0];
  const contractor = quote.contractor;
  return (
    <article style="background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
      <header style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843">Quote</div>
          <h1 style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852;margin:6px 0 0">{quote.summary}</h1>
          <div style="margin-top:4px;color:#6b7a7e;font-size:13px">#{quote.id.slice(0, 8)}</div>
        </div>
        {accepted
          ? <span style="background:rgba(81,152,67,0.12);color:#519843;font-weight:800;font-size:11px;letter-spacing:.10em;text-transform:uppercase;padding:6px 12px;border-radius:999px">Accepted</span>
          : declined
          ? <span style="background:rgba(168,59,59,0.10);color:#a83b3b;font-weight:800;font-size:11px;letter-spacing:.10em;text-transform:uppercase;padding:6px 12px;border-radius:999px">Declined</span>
          : null}
      </header>
      {customerName && (
        <div style="margin-top:14px;color:#1c2c30;font-size:14px">Hi {customerName.split(/\s+/)[0]} — here's your quote.</div>
      )}
      {quote.summary && (
        // #26 — derived job-details framing. The line items table is still
        // the canonical job details; this sentence just orients the customer
        // before they read it. Avoids a Quote DTO schema change.
        <p style="margin:10px 0 0;color:#4a5a5e;font-size:13.5px;line-height:1.55">
          This estimate covers {jobDetailsBlurb(quote.summary)}{" "}
          — {quote.lineItems.length === 1 ? "a single line of work" : `${quote.lineItems.length} lines of work`} broken down below.
        </p>
      )}
      <div style="height:1px;background:#e3e8e6;margin:20px 0"></div>
      <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6b7a7e">Job details</div>
      <table style="width:100%;border-collapse:collapse;margin-top:8px">
        <thead>
          <tr>
            <th style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:left">Description</th>
            {showQty && (
              <th style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:right">Qty</th>
            )}
            <th style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quote.lineItems.map((li, i) => {
            const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
            return (
              <tr key={i}>
                <td style="padding:10px 0;border-bottom:1px solid #e3e8e6;color:#1c2c30;font-size:14px">{li.description}</td>
                {showQty && (
                  <td style="padding:10px 0;border-bottom:1px solid #e3e8e6;color:#6b7a7e;font-size:13px;text-align:right">{li.quantity ?? 1}</td>
                )}
                <td style="padding:10px 0;border-bottom:1px solid #e3e8e6;color:#1c2c30;font-size:14px;font-weight:700;text-align:right">{fmtMoneyExact(lineTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#519843">Estimated total</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:#144852">{fmtMoneyExact(total)}</div>
      </div>
      {accepted || declined ? null : <PublicQuoteActions quoteId={quote.id} contractorFirstName={contractorFirst} customerName={customerName} />}
      {(contractor?.phoneNumber || contractor?.email) && (
        <div style="margin-top:22px;padding-top:16px;border-top:1px dashed #e3e8e6;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;color:#6b7a7e">
          <div>Questions? Reach {contractor?.name || "your contractor"}:</div>
          <div style="display:flex;gap:14px">
            {contractor?.phoneNumber && <a href={telHref(contractor.phoneNumber)} style="color:#144852;text-decoration:none;font-weight:700">{fmtPhone(contractor.phoneNumber)}</a>}
            {contractor?.email && <a href={`mailto:${contractor.email}`} style="color:#144852;text-decoration:none;font-weight:700">{contractor.email}</a>}
          </div>
        </div>
      )}
    </article>
  );
}

/** Lower-case + strip the leading "Quote: " prefix the LLM sometimes emits,
 *  so the derived job-details sentence reads naturally. "Quote: 2-Car Garage
 *  Epoxy Floor" → "2-car garage epoxy floor". */
function jobDetailsBlurb(summary: string): string {
  return summary.replace(/^\s*quote\s*:\s*/i, "").toLowerCase();
}
