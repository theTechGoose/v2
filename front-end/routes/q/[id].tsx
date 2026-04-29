import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import PublicAcceptQuote from "../../islands/PublicAcceptQuote.tsx";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";

interface QuotePublic {
  id: string;
  summary: string;
  customerId?: string;
  estimatedTotal?: number;
  lineItems: { description: string; quantity?: number; unit?: string; price?: number }[];
  status?: string;
  acceptedAt?: string;
  createdAt?: string;
}

export default define.page(async function PublicQuote(ctx) {
  const id = ctx.params.id;
  let quote: QuotePublic | undefined;
  let err: string | undefined;
  const r = await ssrBackendGet<QuotePublic>(`/quotes/${id}/public`);
  if (r.ok) quote = r.data;
  else err = r.status === 404 ? "Quote not found" : `Quote unavailable (${r.status})`;

  return (
    <>
      <Head>
        <title>{quote?.summary ?? "Quote"} · Paperwork Monsters</title>
        <link rel="stylesheet" href="/landing.css" />
      </Head>
      <PublicShell>
        {err || !quote
          ? <ErrorCard message={err ?? "Quote not available."} />
          : <QuoteCard quote={quote} />}
      </PublicShell>
    </>
  );
});

function PublicShell({ children }: { children: preact.ComponentChildren }) {
  return (
    <div style="min-height:100vh;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30;padding:32px 16px;">
      <div style="max-width:640px;margin:0 auto">
        <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843;text-align:center;margin-bottom:18px">
          Paperwork Monsters
        </div>
        {children}
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
          : null}
      </header>
      <div style="height:1px;background:#e3e8e6;margin:20px 0"></div>
      <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6b7a7e">Scope of work</div>
      <table style="width:100%;border-collapse:collapse;margin-top:8px">
        <thead>
          <tr>
            <th style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:left">Description</th>
            <th style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:right">Qty</th>
            <th style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a7e;border-bottom:1px solid #e3e8e6;text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quote.lineItems.map((li, i) => {
            const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
            return (
              <tr key={i}>
                <td style="padding:10px 0;border-bottom:1px solid #e3e8e6;color:#1c2c30;font-size:14px">{li.description}</td>
                <td style="padding:10px 0;border-bottom:1px solid #e3e8e6;color:#6b7a7e;font-size:13px;text-align:right">{li.quantity ?? 1} {li.unit ?? "ea"}</td>
                <td style="padding:10px 0;border-bottom:1px solid #e3e8e6;color:#1c2c30;font-size:14px;font-weight:700;text-align:right">{fmtUSD(lineTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#519843">Estimated total</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:#144852">{fmtUSD(total)}</div>
      </div>
      {accepted ? null : <PublicAcceptQuote quoteId={quote.id} />}
    </article>
  );
}

function fmtUSD(amount: number | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
