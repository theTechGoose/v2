import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";
import { fmtMoneyExact, fmtPhone, telHref } from "../../lib/format.ts";
import PublicInvoiceClaim from "../../islands/PublicInvoiceClaim.tsx";

interface Contractor {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  addressLine?: string;
  acceptedPaymentMethods?: Record<string, { enabled?: boolean }>;
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
  jobDetails?: { summary?: string; jobName?: string; description?: string };
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

const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";
const TEAL = "#144852";
const GREEN = "#519843";
const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";
const BG = "#f7f6f1";

export default define.page(async function PublicInvoice(ctx) {
  const id = ctx.params.id;
  let invoice: InvoicePublic | undefined;
  let err: string | undefined;
  const r = await ssrBackendGet<InvoicePublic>(`/invoices/${id}/public`);
  if (r.ok) invoice = r.data;
  else err = "This invoice link expired or was revoked.";

  return (
    <>
      <Head>
        <title>Invoice · Paperwork Monsters</title>
        <link rel="stylesheet" href="/landing.css" />
      </Head>
      <div style={`min-height:100vh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};padding:32px 16px 64px`}>
        <div style="max-width:680px;margin:0 auto">
          {err || !invoice
            ? <ErrorCard message={err ?? "Invoice not available."} />
            : <InvoiceDoc invoice={invoice} />}
        </div>
      </div>
    </>
  );
});

function ErrorCard({ message }: { message: string }) {
  return (
    <>
      <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN};text-align:center;margin-bottom:18px`}>Paperwork Monsters</div>
      <div style={`background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center`}>
        <div style={`font-weight:800;color:${TEAL};font-size:18px`}>Hmm, can't open this</div>
        <p style={`margin:8px 0 0;color:${MUTED};font-size:14px`}>{message}</p>
      </div>
    </>
  );
}

function InvoiceDoc({ invoice }: { invoice: InvoicePublic }) {
  const paid = invoice.status === "paid" || !!invoice.paidAt;
  const claimed = invoice.status === "claimed" && !!invoice.paymentIntent;
  const pastDue = !paid && !claimed && isPastDue(invoice.dueDate);
  const businessLabel = invoice.contractor?.businessName?.trim()
    || invoice.contractor?.name?.trim()
    || "Paperwork Monsters";
  const jobName = invoice.jobDetails?.jobName?.trim()
    || invoice.jobDetails?.summary?.trim()
    || "Project";
  const idx = invoice.installmentIndex;
  const total = invoice.installmentTotal;
  const milestoneLabel = idx && total
    ? milestoneTitle(idx, total)
    : undefined;
  const paidSoFar = (invoice.siblings ?? [])
    .filter((s) => s.id !== invoice.id && (s.status === "paid" || (s as { paidAt?: string }).paidAt))
    .map((s) => ({ amount: s.amount ?? 0, index: s.installmentIndex }));

  return (
    <article style={`background:#fff;border-radius:24px;box-shadow:0 14px 50px rgba(20,72,82,0.10);overflow:hidden;border:1px solid rgba(255,107,107,0.10)`}>
      <div style={`height:8px;background:linear-gradient(90deg,${PINK} 0%,${PINK_DARK} 100%)`} />
      <div style="padding:32px 36px 36px">
        {/* Eyebrow */}
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <div style={`font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${PINK_DARK}`}>{businessLabel}</div>
            {invoice.contractor?.addressLine
              ? <div style={`margin-top:3px;font-size:12px;color:${MUTED}`}>{invoice.contractor.addressLine}</div>
              : null}
          </div>
          <StatusPill paid={paid} claimed={claimed} pastDue={pastDue} />
        </div>

        {/* Hero */}
        <h1 style={`margin:18px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:32px;letter-spacing:-0.025em;color:${TEAL};line-height:1.1`}>
          {jobName}
        </h1>
        {milestoneLabel
          ? <div style={`margin-top:6px;color:${MUTED};font-size:14px`}>{milestoneLabel}</div>
          : null}

        {/* Amount card */}
        <div style={`margin-top:22px;background:linear-gradient(135deg,#e8f3e2 0%,#dceadb 100%);border:1px solid rgba(81,152,67,0.25);border-radius:18px;padding:22px 24px;display:flex;justify-content:space-between;align-items:center`}>
          <div>
            <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}>{paid ? "Paid" : "Amount due"}</div>
            {invoice.dueDate
              ? <div style={`margin-top:4px;color:${MUTED};font-size:12px`}>{paid ? `Paid ${invoice.paidAt ?? ""}` : `Due ${invoice.dueDate}`}</div>
              : null}
          </div>
          <div style={`font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:38px;letter-spacing:-0.03em;color:${TEAL};line-height:1;font-variant-numeric:tabular-nums`}>
            {fmtMoneyExact(invoice.amount)}
          </div>
        </div>

        {/* Paid-so-far strip — only when there's prior installments paid. */}
        {paidSoFar.length > 0
          ? (
            <section style="margin-top:24px">
              <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}>Paid so far</div>
              <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
                {paidSoFar.map((p, i) => (
                  <span key={i} style={`background:rgba(81,152,67,0.10);color:${GREEN};font-size:12px;font-weight:700;padding:6px 12px;border-radius:999px`}>
                    {p.index ? `#${p.index} · ` : ""}{fmtMoneyExact(p.amount)}
                  </span>
                ))}
              </div>
            </section>
          )
          : null}

        {/* Already-claimed strip OR active pay UI */}
        {paid
          ? <ReceivedNote paidAt={invoice.paidAt} contractorFirst={invoice.contractor?.name?.split(/\s+/)[0]} />
          : claimed
          ? <ClaimedNote intent={invoice.paymentIntent!} contractorFirst={invoice.contractor?.name?.split(/\s+/)[0]} />
          : (
            <PublicInvoiceClaim
              invoiceId={invoice.id}
              acceptedMethods={invoice.acceptedMethods ?? []}
              customerName={invoice.customer?.name}
            />
          )}

        {/* Contact footer */}
        {(invoice.contractor?.phoneNumber || invoice.contractor?.email)
          ? (
            <footer style={`margin-top:30px;padding-top:22px;border-top:1px solid ${LINE};color:${INK};font-size:14px;line-height:1.5`}>
              Questions before paying?{" "}
              {invoice.contractor.phoneNumber
                ? <>Call <a href={telHref(invoice.contractor.phoneNumber)} style={`color:${TEAL};text-decoration:none;font-weight:700`}>{fmtPhone(invoice.contractor.phoneNumber)}</a></>
                : null}
              {invoice.contractor.phoneNumber && invoice.contractor.email ? " or " : ""}
              {invoice.contractor.email
                ? <>email <a href={`mailto:${invoice.contractor.email}`} style={`color:${TEAL};text-decoration:none;font-weight:700`}>{invoice.contractor.email}</a></>
                : null}
              {"! I look forward to working with you."}
            </footer>
          )
          : null}
      </div>
      <div style={`display:flex;align-items:center;justify-content:center;gap:8px;padding:16px;font-size:11px;color:#a8b2b3;letter-spacing:.04em`}>
        <img src="/logo.png" alt="" height="16" style="height:16px;width:auto;opacity:0.7;display:block" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        Powered by Paperwork Monsters · Invoice #{invoice.id.slice(0, 8).toUpperCase()}
      </div>
    </article>
  );
}

function StatusPill({ paid, claimed, pastDue }: { paid: boolean; claimed: boolean; pastDue: boolean }) {
  if (paid) return <Pill bg={`rgba(81,152,67,0.15)`} color={GREEN} label="Paid" />;
  if (claimed) return <Pill bg={`rgba(255,170,40,0.15)`} color="#a06800" label="Awaiting confirmation" />;
  if (pastDue) return <Pill bg={`rgba(168,59,59,0.10)`} color="#a83b3b" label="Past due" />;
  return <Pill bg={`rgba(255,107,107,0.10)`} color={PINK_DARK} label="Due" />;
}

function Pill({ bg, color, label }: { bg: string; color: string; label: string }) {
  return <span style={`background:${bg};color:${color};font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px`}>{label}</span>;
}

function ClaimedNote({ intent, contractorFirst }: { intent: { method: string; reference?: string; claimedAt: string }; contractorFirst?: string }) {
  const friendly = methodFriendly(intent.method);
  return (
    <section style={`margin-top:24px;background:rgba(255,170,40,0.06);border:1px solid rgba(255,170,40,0.30);border-radius:14px;padding:18px 22px`}>
      <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#a06800`}>You told {contractorFirst ?? "your contractor"} you paid</div>
      <p style={`margin:8px 0 0;color:${INK};font-size:14.5px;line-height:1.55`}>
        Method: <strong>{friendly}</strong>
        {intent.reference ? <> · Reference: <strong>{intent.reference}</strong></> : null}
        <br />
        We'll text you a receipt once {contractorFirst ?? "your contractor"} confirms funds landed.
      </p>
    </section>
  );
}

function ReceivedNote({ paidAt, contractorFirst }: { paidAt?: string; contractorFirst?: string }) {
  return (
    <section style={`margin-top:24px;background:rgba(81,152,67,0.08);border:1px solid rgba(81,152,67,0.30);border-radius:14px;padding:18px 22px`}>
      <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}>Payment received</div>
      <p style={`margin:8px 0 0;color:${INK};font-size:14.5px;line-height:1.55`}>
        Thanks! {contractorFirst ?? "Your contractor"} confirmed your payment{paidAt ? ` on ${paidAt}` : ""}. A PDF receipt is in your inbox.
      </p>
    </section>
  );
}

function milestoneTitle(idx: number, total: number): string {
  if (total === 1) return "Invoice 1 of 1";
  if (idx === 1) return `Invoice ${idx} of ${total} — Deposit`;
  if (idx === total) return `Invoice ${idx} of ${total} — Final payment`;
  return `Invoice ${idx} of ${total} — Progress payment`;
}

function methodFriendly(method: string): string {
  switch (method) {
    case "check": return "Check";
    case "venmo": return "Venmo";
    case "zelle": return "Zelle";
    case "cashapp": return "Cash App";
    case "cash": return "Cash";
    case "ach": return "ACH / bank transfer";
    case "other": return "Other";
    default: return method;
  }
}

function isPastDue(dueDate: string | undefined): boolean {
  if (!dueDate) return false;
  const due = new Date(`${dueDate}T23:59:59Z`);
  return Number.isFinite(due.getTime()) && due.getTime() < Date.now();
}
