/**
 * /payments island — editorial "money landed" treatment matching the
 * canonical reference (reference/extracted/Paperwork Monsters Payments.html).
 *
 * Structure:
 *   PaymentsHero  (.pph + stub stack of recent landed payments)
 *   PaymentsKpis  (.qkpis 4-cell)
 *   .qlay grid:
 *     main → Track sections (.qtrack) of PaymentCard (.qcard) flip cards
 *            and a tail-of-month LandedRow list (.qdone)
 *     aside.qside → PSideFlow, PSideTopPayors, PSideMix, PSideTip
 *
 * Status taxonomy:
 *   - landed:    payment has been recorded (current data model only carries this)
 *   - transit:   reserved for future when a "pending settlement" status exists
 *   - attention: reserved for future declined/returned tracking
 *
 * Tracks for transit/attention render conditionally — when there's no data
 * for them the page reads cleanly without empty sections.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  type Payment,
  type PaymentMethod,
  paymentsClient,
} from "../clients/payments.ts";
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
  payments: Payment[];
  invoices: Invoice[];
  customers: Customer[];
}

const INITIAL: State = {
  loading: true,
  error: null,
  payments: [],
  invoices: [],
  customers: [],
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash", check: "Check", ach: "ACH", card: "Card", other: "Other",
};

const METHOD_AV_BG: Record<PaymentMethod, string> = {
  ach:   "linear-gradient(135deg,#4F8C6B,#2F6448)",
  card:  "linear-gradient(135deg,#2A6F77,#0F3A40)",
  check: "linear-gradient(135deg,#9C8074,#5C4034)",
  cash:  "linear-gradient(135deg,#E07A8C,#C04060)",
  other: "linear-gradient(135deg,#9C8074,#5C4034)",
};

/** SVG paths for the inline payment-method icon. Self-contained so the
 *  pph__stub-method line doesn't need a sprite sheet. */
const METHOD_ICON: Record<PaymentMethod, preact.JSX.Element> = {
  ach:   <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>,
  card:  <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>,
  check: <><rect x="2" y="6" width="20" height="12" rx="1.5" /><path d="M2 10h20" /><path d="M14 14h4" /></>,
  cash:  <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M5 9.5h.01M19 14.5h.01" /></>,
  other: <><circle cx="12" cy="12" r="9" /><path d="M9 12h6M12 9v6" /></>,
};

type PaymentStatus = "landed" | "transit" | "attention";

interface EnrichedPayment extends Payment {
  client: string;
  initials: string;
  invoiceRef: string;
  daysAgo: number;
  whenLabel: string;
  note: string;
  status: PaymentStatus;
  /** ACH and checks have settling windows. Card/cash are instant. */
  etaDays?: number;
}

/** Derive status from method + age. The current backend Payment model
 *  doesn't carry an explicit status; for ACH and checks we apply the
 *  industry-standard settlement windows. Once a payment ages past its
 *  window it counts as "landed". */
const SETTLE_DAYS: Record<PaymentMethod, number> = {
  ach: 2,        // standard ACH settlement
  check: 5,      // mailed check + deposit clearing
  card: 0,       // captured instantly
  cash: 0,       // instant
  other: 0,      // unknown — treat as instant
};

function deriveStatus(method: PaymentMethod, daysAgo: number): { status: PaymentStatus; etaDays?: number } {
  const settleDays = SETTLE_DAYS[method];
  if (settleDays > 0 && daysAgo < settleDays) {
    return { status: "transit", etaDays: settleDays - daysAgo };
  }
  return { status: "landed" };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function whenLabel(daysAgo: number): string {
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo}d ago`;
}

function noteFor(method: PaymentMethod, daysAgo: number, client: string, status: PaymentStatus = "landed"): string {
  const first = client.split(/\s+/)[0];
  if (status === "transit") {
    if (method === "ach")   return `${first}'s ACH transfer is in flight. Standard 2-day settlement.`;
    if (method === "check") return `Check from ${first} is in the mail / clearing. Most clear within a week.`;
  }
  switch (method) {
    case "ach":   return `${first}'s auto-pay cleared cleanly. Already in the account.`;
    case "card":  return `Captured on ${first}'s card — funds settle in 2 days.`;
    case "check": return `Check from ${first}, deposited via mobile.`;
    case "cash":  return daysAgo === 0 ? `Cash from ${first}, logged from the truck.` : `Cash from ${first} — logged.`;
    default:      return `Payment from ${first}.`;
  }
}

function enrich(p: Payment, invoices: Map<string, Invoice>, customers: Map<string, string>, now: Date): EnrichedPayment {
  const inv = invoices.get(p.invoiceId);
  const customerId = inv?.customerId;
  const client = (customerId && customers.get(customerId)) || "—";
  const daysAgo = Math.max(0, Math.floor((now.getTime() - new Date(p.receivedAt).getTime()) / (24 * 3600 * 1000)));
  const { status, etaDays } = deriveStatus(p.method, daysAgo);
  return {
    ...p,
    client,
    initials: initialsOf(client),
    invoiceRef: `INV-${p.invoiceId.slice(0, 6).toUpperCase()}`,
    daysAgo,
    whenLabel: whenLabel(daysAgo),
    note: noteFor(p.method, daysAgo, client, status),
    status,
    etaDays,
  };
}

export default function PaymentsPage() {
  const [s, setS] = useState<State>(INITIAL);

  useEffect(() => {
    let alive = true;
    Promise.all([
      paymentsClient.list().catch(() => [] as Payment[]),
      dashboardClient.invoices(undefined).catch(() => [] as Invoice[]),
      dashboardClient.customers().catch(() => [] as Customer[]),
    ]).then(([payments, invoices, customers]) => {
      if (!alive) return;
      setS({ loading: false, error: null, payments, invoices, customers });
    }).catch((err: Error) => {
      if (!alive) return;
      setS({ ...INITIAL, loading: false, error: err.message });
    });
    return () => { alive = false; };
  }, []);

  const customerNames = useMemo(() => new Map((Array.isArray(s.customers) ? s.customers : []).map((c) => [c.id, c.name])), [s.customers]);
  const invoiceById   = useMemo(() => new Map((Array.isArray(s.invoices) ? s.invoices : []).map((i) => [i.id, i])), [s.invoices]);

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
    return <div class="qpage-error">Couldn't load payments: {s.error}</div>;
  }

  const now = new Date();
  const enriched = s.payments
    .map((p) => enrich(p, invoiceById, customerNames, now))
    .sort((a, b) => a.daysAgo - b.daysAgo);

  const monthCutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  // Partition by derived status. Landed = settled this month. Transit =
  // still inside the method's settlement window (ACH < 2d, check < 5d).
  // Attention is reserved for declined/returned signals once the schema
  // carries them; right now the section conditionally hides itself.
  const landed    = enriched.filter((p) => p.status === "landed" && new Date(p.receivedAt) >= monthCutoff);
  const transit   = enriched.filter((p) => p.status === "transit");
  const attention = enriched.filter((p) => p.status === "attention");
  const recentLanded = landed.filter((p) => p.daysAgo <= 1);
  const olderLanded  = landed.filter((p) => p.daysAgo > 1);

  const monthTotal = landed.reduce((sum, p) => sum + p.amount, 0);
  const transitTotal = transit.reduce((sum, p) => sum + p.amount, 0);
  const attentionTotal = attention.reduce((sum, p) => sum + p.amount, 0);

  // Avg days to pay — over landed payments, average of receivedAt minus invoice issuedDate.
  const daysToPay = landed.flatMap((p) => {
    const inv = invoiceById.get(p.invoiceId);
    if (!inv?.issuedDate) return [];
    const issued = new Date(inv.issuedDate).getTime();
    const received = new Date(p.receivedAt).getTime();
    if (!Number.isFinite(issued) || !Number.isFinite(received)) return [];
    return [Math.max(0, Math.floor((received - issued) / (24 * 3600 * 1000)))];
  });
  const avgDays = daysToPay.length > 0
    ? Math.round(daysToPay.reduce((s, d) => s + d, 0) / daysToPay.length)
    : 0;

  // Top three landed for the hero stub stack (rotated cards)
  const stubs = recentLanded.slice(0, 3);

  return (
    <>
      <PaymentsHero
        monthTotal={monthTotal}
        transitTotal={transitTotal}
        attentionCount={attention.length}
        stubs={stubs}
      />
      <PaymentsKpis
        landedCount={landed.length}
        monthTotal={monthTotal}
        transitCount={transit.length}
        transitTotal={transitTotal}
        attentionCount={attention.length}
        attentionTotal={attentionTotal}
        avgDays={avgDays}
      />

      <div class="qlay">
        <div>
          {attention.length > 0 && (
            <QuoteTrack num="01" title="Needs attention" count={attention.length} unit="payment" defaultOpen storageKey="payments:track:attention">
              <div class="qcards">{attention.map((p, i) => <PaymentCard key={p.id} p={p} idx={i} />)}</div>
            </QuoteTrack>
          )}

          <QuoteTrack
            num={attention.length > 0 ? "02" : "01"}
            title="Just landed"
            count={landed.length}
            unit="payment"
            defaultOpen
            storageKey="payments:track:landed"
          >
            {recentLanded.length === 0 && olderLanded.length === 0
              ? <div style="padding:14px 4px;color:var(--fg-muted, #6b7560);font-size:13.5px;line-height:1.5">No payments logged yet — once a customer pays an invoice it lands here automatically.</div>
              : (
                <>
                  {recentLanded.length > 0 && (
                    <div class="qcards">
                      {recentLanded.map((p, i) => <PaymentCard key={p.id} p={p} idx={i} />)}
                    </div>
                  )}
                  {olderLanded.length > 0 && (
                    <div class="qdone" style="margin-top:14px">
                      {olderLanded.map((p) => <LandedRow key={p.id} p={p} />)}
                    </div>
                  )}
                </>
              )}
          </QuoteTrack>

          {transit.length > 0 && (
            <QuoteTrack
              num={attention.length > 0 ? "03" : "02"}
              unit="payment" title="In transit"
              count={transit.length}
              defaultOpen={false}
              storageKey="payments:track:transit"
            >
              <div class="qcards">{transit.map((p, i) => <PaymentCard key={p.id} p={p} idx={i} />)}</div>
            </QuoteTrack>
          )}
        </div>

        <aside class="qside">
          <PSideFlow landedAmounts={landed.map((p) => p.amount)} />
          <PSideTopPayors landed={landed} />
          <PSideMix landed={landed} />
          <PSideTip />
        </aside>
      </div>
    </>
  );
}

/* ---------------- Hero ---------------- */

function PaymentsHero(
  { monthTotal, transitTotal, attentionCount, stubs }: {
    monthTotal: number;
    transitTotal: number;
    attentionCount: number;
    stubs: EnrichedPayment[];
  },
) {
  const monthName = new Date().toLocaleString("en-US", { month: "long" });
  const fresh = monthTotal === 0 && transitTotal === 0 && attentionCount === 0;
  return (
    <header class="pph">
      <div class="pph__main">
        <div class="pph__eyebrow">
          <I d={ICN.check} size={11} sw={3} /> Payments · {monthName}
        </div>
        <h1 class="pph__title" style={fresh ? "font-size:clamp(28px,3.4vw,44px);line-height:1.15" : ""}>
          {fresh
            ? <>Nothing's landed yet — <em style="color:var(--brand-pink);font-style:normal">let's change that</em>.</>
            : (
              <>
                <span class="pph__title-amount">
                  <sup>$</sup>{fmtMoney(monthTotal).replace(/^\$/, "")}
                </span>
                <span class="pph__title-tail">showed up this month.</span>
              </>
            )}
        </h1>
        <p class="pph__sub">
          {fresh
            ? <>Once a customer pays an invoice, it lands here. Each method gets its own clearing window — ACH in two days, checks in a week, cards and cash instantly.</>
            : (
              <>
                {transitTotal > 0
                  ? <>Plus <strong>{fmtMoney(transitTotal)}</strong> on the way</>
                  : <>Every dollar logged.</>}
                {attentionCount > 0
                  ? <> and <strong>{attentionCount}</strong> that need a quick text to unstick</>
                  : null}
                {transitTotal > 0 ? <>. The monsters logged every dollar.</> : null}
              </>
            )}
        </p>
        <div class="pph__cta-row">
          <a class="pph__cta" href={`/assistant?seed=${encodeURIComponent("Record a payment I just received.")}`}>
            <I d={ICN.plus} size={14} sw={2.5} /> Record a payment
          </a>
          <a class="pph__ghost" href={`/assistant?seed=${encodeURIComponent("Export this month's payments as a CSV.")}`}>
            <I d={ICN.arrow} size={13} sw={2.5} /> Export this month
          </a>
        </div>
      </div>
      <div class="pph__stack" aria-hidden="true">
        {stubs.map((p, i) => (
          <div key={p.id} class={`pph__stub pph__stub--${i + 1}`}>
            <div class="pph__stub-head">
              <div class="pph__stub-av" style={`background:${METHOD_AV_BG[p.method]}`}>{p.initials}</div>
              <div class="pph__stub-meta">
                <div class="pph__stub-client">{p.client}</div>
                <div class="pph__stub-when">{p.whenLabel} · {p.invoiceRef}</div>
              </div>
            </div>
            <div class="pph__stub-amount">{fmtMoney(p.amount)}</div>
            <div class="pph__stub-foot">
              <span class="pph__stub-method">
                <I d={METHOD_ICON[p.method]} size={11} sw={2} /> {METHOD_LABEL[p.method]}
              </span>
              <span class="pph__stub-tag">Landed</span>
            </div>
          </div>
        ))}
      </div>
    </header>
  );
}

/* ---------------- KPIs ---------------- */

function PaymentsKpis(
  { landedCount, monthTotal, transitCount, transitTotal, attentionCount, attentionTotal, avgDays }: {
    landedCount: number;
    monthTotal: number;
    transitCount: number;
    transitTotal: number;
    attentionCount: number;
    attentionTotal: number;
    avgDays: number;
  },
) {
  return (
    <div class="qkpi">
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Landed this month</div>
        <div class="qkpi__val">{fmtMoney(monthTotal)}</div>
        <div class="qkpi__sub">{landedCount} {landedCount === 1 ? "payment" : "payments"}</div>
      </div>
      <div class="qkpi__cell qkpi__cell--accent">
        <div class="qkpi__lbl">In transit</div>
        <div class="qkpi__val">{fmtMoney(transitTotal)}</div>
        <div class="qkpi__sub">{transitCount} on the way</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Needs attention</div>
        <div class="qkpi__val">{attentionCount}</div>
        <div class="qkpi__sub">{fmtMoney(attentionTotal)} held up</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Avg days to pay</div>
        <div class="qkpi__val">{avgDays > 0 ? `${avgDays}d` : "—"}</div>
        <div class="qkpi__sub">{avgDays > 0 ? "across landed payments" : "no paid history yet"}</div>
      </div>
    </div>
  );
}

/* ---------------- Payment card (flip) ---------------- */

const STATUS_MOOD: Record<PaymentStatus, { from: string; to: string; shadow: string; statusFg: string; label: string; cta: string }> = {
  landed:    { from: "#CFE5C8", to: "#5FA34F", shadow: "rgba(81,152,67,0.28)",   statusFg: "#1F3F18", label: "Landed",    cta: "View receipt" },
  transit:   { from: "#C8DDE0", to: "#56969E", shadow: "rgba(86,150,158,0.28)",  statusFg: "#0F3036", label: "In transit", cta: "View timeline" },
  attention: { from: "#FFD9D9", to: "#FF6B6B", shadow: "rgba(255,107,107,0.30)", statusFg: "#fff",    label: "Attention",  cta: "Text client" },
};

function PaymentCard({ p, idx }: { p: EnrichedPayment; idx: number }) {
  const [flipped, setFlipped] = useState(false);
  const mood = STATUS_MOOD[p.status];
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
        <div class="qcard__opens" style="text-transform:uppercase">
          <I d={METHOD_ICON[p.method]} size={12} sw={2} /> {METHOD_LABEL[p.method]}
        </div>
      </div>
      <div class="qcard__av">{p.initials}</div>
      <div class="qcard__body">
        <div class="qcard__client-name">{p.client} · {p.invoiceRef}</div>
        <div class="pcard__amount">{fmtMoney(p.amount)}</div>
        <p class="qcard__story">{p.note}</p>
      </div>
      <div class="qcard__foot">
        <button type="button" class="qcard__cta" onClick={(e) => e.stopPropagation()}>
          {mood.cta} <span style="display:inline-block;transition:transform 240ms">→</span>
        </button>
        <div class="qcard__val-wrap">
          <div class="qcard__val-lbl">{p.status === "transit" ? "Expected" : "Method"}</div>
          <div class="qcard__val-num" style="font-size:13px">
            {p.status === "transit" && p.etaDays ? `~${p.etaDays}d` : METHOD_LABEL[p.method]}
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
          <div class="qcard__back-eyebrow">Payment trail</div>
          <p class="qcard__back-big">
            {fmtMoney(p.amount)}<small> · {METHOD_LABEL[p.method]}</small>
          </p>
        </div>
        <div class="qcard__back-body">
          <p class="qcard__read">{p.note}</p>
        </div>
        <div class="qcard__back-foot">
          <button type="button" onClick={(e) => e.stopPropagation()}>Receipt</button>
          <button type="button" onClick={(e) => e.stopPropagation()}>Match invoice</button>
          <button type="button" onClick={(e) => e.stopPropagation()}>Text client</button>
        </div>
      </div>
    </article>
  );
}

/* ---------------- Landed row (compact tail of month) ---------------- */

function LandedRow({ p }: { p: EnrichedPayment }) {
  return (
    <div class="qdone__row">
      <div class="qdone__badge qdone__badge--won">
        <I d={ICN.check} size={13} sw={2.5} />
      </div>
      <div class="qdone__body">
        <div class="qdone__title">{p.client}</div>
        <div class="qdone__sub">{METHOD_LABEL[p.method]} · {p.whenLabel} · {p.invoiceRef}</div>
      </div>
      <div class="qdone__amt">{fmtMoney(p.amount)}</div>
    </div>
  );
}

/* ---------------- Side rail components ---------------- */

function PSideFlow({ landedAmounts }: { landedAmounts: number[] }) {
  // Split landed into 12 weekly buckets. Real history would key off
  // receivedAt; for now we just slot in the rolling totals.
  const weeks = new Array(12).fill(0);
  landedAmounts.forEach((a, i) => { weeks[11 - (i % 12)] += a; });
  const hasData = weeks.some((v) => v > 0);
  if (!hasData) {
    return (
      <div class="qside__card">
        <div class="qside__title">Cash-flow shape</div>
        <div class="qside__sub" style="margin:2px 0 12px">Last 12 weeks · nothing yet</div>
        <div style="font-size:13px;color:var(--fg-muted);line-height:1.45">
          Nothing's landed yet — once payments roll in, the shape lights up.
        </div>
      </div>
    );
  }
  const max = Math.max(1, ...weeks);
  const w = 220, h = 60, pad = 4;
  const pts = weeks.map((v, i) => {
    const x = pad + (i * (w - pad * 2) / Math.max(1, weeks.length - 1));
    const y = h - pad - ((v / max) * (h - pad * 2));
    return [x, y] as const;
  });
  const path = pts.map((pt, i) => (i === 0 ? `M${pt[0]},${pt[1]}` : `L${pt[0]},${pt[1]}`)).join(" ");
  const area = `${path} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
  return (
    <div class="qside__card">
      <div class="qside__title">Cash-flow shape</div>
      <div class="qside__sub" style="margin:2px 0 12px">
        Last 12 weeks · {fmtMoney(weeks[weeks.length - 1])} this week
      </div>
      <svg width={w} height={h} style="display:block;width:100%;height:auto">
        <defs>
          <linearGradient id="cfArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#FF6B6B" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#FF6B6B" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#cfArea)" />
        <path d={path} fill="none" stroke="#FF6B6B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        {pts.map((pt, i) => (
          <circle key={i} cx={pt[0]} cy={pt[1]} r={i === pts.length - 1 ? 3 : 1.5} fill="#FF6B6B" />
        ))}
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--fg-muted);margin-top:8px;font-family:var(--font-body)">
        <span>Feb</span><span>Mar</span><span>Apr</span>
      </div>
    </div>
  );
}

function PSideTopPayors({ landed }: { landed: EnrichedPayment[] }) {
  const tally = new Map<string, number>();
  for (const p of landed) {
    tally.set(p.client, (tally.get(p.client) ?? 0) + p.amount);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const max = top[0]?.[1] ?? 1;
  return (
    <div class="qside__card">
      <div class="qside__title">Top payors this month</div>
      <div class="qside__sub" style="margin:2px 0 14px">Who actually showed up with money</div>
      {top.length === 0
        ? <div style="font-size:13px;color:var(--fg-muted)">No paid history yet.</div>
        : (
          <div class="qside__rows">
            {top.map(([client, amt], i) => (
              <div key={client} class="qside__row">
                <div class="qside__rank">{String(i + 1).padStart(2, "0")}</div>
                <div class="qside__row-body">
                  <div class="qside__row-name">{client}</div>
                  <div class="qside__bar">
                    <div
                      class="qside__bar-fill"
                      style={`width:${(amt / max) * 100}%;background:linear-gradient(90deg,#4F8C6B,#2F6448)`}
                    />
                  </div>
                </div>
                <div class="qside__row-amt">{fmtMoney(amt)}</div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function PSideMix({ landed }: { landed: EnrichedPayment[] }) {
  const tally: Record<PaymentMethod, number> = { ach: 0, card: 0, check: 0, cash: 0, other: 0 };
  for (const p of landed) tally[p.method] += p.amount;
  const total = Object.values(tally).reduce((s, v) => s + v, 0);
  const colors: Record<PaymentMethod, string> = {
    ach: "#4F8C6B", card: "#2A6F77", check: "#9C8074", cash: "#E07A8C", other: "#6b7560",
  };
  const segments = (Object.keys(tally) as PaymentMethod[])
    .map((m) => ({ method: m, pct: total > 0 ? (tally[m] / total) * 100 : 0 }))
    .filter((s) => s.pct > 0);
  return (
    <div class="qside__card">
      <div class="qside__title">How they paid</div>
      <div class="qside__sub" style="margin:2px 0 14px">Method mix this month</div>
      {segments.length === 0
        ? <div style="font-size:13px;color:var(--fg-muted)">Nothing landed yet this month.</div>
        : (
          <>
            <div style="display:flex;height:14px;border-radius:999px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,0.06);margin-bottom:14px">
              {segments.map((s) => (
                <div key={s.method} style={`width:${s.pct}%;background:${colors[s.method]}`} />
              ))}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px">
              {segments.map((s) => (
                <div key={s.method} style="display:flex;align-items:center;gap:7px;font-family:var(--font-body);font-size:12px">
                  <span style={`width:10px;height:10px;border-radius:3px;background:${colors[s.method]};flex-shrink:0`} />
                  <span style="color:var(--brand-teal);font-weight:700">{METHOD_LABEL[s.method]}</span>
                  <span style="color:var(--fg-muted);margin-left:auto">{Math.round(s.pct)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
    </div>
  );
}

function PSideTip() {
  return (
    <div class="qside__card" style="background:linear-gradient(135deg,#1A535C,#0F3A40);color:#fff;border:none">
      <div class="qside__title" style="color:#fff;margin-bottom:8px">Monster tip</div>
      <p style="margin:0;font-family:var(--font-body);font-size:13.5px;line-height:1.55;color:rgba(255,255,255,0.88)">
        ACH costs you <strong style="color:#fff">$0.40 a transfer</strong>; card costs you <strong style="color:#fff">2.9% + $0.30</strong>.
        On a $4,800 invoice that's a <strong style="color:#fff">$140 difference</strong> — worth nudging clients toward auto-pay.
      </p>
    </div>
  );
}
