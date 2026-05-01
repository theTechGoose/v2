/**
 * /invoices island — receivables view matching the canonical reference
 * (reference/extracted/Paperwork Monsters Invoices.html). Despite the URL
 * saying "Invoices", the components share the Quotes code path with copy +
 * stage names swapped — that's why the classes are `.qph__*` / `.qkpi__*` /
 * `.qtrack__*` / `.qcard__*` (loaded from quotes.css).
 *
 * Structure:
 *   InvoicesHero  (.qph editorial header — outstanding total + sub)
 *   InvoicesKpis  (.qkpi 4-cell: Overdue / Out / Drafts / Paid this month)
 *   .qlay → 4 collapsible Track sections of InvoiceCard flip cards:
 *     01 Overdue · needs a poke      (sorted by daysOverdue desc, defaultOpen)
 *     02 Out for payment             (sorted by daysIn desc)
 *     03 Drafting                    (defaultOpen=false)
 *     04 Paid this month             (defaultOpen=false)
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  type Customer,
  dashboardClient,
  type Invoice,
} from "../clients/dashboard.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";
import { fmtMoney } from "../lib/format.ts";
import QuoteTrack from "./QuoteTrack.tsx";

interface State {
  loading: boolean;
  error: string | null;
  invoices: Invoice[];
  customers: Customer[];
}

const INITIAL: State = { loading: true, error: null, invoices: [], customers: [] };

const SHORT_MONTH = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDate(iso: string | undefined, now: Date): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${SHORT_MONTH[d.getMonth()]} ${d.getDate()}`
    : `${SHORT_MONTH[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface EnrichedInvoice extends Invoice {
  client: string;
  initials: string;
  invoiceRef: string;
  daysOverdue: number;
  daysIn: number;
  stage: "overdue" | "out" | "drafting" | "paid";
}

/** Detect a draft invoice broadly. The backend's status field is an open
 *  string; "draft" is the canonical value, but we also catch "drafting" /
 *  "drafted" variants and any pending invoice that has no issuedDate set
 *  (i.e. created but not yet sent). */
function isDraft(inv: Invoice): boolean {
  const status = (inv.status ?? "").toLowerCase();
  if (status === "draft" || status === "drafting" || status === "drafted") return true;
  // No status string AND no issuedDate AND not paid → still being prepped.
  if (!status && !inv.issuedDate && !inv.paidAt) return true;
  // Pending status but never issued → also a draft.
  if (status === "pending" && !inv.issuedDate) return true;
  return false;
}

function enrich(inv: Invoice, customers: Map<string, string>, now: Date): EnrichedInvoice {
  const client = (inv.customerId && customers.get(inv.customerId)) || "—";
  const today = now.toISOString().slice(0, 10);
  const due = inv.dueDate ?? "";
  const issued = inv.issuedDate ?? inv.createdAt ?? "";
  const isPaid = (inv.status ?? "").toLowerCase() === "paid" || !!inv.paidAt;
  const draft = !isPaid && isDraft(inv);
  const daysOverdue = (!isPaid && !draft && due && due < today)
    ? Math.floor((now.getTime() - new Date(due + "T00:00:00").getTime()) / (24 * 3600 * 1000))
    : 0;
  const daysIn = issued
    ? Math.max(0, Math.floor((now.getTime() - new Date(issued).getTime()) / (24 * 3600 * 1000)))
    : 0;
  const stage: EnrichedInvoice["stage"] =
    isPaid          ? "paid" :
    draft           ? "drafting" :
    daysOverdue > 0 ? "overdue" :
                      "out";
  return { ...inv, client, initials: initialsOf(client), invoiceRef: `INV-${inv.id.slice(0, 6).toUpperCase()}`, daysOverdue, daysIn, stage };
}

const STAGE_MOOD: Record<EnrichedInvoice["stage"], { from: string; to: string; shadow: string; statusFg: string; label: string }> = {
  overdue:  { from: "#FFD9D9", to: "#FF6B6B", shadow: "rgba(255,107,107,0.30)", statusFg: "#fff",       label: "Overdue" },
  out:      { from: "#C8DDE0", to: "#56969E", shadow: "rgba(86,150,158,0.28)",  statusFg: "#0F3036",    label: "Out" },
  drafting: { from: "#E1D7CD", to: "#9C8074", shadow: "rgba(156,128,116,0.32)", statusFg: "#3F2D24",    label: "Draft" },
  paid:     { from: "#CFE5C8", to: "#5FA34F", shadow: "rgba(81,152,67,0.30)",   statusFg: "#1F3F18",    label: "Paid" },
};

export default function InvoicesPage() {
  const [s, setS] = useState<State>(INITIAL);

  useEffect(() => {
    let alive = true;
    Promise.all([
      dashboardClient.invoices(undefined).catch(() => [] as Invoice[]),
      dashboardClient.customers().catch(() => [] as Customer[]),
    ]).then(([invoices, customers]) => {
      if (!alive) return;
      setS({ loading: false, error: null, invoices, customers });
    }).catch((err: Error) => {
      if (!alive) return;
      setS({ ...INITIAL, loading: false, error: err.message });
    });
    return () => { alive = false; };
  }, []);

  const customerNames = useMemo(() => new Map(s.customers.map((c) => [c.id, c.name])), [s.customers]);

  if (s.loading) {
    return (
      <>
        <ShimmerStyle />
        <PageHeaderSkeleton />
        <CardGridSkeleton rows={2} />
      </>
    );
  }
  if (s.error) {
    return <div class="qpage-error">Couldn't load invoices: {s.error}</div>;
  }

  const now = new Date();
  const enriched = s.invoices.map((i) => enrich(i, customerNames, now));

  const overdue  = enriched.filter((i) => i.stage === "overdue").sort((a, b) => b.daysOverdue - a.daysOverdue);
  const out      = enriched.filter((i) => i.stage === "out").sort((a, b) => b.daysIn - a.daysIn);
  const drafting = enriched.filter((i) => i.stage === "drafting");
  const monthCutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  const paidThisMonth = enriched.filter((i) =>
    i.stage === "paid" && i.paidAt && new Date(i.paidAt) >= monthCutoff
  );

  const outstandingTotal = [...overdue, ...out].reduce((sum, i) => sum + (i.amount ?? 0), 0);
  const overdueTotal     = overdue.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  const outTotal         = out.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  const paidThisMonthTotal = paidThisMonth.reduce((sum, i) => sum + (i.amount ?? 0), 0);

  return (
    <>
      <InvoicesHero
        outstandingTotal={outstandingTotal}
        outstandingCount={overdue.length + out.length}
        overdueCount={overdue.length}
        totalInvoiceCount={enriched.length}
      />
      <InvoicesKpis
        overdueCount={overdue.length}
        overdueTotal={overdueTotal}
        outCount={out.length}
        outTotal={outTotal}
        draftingCount={drafting.length}
        paidCount={paidThisMonth.length}
        paidTotal={paidThisMonthTotal}
      />

      <div class="qlay">
        <div>
          <QuoteTrack num="01" title="Overdue · needs a poke" count={overdue.length} unit="invoice" defaultOpen storageKey="invoices:track:01">
            {overdue.length === 0
              ? <EmptyTrack hint="No overdue invoices. Nice work." />
              : <div class="qcards">{overdue.map((inv, i) => <InvoiceCard key={inv.id} inv={inv} idx={i} now={now} />)}</div>}
          </QuoteTrack>

          <QuoteTrack num="02" title="Out for payment" count={out.length} unit="invoice" defaultOpen storageKey="invoices:track:02">
            {out.length === 0
              ? <EmptyTrack hint="Nothing waiting. Send a quote to get paid." />
              : <div class="qcards">{out.map((inv, i) => <InvoiceCard key={inv.id} inv={inv} idx={i} now={now} />)}</div>}
          </QuoteTrack>

          <QuoteTrack num="03" title="Drafting" count={drafting.length} unit="invoice" defaultOpen={false} storageKey="invoices:track:03">
            {drafting.length === 0
              ? <EmptyTrack hint="No drafts in progress. Open the assistant to start one." />
              : <div class="qcards">{drafting.map((inv, i) => <InvoiceCard key={inv.id} inv={inv} idx={i} now={now} />)}</div>}
          </QuoteTrack>

          <QuoteTrack num="04" title="Paid this month" count={paidThisMonth.length} unit="invoice" defaultOpen={false} storageKey="invoices:track:04">
            {paidThisMonth.length === 0
              ? <EmptyTrack hint="Nothing paid yet this month — payments land here once they clear." />
              : <div class="qcards">{paidThisMonth.map((inv, i) => <InvoiceCard key={inv.id} inv={inv} idx={i} now={now} />)}</div>}
          </QuoteTrack>
        </div>
      </div>
    </>
  );
}

/* ---------------- Hero ---------------- */

function InvoicesHero(
  { outstandingTotal, outstandingCount, overdueCount, totalInvoiceCount }: {
    outstandingTotal: number;
    outstandingCount: number;
    overdueCount: number;
    totalInvoiceCount: number;
  },
) {
  const trulyEmpty = totalInvoiceCount === 0;
  const fresh = !trulyEmpty && outstandingCount === 0;
  return (
    <header class="qph">
      <div class="qph__copy">
        <div class="qph__eyebrow">
          <span class="qph__eyebrow-dot" /> Receivables · this week
        </div>
        <h1 class="qph__title">
          {trulyEmpty
            ? <>No invoices yet — <em>let's start the river</em>.</>
            : fresh
            ? <>All clear — <em>nothing outstanding</em>.</>
            : (
              <>
                <em>{fmtMoney(outstandingTotal)}</em> on the way<br />
                across {outstandingCount} {outstandingCount === 1 ? "invoice" : "invoices"}.
              </>
            )}
        </h1>
        <p class="qph__sub">
          {trulyEmpty
            ? <>Once a contract is signed, drop the first invoice in. The monsters track every one — overdue, en route, drafting, paid — so you don't have to remember which is which.</>
            : overdueCount > 0
            ? <><strong>{overdueCount}</strong> {overdueCount === 1 ? "is" : "are"} past due — start there. The monsters drafted a friendly nudge for each one.</>
            : <>Nothing past due. The monsters are watching for the next billing cycle.</>}
        </p>
        <div class="qph__cta-row">
          <a class="qph__cta" href={`/assistant?seed=${encodeURIComponent("Draft a new invoice for me.")}`}>
            <I d={ICN.plus} size={14} sw={2.5} /> New invoice
          </a>
        </div>
      </div>
    </header>
  );
}

/* ---------------- KPIs ---------------- */

function InvoicesKpis(
  { overdueCount, overdueTotal, outCount, outTotal, draftingCount, paidCount, paidTotal }: {
    overdueCount: number;
    overdueTotal: number;
    outCount: number;
    outTotal: number;
    draftingCount: number;
    paidCount: number;
    paidTotal: number;
  },
) {
  return (
    <div class="qkpi">
      <div class={`qkpi__cell${overdueCount > 0 ? " qkpi__cell--accent" : ""}`}>
        <div class="qkpi__lbl">Overdue</div>
        <div class="qkpi__val">{fmtMoney(overdueTotal)}</div>
        <div class="qkpi__sub">{overdueCount} {overdueCount === 1 ? "invoice" : "invoices"}</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Out for payment</div>
        <div class="qkpi__val">{fmtMoney(outTotal)}</div>
        <div class="qkpi__sub">{outCount} on the way</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Drafting</div>
        <div class="qkpi__val">{draftingCount}</div>
        <div class="qkpi__sub">{draftingCount === 0 ? "no drafts open" : "finish + send"}</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Paid this month</div>
        <div class="qkpi__val">{fmtMoney(paidTotal)}</div>
        <div class="qkpi__sub">{paidCount} cleared</div>
      </div>
    </div>
  );
}

/* ---------------- Empty track copy ---------------- */

function EmptyTrack({ hint }: { hint: string }) {
  return (
    <div style="padding:14px 4px;color:var(--fg-muted, #6b7560);font-size:13.5px;line-height:1.5">
      {hint}
    </div>
  );
}

/* ---------------- Invoice card (flip) ---------------- */

function InvoiceCard({ inv, idx, now }: { inv: EnrichedInvoice; idx: number; now: Date }) {
  const [flipped, setFlipped] = useState(false);
  const mood = STAGE_MOOD[inv.stage];
  const cta =
    inv.stage === "overdue"  ? "Send nudge" :
    inv.stage === "out"      ? "View invoice" :
    inv.stage === "drafting" ? "Finish + send" :
                               "View receipt";
  const subline =
    inv.stage === "overdue"  ? `${inv.daysOverdue}d overdue · due ${fmtDate(inv.dueDate, now)}` :
    inv.stage === "out"      ? `Out ${inv.daysIn}d · due ${fmtDate(inv.dueDate, now)}` :
    inv.stage === "drafting" ? `Draft started ${fmtDate(inv.issuedDate ?? inv.createdAt, now)}` :
                               `Paid ${fmtDate(inv.paidAt, now)}`;
  return (
    <article
      class={`qcard ${flipped ? "qcard--flipped" : ""}`}
      onClick={(e) => {
        if (flipped) return;
        const t = e.target as HTMLElement;
        if (t.closest(".qcard__cta, .qcard__back")) return;
        setFlipped(true);
      }}
      style={`--mood-from:${mood.from};--mood-to:${mood.to};--mood-shadow:${mood.shadow};--mood-status:${mood.statusFg}`}
    >
      <div class="qcard__mood">
        <div class="qcard__numeral">{String(idx + 1).padStart(2, "0")}</div>
        <div class="qcard__status"><span class="qcard__status-dot" /> {mood.label}</div>
      </div>
      <div class="qcard__av">{inv.initials}</div>
      <div class="qcard__body">
        <div class="qcard__client-name">{inv.client} · {inv.invoiceRef}</div>
        <h3 class="qcard__title">{fmtMoney(inv.amount)}</h3>
        <p class="qcard__story">{subline}</p>
      </div>
      <div class="qcard__foot">
        <button type="button" class="qcard__cta" onClick={(e) => e.stopPropagation()}>
          {cta} <span style="display:inline-block;transition:transform 240ms">→</span>
        </button>
        <div class="qcard__val-wrap">
          <div class="qcard__val-lbl">{inv.stage === "paid" ? "Cleared" : "Due"}</div>
          <div class="qcard__val-num" style="font-size:13px">
            {inv.stage === "paid"
              ? fmtDate(inv.paidAt, now)
              : fmtDate(inv.dueDate, now)}
          </div>
        </div>
      </div>

      <div class="qcard__back" aria-hidden={!flipped}>
        <div class="qcard__back-head">
          <button
            type="button"
            class="qcard__back-close"
            onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
            aria-label="Close"
          >
            <I d={ICN.x} size={14} sw={2.5} />
          </button>
          <div class="qcard__back-eyebrow">Invoice detail</div>
          <p class="qcard__back-big">
            {fmtMoney(inv.amount)}<small> · {mood.label}</small>
          </p>
        </div>
        <div class="qcard__back-body">
          <p class="qcard__read">
            {inv.stage === "overdue" && <>Past due {inv.daysOverdue} {inv.daysOverdue === 1 ? "day" : "days"}. A friendly text usually unsticks it.</>}
            {inv.stage === "out"      && <>Issued {fmtDate(inv.issuedDate ?? inv.createdAt, now)}. Due {fmtDate(inv.dueDate, now)}.</>}
            {inv.stage === "drafting" && <>Draft started {fmtDate(inv.issuedDate ?? inv.createdAt, now)}. Open it to finish and send.</>}
            {inv.stage === "paid"     && <>Cleared {fmtDate(inv.paidAt, now)}. Receipt sent automatically.</>}
          </p>
        </div>
        <div class="qcard__back-foot">
          <button type="button" onClick={(e) => e.stopPropagation()}>{cta.replace(/ →$/, "")}</button>
          <button type="button" onClick={(e) => e.stopPropagation()}>Open</button>
          <button type="button" onClick={(e) => e.stopPropagation()}>Text client</button>
        </div>
      </div>
    </article>
  );
}
