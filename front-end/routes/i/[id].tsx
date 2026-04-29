import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";

interface InvoicePublic {
  id: string;
  contractId?: string;
  customerId?: string;
  status?: string;
  amount?: number;
  dueDate?: string;
  issuedDate?: string;
  paidAt?: string;
}

const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "http://localhost:3000";

export default define.page(async function PublicInvoice(ctx) {
  const id = ctx.params.id;
  let invoice: InvoicePublic | undefined;
  let err: string | undefined;
  try {
    const r = await fetch(`${BACKEND_URL}/invoices/${id}/public`, { headers: { accept: "application/json" } });
    if (r.ok) invoice = await r.json();
    else err = `Invoice not found (${r.status})`;
  } catch (e) {
    err = (e as Error).message ?? "couldn't load invoice";
  }

  return (
    <>
      <Head>
        <title>Invoice · Paperwork Monsters</title>
        <link rel="stylesheet" href="/landing.css" />
      </Head>
      <div style="min-height:100vh;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30;padding:32px 16px">
        <div style="max-width:640px;margin:0 auto">
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843;text-align:center;margin-bottom:18px">Paperwork Monsters</div>
          {err || !invoice
            ? (
              <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center">
                <div style="font-weight:800;color:#144852;font-size:18px">Hmm, can't open this</div>
                <p style="margin:8px 0 0;color:#6b7a7e;font-size:14px">{err ?? "Invoice not available."}</p>
              </div>
            )
            : <InvoiceCard invoice={invoice} />}
        </div>
      </div>
    </>
  );
});

function InvoiceCard({ invoice }: { invoice: InvoicePublic }) {
  const paid = invoice.status === "paid" || !!invoice.paidAt;
  return (
    <article style="background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
      <header style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843">Invoice</div>
          <h1 style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852;margin:6px 0 0">#{invoice.id.slice(0, 8)}</h1>
        </div>
        {paid
          ? <span style="background:rgba(81,152,67,0.12);color:#519843;font-weight:800;font-size:11px;letter-spacing:.10em;text-transform:uppercase;padding:6px 12px;border-radius:999px">Paid</span>
          : null}
      </header>
      <div style="height:1px;background:#e3e8e6;margin:20px 0"></div>
      <table style="width:100%;border-collapse:collapse">
        {invoice.issuedDate
          ? <tr><td style="padding:6px 0;color:#6b7a7e;font-size:13px">Issued</td><td style="padding:6px 0;text-align:right;color:#1c2c30;font-weight:700;font-size:14px">{invoice.issuedDate}</td></tr>
          : null}
        {invoice.dueDate
          ? <tr><td style="padding:6px 0;color:#6b7a7e;font-size:13px">Due</td><td style="padding:6px 0;text-align:right;color:#1c2c30;font-weight:700;font-size:14px">{invoice.dueDate}</td></tr>
          : null}
        <tr><td style="padding:6px 0;color:#6b7a7e;font-size:13px">Status</td><td style="padding:6px 0;text-align:right;color:#1c2c30;font-weight:700;font-size:14px;text-transform:capitalize">{invoice.status ?? "pending"}</td></tr>
      </table>
      <div style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#519843">Amount due</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:#144852">{fmtUSD(invoice.amount)}</div>
      </div>
      {paid
        ? null
        : (
          <div style="margin-top:24px;text-align:center;color:#6b7a7e;font-size:13px">
            Online payment is coming soon. Reply to the email to confirm payment details.
          </div>
        )}
    </article>
  );
}

function fmtUSD(amount: number | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
