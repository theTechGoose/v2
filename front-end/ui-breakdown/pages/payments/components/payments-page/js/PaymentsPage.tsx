/**
 * /payments island — editorial "money landed" treatment matching the
 * canonical reference (reference/extracted/Paperwork Monster Payments.html).
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
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";

/** Plural helper bound to an explicit language (the reactive `tn` reads the
 *  global lang signal; the logged-in app threads `lang` explicitly). */
const tnFor = (lang: Lang, key: string, n: number, vars?: Record<string, string | number>): string =>
  tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n, ...vars });
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

/** i18n key per method. Reuses the seeded shared paymentMethod.* keys where
 *  the wording matches exactly; ACH/Card carry this page's own short labels. */
const METHOD_KEY: Record<PaymentMethod, string> = {
  cash: "paymentMethod.cash",
  check: "paymentMethod.check",
  ach: "paymentsPage.method.ach",
  card: "paymentsPage.method.card",
  venmo: "paymentMethod.venmo",
  zelle: "paymentMethod.zelle",
  cashapp: "paymentMethod.cashApp",
  paypal: "paymentMethod.paypal",
  other: "paymentMethod.other",
};

const methodLabel = (lang: Lang, m: PaymentMethod): string =>
  tFor(lang, METHOD_KEY[m]);

const METHOD_AV_BG: Record<PaymentMethod, string> = {
  ach: "linear-gradient(135deg,#4F8C6B,#2F6448)",
  card: "linear-gradient(135deg,#2A6F77,#0F3A40)",
  check: "linear-gradient(135deg,#9C8074,#5C4034)",
  cash: "linear-gradient(135deg,#E07A8C,#C04060)",
  venmo: "linear-gradient(135deg,#3D95CE,#1F6FA8)",
  zelle: "linear-gradient(135deg,#8E5BD6,#6A2CB8)",
  cashapp: "linear-gradient(135deg,#4FB35F,#2E8B40)",
  paypal: "linear-gradient(135deg,#2A6F9E,#143A6B)",
  other: "linear-gradient(135deg,#9C8074,#5C4034)",
};

/** Shared glyph for the peer-to-peer wallets (Venmo/Zelle/Cash App/PayPal):
 *  a phone with a $ — returned as bare SVG children to drop into <I d=…>. */
function P2PIcon() {
  return (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2.5" />
      <path d="M12 6v1.5M12 16.5V18M10 9.5h3a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3h3" />
    </>
  );
}

/** SVG paths for the inline payment-method icon. Self-contained so the
 *  pph__stub-method line doesn't need a sprite sheet. */
const METHOD_ICON: Record<PaymentMethod, preact.JSX.Element> = {
  ach: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  check: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="1.5" />
      <path d="M2 10h20" />
      <path d="M14 14h4" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M5 9.5h.01M19 14.5h.01" />
    </>
  ),
  // Peer-to-peer wallets share a phone-with-$ glyph; the label disambiguates.
  venmo: <P2PIcon />,
  zelle: <P2PIcon />,
  cashapp: <P2PIcon />,
  paypal: <P2PIcon />,
  other: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
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
  ach: 2, // standard ACH settlement
  check: 5, // mailed check + deposit clearing
  card: 0, // captured instantly
  cash: 0, // instant
  venmo: 0, // peer-to-peer — funds land instantly
  zelle: 0, // instant
  cashapp: 0, // instant
  paypal: 0, // instant
  other: 0, // unknown — treat as instant
};

function deriveStatus(
  method: PaymentMethod,
  daysAgo: number,
): { status: PaymentStatus; etaDays?: number } {
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

function whenLabel(lang: Lang, daysAgo: number): string {
  if (daysAgo <= 0) return tFor(lang, "paymentsPage.when.today");
  if (daysAgo === 1) return tFor(lang, "paymentsPage.when.yesterday");
  return tFor(lang, "paymentsPage.when.daysAgo", { n: daysAgo });
}

function noteFor(
  lang: Lang,
  method: PaymentMethod,
  daysAgo: number,
  client: string,
  status: PaymentStatus = "landed",
): string {
  const name = client.split(/\s+/)[0];
  if (status === "transit") {
    if (method === "ach") {
      return tFor(lang, "paymentsPage.note.transitAch", { name });
    }
    if (method === "check") {
      return tFor(lang, "paymentsPage.note.transitCheck", { name });
    }
  }
  switch (method) {
    case "ach":
      return tFor(lang, "paymentsPage.note.ach", { name });
    case "card":
      return tFor(lang, "paymentsPage.note.card", { name });
    case "check":
      return tFor(lang, "paymentsPage.note.check", { name });
    case "cash":
      return daysAgo === 0
        ? tFor(lang, "paymentsPage.note.cashToday", { name })
        : tFor(lang, "paymentsPage.note.cash", { name });
    default:
      return tFor(lang, "paymentsPage.note.default", { name });
  }
}

function enrich(
  lang: Lang,
  p: Payment,
  invoices: Map<string, Invoice>,
  customers: Map<string, string>,
  now: Date,
): EnrichedPayment {
  const inv = invoices.get(p.invoiceId);
  const customerId = inv?.customerId;
  const client = (customerId && customers.get(customerId)) || "—";
  const daysAgo = Math.max(
    0,
    Math.floor(
      (now.getTime() - new Date(p.receivedAt).getTime()) / (24 * 3600 * 1000),
    ),
  );
  const { status, etaDays } = deriveStatus(p.method, daysAgo);
  return {
    ...p,
    client,
    initials: initialsOf(client),
    invoiceRef: `INV-${p.invoiceId.slice(0, 6).toUpperCase()}`,
    daysAgo,
    whenLabel: whenLabel(lang, daysAgo),
    note: noteFor(lang, p.method, daysAgo, client, status),
    status,
    etaDays,
  };
}

export default function PaymentsPage({ lang: _lang }: { lang?: Lang } = {}) {
  // Self-source the reactive UI language; reading langSignal.value here makes
  // this island re-render live when the language flips (Settings change). The
  // optional `lang` prop is retained only as an ignored SSR seed.
  const lang = langSignal.value;
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
    return () => {
      alive = false;
    };
  }, []);

  const customerNames = useMemo(
    () =>
      new Map(
        (Array.isArray(s.customers) ? s.customers : []).map((
          c,
        ) => [c.id, c.name]),
      ),
    [s.customers],
  );
  const invoiceById = useMemo(
    () =>
      new Map(
        (Array.isArray(s.invoices) ? s.invoices : []).map((i) => [i.id, i]),
      ),
    [s.invoices],
  );

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
    return (
      <div class="qpage-error">
        {tFor(lang, "paymentsPage.loadError", { error: s.error })}
      </div>
    );
  }

  const now = new Date();
  const enriched = s.payments
    .map((p) => enrich(lang, p, invoiceById, customerNames, now))
    .sort((a, b) => a.daysAgo - b.daysAgo);

  const monthCutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  // Partition by derived status. Landed = settled this month. Transit =
  // still inside the method's settlement window (ACH < 2d, check < 5d).
  // Attention is reserved for declined/returned signals once the schema
  // carries them; right now the section conditionally hides itself.
  const landed = enriched.filter((p) =>
    p.status === "landed" && new Date(p.receivedAt) >= monthCutoff
  );
  const transit = enriched.filter((p) => p.status === "transit");
  const attention = enriched.filter((p) => p.status === "attention");
  const recentLanded = landed.filter((p) => p.daysAgo <= 1);
  const olderLanded = landed.filter((p) => p.daysAgo > 1);

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
        lang={lang}
        monthTotal={monthTotal}
        transitTotal={transitTotal}
        attentionCount={attention.length}
        stubs={stubs}
      />
      <PaymentsKpis
        lang={lang}
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
            <QuoteTrack
              num="01"
              title={tFor(lang, "paymentsPage.track.attention")}
              count={attention.length}
              unit={tFor(lang, "paymentsPage.unit.payment")}
              defaultOpen
              storageKey="payments:track:attention"
            >
              <div class="qcards">
                {attention.map((p, i) => (
                  <PaymentCard key={p.id} lang={lang} p={p} idx={i} />
                ))}
              </div>
            </QuoteTrack>
          )}

          <QuoteTrack
            num={attention.length > 0 ? "02" : "01"}
            title={tFor(lang, "paymentsPage.track.landed")}
            count={landed.length}
            unit={tFor(lang, "paymentsPage.unit.payment")}
            defaultOpen
            storageKey="payments:track:landed"
          >
            {recentLanded.length === 0 && olderLanded.length === 0
              ? (
                <div style="padding:14px 4px;color:var(--fg-muted, #6b7560);font-size:13.5px;line-height:1.5">
                  {tFor(lang, "paymentsPage.track.landedEmpty")}
                </div>
              )
              : (
                <>
                  {recentLanded.length > 0 && (
                    <div class="qcards">
                      {recentLanded.map((p, i) => (
                        <PaymentCard key={p.id} lang={lang} p={p} idx={i} />
                      ))}
                    </div>
                  )}
                  {olderLanded.length > 0 && (
                    <div class="qdone" style="margin-top:14px">
                      {olderLanded.map((p) => (
                        <LandedRow key={p.id} lang={lang} p={p} />
                      ))}
                    </div>
                  )}
                </>
              )}
          </QuoteTrack>

          {transit.length > 0 && (
            <QuoteTrack
              num={attention.length > 0 ? "03" : "02"}
              unit={tFor(lang, "paymentsPage.unit.payment")}
              title={tFor(lang, "paymentsPage.track.transit")}
              count={transit.length}
              defaultOpen={false}
              storageKey="payments:track:transit"
            >
              <div class="qcards">
                {transit.map((p, i) => (
                  <PaymentCard key={p.id} lang={lang} p={p} idx={i} />
                ))}
              </div>
            </QuoteTrack>
          )}
        </div>

        <aside class="qside">
          <PSideFlow lang={lang} landedAmounts={landed.map((p) => p.amount)} />
          <PSideTopPayors lang={lang} landed={landed} />
          <PSideMix lang={lang} landed={landed} />
          <PSideTip lang={lang} />
        </aside>
      </div>
    </>
  );
}

/* ---------------- Hero ---------------- */

function PaymentsHero(
  { lang, monthTotal, transitTotal, attentionCount, stubs }: {
    lang: Lang;
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
          <I d={ICN.check} size={11} sw={3} />{" "}
          {tFor(lang, "paymentsPage.hero.eyebrow", { month: monthName })}
        </div>
        <h1
          class="pph__title"
          style={fresh
            ? "font-size:clamp(28px,3.4vw,44px);line-height:1.15"
            : ""}
        >
          {fresh
            ? (
              <>
                {tFor(lang, "paymentsPage.hero.freshTitlePre")}{" "}
                <em style="color:var(--brand-pink);font-style:normal">
                  {tFor(lang, "paymentsPage.hero.freshTitleEm")}
                </em>.
              </>
            )
            : (
              <>
                <span class="pph__title-amount">
                  <sup>$</sup>
                  {fmtMoney(monthTotal).replace(/^\$/, "")}
                </span>
                <span class="pph__title-tail">
                  {tFor(lang, "paymentsPage.hero.titleTail")}
                </span>
              </>
            )}
        </h1>
        <p class="pph__sub">
          {fresh
            ? <>{tFor(lang, "paymentsPage.hero.freshSub")}</>
            : (
              <>
                {transitTotal > 0
                  ? (
                    <>
                      {tFor(lang, "paymentsPage.hero.subPlus")}{" "}
                      <strong>{fmtMoney(transitTotal)}</strong>{" "}
                      {tFor(lang, "paymentsPage.hero.subOnTheWay")}
                    </>
                  )
                  : <>{tFor(lang, "paymentsPage.hero.everyDollar")}</>}
                {attentionCount > 0
                  ? (
                    <>
                      {" "}
                      {tFor(lang, "paymentsPage.hero.subAnd")}{" "}
                      <strong>{attentionCount}</strong>{" "}
                      {tFor(lang, "paymentsPage.hero.subUnstick")}
                    </>
                  )
                  : null}
                {transitTotal > 0
                  ? <>{tFor(lang, "paymentsPage.hero.subMonsters")}</>
                  : null}
              </>
            )}
        </p>
        <div class="pph__cta-row">
          <a
            class="pph__cta"
            href={`/assistant?seed=${
              encodeURIComponent(tFor(lang, "paymentsPage.hero.recordSeed"))
            }`}
          >
            <I d={ICN.plus} size={14} sw={2.5} />{" "}
            {tFor(lang, "paymentsPage.hero.recordCta")}
          </a>
          <a
            class="pph__ghost"
            href={`/assistant?seed=${
              encodeURIComponent(tFor(lang, "paymentsPage.hero.exportSeed"))
            }`}
          >
            <I d={ICN.arrow} size={13} sw={2.5} />{" "}
            {tFor(lang, "paymentsPage.hero.exportCta")}
          </a>
        </div>
      </div>
      <div class="pph__stack" aria-hidden="true">
        {stubs.map((p, i) => (
          <div key={p.id} class={`pph__stub pph__stub--${i + 1}`}>
            <div class="pph__stub-head">
              <div
                class="pph__stub-av"
                style={`background:${METHOD_AV_BG[p.method]}`}
              >
                {p.initials}
              </div>
              <div class="pph__stub-meta">
                <div class="pph__stub-client">{p.client}</div>
                <div class="pph__stub-when">{p.whenLabel} · {p.invoiceRef}</div>
              </div>
            </div>
            <div class="pph__stub-amount">{fmtMoney(p.amount)}</div>
            <div class="pph__stub-foot">
              <span class="pph__stub-method">
                <I d={METHOD_ICON[p.method]} size={11} sw={2} />{" "}
                {methodLabel(lang, p.method)}
              </span>
              <span class="pph__stub-tag">
                {tFor(lang, "paymentsPage.stub.landed")}
              </span>
            </div>
          </div>
        ))}
      </div>
    </header>
  );
}

/* ---------------- KPIs ---------------- */

function PaymentsKpis(
  {
    lang,
    landedCount,
    monthTotal,
    transitCount,
    transitTotal,
    attentionCount,
    attentionTotal,
    avgDays,
  }: {
    lang: Lang;
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
        <div class="qkpi__lbl">{tFor(lang, "paymentsPage.kpi.landedLabel")}</div>
        <div class="qkpi__val">{fmtMoney(monthTotal)}</div>
        <div class="qkpi__sub">
          {tnFor(lang, "paymentsPage.kpi.payments", landedCount)}
        </div>
      </div>
      <div class="qkpi__cell qkpi__cell--accent">
        <div class="qkpi__lbl">{tFor(lang, "paymentsPage.kpi.transitLabel")}</div>
        <div class="qkpi__val">{fmtMoney(transitTotal)}</div>
        <div class="qkpi__sub">
          {tFor(lang, "paymentsPage.kpi.onTheWay", { n: transitCount })}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">
          {tFor(lang, "paymentsPage.kpi.attentionLabel")}
        </div>
        <div class="qkpi__val">{attentionCount}</div>
        <div class="qkpi__sub">
          {tFor(lang, "paymentsPage.kpi.heldUp", {
            amount: fmtMoney(attentionTotal),
          })}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">{tFor(lang, "paymentsPage.kpi.avgLabel")}</div>
        <div class="qkpi__val">
          {avgDays > 0 ? tFor(lang, "paymentsPage.value.days", { n: avgDays }) : "—"}
        </div>
        <div class="qkpi__sub">
          {avgDays > 0
            ? tFor(lang, "paymentsPage.kpi.acrossLanded")
            : tFor(lang, "paymentsPage.kpi.noHistory")}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Payment card (flip) ---------------- */

const STATUS_MOOD: Record<
  PaymentStatus,
  {
    from: string;
    to: string;
    shadow: string;
    statusFg: string;
  }
> = {
  landed: {
    from: "#CFE5C8",
    to: "#5FA34F",
    shadow: "rgba(81,152,67,0.28)",
    statusFg: "#1F3F18",
  },
  transit: {
    from: "#C8DDE0",
    to: "#56969E",
    shadow: "rgba(86,150,158,0.28)",
    statusFg: "#0F3036",
  },
  attention: {
    from: "#FFD9D9",
    to: "#FF6B6B",
    shadow: "rgba(255,107,107,0.30)",
    statusFg: "#fff",
  },
};

function PaymentCard(
  { lang, p, idx }: { lang: Lang; p: EnrichedPayment; idx: number },
) {
  const [flipped, setFlipped] = useState(false);
  const mood = STATUS_MOOD[p.status];
  const moodLabel = tFor(lang, `paymentsPage.mood.${p.status}.label`);
  const moodCta = tFor(lang, `paymentsPage.mood.${p.status}.cta`);
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
        <div class="qcard__status">
          <span class="qcard__status-dot" /> {moodLabel}
        </div>
        <div class="qcard__opens" style="text-transform:uppercase">
          <I d={METHOD_ICON[p.method]} size={12} sw={2} />{" "}
          {methodLabel(lang, p.method)}
        </div>
      </div>
      <div class="qcard__av">{p.initials}</div>
      <div class="qcard__body">
        <div class="qcard__client-name">{p.client} · {p.invoiceRef}</div>
        <div class="pcard__amount">{fmtMoney(p.amount)}</div>
        <p class="qcard__story">{p.note}</p>
      </div>
      <div class="qcard__foot">
        <button
          type="button"
          class="qcard__cta"
          onClick={(e) => e.stopPropagation()}
        >
          {moodCta}{" "}
          <span style="display:inline-block;transition:transform 240ms">→</span>
        </button>
        <div class="qcard__val-wrap">
          <div class="qcard__val-lbl">
            {p.status === "transit"
              ? tFor(lang, "paymentsPage.card.expected")
              : tFor(lang, "paymentsPage.card.method")}
          </div>
          <div class="qcard__val-num" style="font-size:13px">
            {p.status === "transit" && p.etaDays
              ? tFor(lang, "paymentsPage.card.eta", { n: p.etaDays })
              : methodLabel(lang, p.method)}
          </div>
        </div>
      </div>

      <div class="qcard__back" aria-hidden={!flipped}>
        <div class="qcard__back-head">
          <button
            type="button"
            class="qcard__back-close"
            onClick={(e) => {
              e.stopPropagation();
              setFlipped(false);
            }}
            aria-label={tFor(lang, "common.close")}
          >
            <I d={ICN.x} size={14} sw={2.5} />
          </button>
          <div class="qcard__back-eyebrow">
            {tFor(lang, "paymentsPage.card.trail")}
          </div>
          <p class="qcard__back-big">
            {fmtMoney(p.amount)}
            <small>· {methodLabel(lang, p.method)}</small>
          </p>
        </div>
        <div class="qcard__back-body">
          <p class="qcard__read">{p.note}</p>
        </div>
        <div class="qcard__back-foot">
          <button type="button" onClick={(e) => e.stopPropagation()}>
            {tFor(lang, "paymentsPage.card.receipt")}
          </button>
          <button type="button" onClick={(e) => e.stopPropagation()}>
            {tFor(lang, "paymentsPage.card.matchInvoice")}
          </button>
          <button type="button" onClick={(e) => e.stopPropagation()}>
            {tFor(lang, "paymentsPage.card.textClient")}
          </button>
        </div>
      </div>
    </article>
  );
}

/* ---------------- Landed row (compact tail of month) ---------------- */

function LandedRow({ lang, p }: { lang: Lang; p: EnrichedPayment }) {
  return (
    <div class="qdone__row">
      <div class="qdone__badge qdone__badge--won">
        <I d={ICN.check} size={13} sw={2.5} />
      </div>
      <div class="qdone__body">
        <div class="qdone__title">{p.client}</div>
        <div class="qdone__sub">
          {methodLabel(lang, p.method)} · {p.whenLabel} · {p.invoiceRef}
        </div>
      </div>
      <div class="qdone__amt">{fmtMoney(p.amount)}</div>
    </div>
  );
}

/* ---------------- Side rail components ---------------- */

function PSideFlow(
  { lang, landedAmounts }: { lang: Lang; landedAmounts: number[] },
) {
  // Split landed into 12 weekly buckets. Real history would key off
  // receivedAt; for now we just slot in the rolling totals.
  const weeks = new Array(12).fill(0);
  landedAmounts.forEach((a, i) => {
    weeks[11 - (i % 12)] += a;
  });
  const hasData = weeks.some((v) => v > 0);
  if (!hasData) {
    return (
      <div class="qside__card">
        <div class="qside__title">{tFor(lang, "paymentsPage.flow.title")}</div>
        <div class="qside__sub" style="margin:2px 0 12px">
          {tFor(lang, "paymentsPage.flow.subEmpty")}
        </div>
        <div style="font-size:13px;color:var(--fg-muted);line-height:1.45">
          {tFor(lang, "paymentsPage.flow.empty")}
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
  const path = pts.map((
    pt,
    i,
  ) => (i === 0 ? `M${pt[0]},${pt[1]}` : `L${pt[0]},${pt[1]}`)).join(" ");
  const area = `${path} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
  return (
    <div class="qside__card">
      <div class="qside__title">{tFor(lang, "paymentsPage.flow.title")}</div>
      <div class="qside__sub" style="margin:2px 0 12px">
        {tFor(lang, "paymentsPage.flow.subThisWeek", {
          amount: fmtMoney(weeks[weeks.length - 1]),
        })}
      </div>
      <svg width={w} height={h} style="display:block;width:100%;height:auto">
        <defs>
          <linearGradient id="cfArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#FF6B6B" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#FF6B6B" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#cfArea)" />
        <path
          d={path}
          fill="none"
          stroke="#FF6B6B"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        {pts.map((pt, i) => (
          <circle
            key={i}
            cx={pt[0]}
            cy={pt[1]}
            r={i === pts.length - 1 ? 3 : 1.5}
            fill="#FF6B6B"
          />
        ))}
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--fg-muted);margin-top:8px;font-family:var(--font-body)">
        <span>{tFor(lang, "paymentsPage.flow.feb")}</span>
        <span>{tFor(lang, "paymentsPage.flow.mar")}</span>
        <span>{tFor(lang, "paymentsPage.flow.apr")}</span>
      </div>
    </div>
  );
}

function PSideTopPayors(
  { lang, landed }: { lang: Lang; landed: EnrichedPayment[] },
) {
  const tally = new Map<string, number>();
  for (const p of landed) {
    tally.set(p.client, (tally.get(p.client) ?? 0) + p.amount);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const max = top[0]?.[1] ?? 1;
  return (
    <div class="qside__card">
      <div class="qside__title">{tFor(lang, "paymentsPage.payors.title")}</div>
      <div class="qside__sub" style="margin:2px 0 14px">
        {tFor(lang, "paymentsPage.payors.sub")}
      </div>
      {top.length === 0
        ? (
          <div style="font-size:13px;color:var(--fg-muted)">
            {tFor(lang, "paymentsPage.payors.empty")}
          </div>
        )
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
                      style={`width:${
                        (amt / max) * 100
                      }%;background:linear-gradient(90deg,#4F8C6B,#2F6448)`}
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

function PSideMix({ lang, landed }: { lang: Lang; landed: EnrichedPayment[] }) {
  const tally: Record<PaymentMethod, number> = {
    ach: 0,
    card: 0,
    check: 0,
    cash: 0,
    venmo: 0,
    zelle: 0,
    cashapp: 0,
    paypal: 0,
    other: 0,
  };
  for (const p of landed) tally[p.method] += p.amount;
  const total = Object.values(tally).reduce((s, v) => s + v, 0);
  const colors: Record<PaymentMethod, string> = {
    ach: "#4F8C6B",
    card: "#2A6F77",
    check: "#9C8074",
    cash: "#E07A8C",
    venmo: "#3D95CE",
    zelle: "#8E5BD6",
    cashapp: "#4FB35F",
    paypal: "#2A6F9E",
    other: "#6b7560",
  };
  const segments = (Object.keys(tally) as PaymentMethod[])
    .map((m) => ({ method: m, pct: total > 0 ? (tally[m] / total) * 100 : 0 }))
    .filter((s) => s.pct > 0);
  return (
    <div class="qside__card">
      <div class="qside__title">{tFor(lang, "paymentsPage.mix.title")}</div>
      <div class="qside__sub" style="margin:2px 0 14px">
        {tFor(lang, "paymentsPage.mix.sub")}
      </div>
      {segments.length === 0
        ? (
          <div style="font-size:13px;color:var(--fg-muted)">
            {tFor(lang, "paymentsPage.mix.empty")}
          </div>
        )
        : (
          <>
            <div style="display:flex;height:14px;border-radius:999px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,0.06);margin-bottom:14px">
              {segments.map((s) => (
                <div
                  key={s.method}
                  style={`width:${s.pct}%;background:${colors[s.method]}`}
                />
              ))}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px">
              {segments.map((s) => (
                <div
                  key={s.method}
                  style="display:flex;align-items:center;gap:7px;font-family:var(--font-body);font-size:12px"
                >
                  <span
                    style={`width:10px;height:10px;border-radius:3px;background:${
                      colors[s.method]
                    };flex-shrink:0`}
                  />
                  <span style="color:var(--brand-teal);font-weight:700">
                    {methodLabel(lang, s.method)}
                  </span>
                  <span style="color:var(--fg-muted);margin-left:auto">
                    {tFor(lang, "paymentsPage.mix.pct", {
                      n: Math.round(s.pct),
                    })}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
    </div>
  );
}

function PSideTip({ lang }: { lang: Lang }) {
  return (
    <div
      class="qside__card"
      style="background:linear-gradient(135deg,#1A535C,#0F3A40);color:#fff;border:none"
    >
      <div class="qside__title" style="color:#fff;margin-bottom:8px">
        {tFor(lang, "paymentsPage.tip.title")}
      </div>
      <p style="margin:0;font-family:var(--font-body);font-size:13.5px;line-height:1.55;color:rgba(255,255,255,0.88)">
        <strong style="color:#fff">
          {tFor(lang, "paymentsPage.tip.zelleCashApp")}
        </strong>{" "}
        {tFor(lang, "paymentsPage.tip.mid")}{" "}
        <strong style="color:#fff">
          {tFor(lang, "paymentsPage.tip.upTo5")}
        </strong>{" "}
        {tFor(lang, "paymentsPage.tip.end")}
      </p>
    </div>
  );
}
