/**
 * /payments island — editorial "money landed" treatment matching the
 * canonical reference (reference/extracted/DocuMonster Payments.html).
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
 *   - landed:    payment has been recorded (REQ-926: at once — the old
 *                method-and-age "In transit" window is gone)
 *   - reversed:  REQ-926 — charged back: kept on record, struck through,
 *                outside every total; the invoice it paid owes again
 *   - attention: a customer's "I paid by X" claim waiting for the contractor
 *                to confirm or reject it (REQ-281, demo M34). A claim is not
 *                a Payment row — it lives on the invoice (status "claimed" +
 *                paymentIntent) — so it is derived from the invoice list by
 *                lib/payment-claims.ts.
 *
 * Tracks for charged-back/attention render conditionally — when there's no data
 * for them the page reads cleanly without empty sections.
 */
import { paidHow } from "../../shared/documents/paid-how.ts"; // REQ-928
import Backdrop from "../components/Backdrop.tsx";
import MarkPaidDialog from "../components/MarkPaidDialog.tsx"; // REQ-930
import { confirmPaymentInit } from "../lib/mark-paid.ts"; // REQ-930
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
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
import { fmtMoney, fmtMoneyExact } from "../lib/format.ts";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
import PaymentReceivedForm from "../components/PaymentReceivedForm.tsx";
import PaymentsKpis from "../components/PaymentsKpis.tsx";
import { docNumberOf } from "../../shared/documents/numbering.ts";
import { type PaymentClaim, pendingClaims } from "../lib/payment-claims.ts";
import { cashFlowWeeks } from "../lib/cash-flow-weeks.ts";
import { paidThisMonthCents } from "../lib/headline-counts.ts"; // REQ-959
import { refreshDash } from "../lib/dash-cache.ts";
import {
  chargebackFeeDollars,
  parseChargebackFee,
  paymentCardCtaHref,
  paymentStatus,
} from "../lib/payment-card.ts"; // REQ-926
import { profileClient } from "../clients/profile.ts"; // REQ-926
import {
  recordIdFromSearch,
  type RecordOptionInvoice,
  recordOptionLabel,
} from "../lib/payment-record-option.ts";
import SearchSelect from "./SearchSelect.tsx"; // REQ-909

/** Plural helper bound to an explicit language (the reactive `tn` reads the
 *  global lang signal; the logged-in app threads `lang` explicitly). */
const tnFor = (
  lang: Lang,
  key: string,
  n: number,
  vars?: Record<string, string | number>,
): string => tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n, ...vars });
import QuoteTrack from "./QuoteTrack.tsx";

interface State {
  loading: boolean;
  error: string | null;
  payments: Payment[];
  invoices: Invoice[];
  customers: Customer[];
  /** REQ-926: Settings' chargeback fee — the modal's default, cents */
  chargebackFeeCents?: number;
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

/** REQ-928: a landed payment says Electronic or Other — "Electronic (Venmo)". */
const paidMethodLabel = (lang: Lang, m: PaymentMethod): string =>
  paidHow((k, v) => tFor(lang, k, v), [m]);

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

/** REQ-926: landed at once; reversed once charged back. "attention" is a
 *  customer's claim (a card of its own, not a Payment row). */
type PaymentStatus = "landed" | "reversed" | "attention";

interface EnrichedPayment extends Payment {
  client: string;
  /** REQ-626: the invoice's customer — "Text client" opens their sheet */
  customerId?: string;
  initials: string;
  invoiceRef: string;
  daysAgo: number;
  whenLabel: string;
  note: string;
  status: PaymentStatus;
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
): string {
  const name = client.split(/\s+/)[0];
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
  const status = paymentStatus(p); // REQ-926
  return {
    ...p,
    client,
    ...(customerId ? { customerId } : {}),
    initials: initialsOf(client),
    // REQ-198: the invoice's own number ("INV-001"); "#ID" when the invoice
    // predates numbering or is no longer on the books.
    invoiceRef: docNumberOf(inv ?? { id: p.invoiceId }),
    daysAgo,
    whenLabel: whenLabel(lang, daysAgo),
    note: status === "reversed"
      ? tFor(lang, "paymentsPage.chargeback.note", {
        name: client.split(/\s+/)[0],
      }) + (p.reversedReason ? ` — ${p.reversedReason}` : "")
      : noteFor(lang, p.method, daysAgo, client),
    status,
  };
}

export default function PaymentsPage({ lang: _lang }: { lang?: Lang } = {}) {
  // Self-source the reactive UI language; reading langSignal.value here makes
  // this island re-render live when the language flips (Settings change). The
  // optional `lang` prop is retained only as an ignored SSR seed.
  const lang = langSignal.value;
  const [s, setS] = useState<State>(INITIAL);
  // REQ-909: /payments?record=<invoiceId> opens Record a payment on that
  // invoice (read after hydration — the server renders no location).
  const [wantRecord, setWantRecord] = useState("");
  useEffect(() => {
    setWantRecord(recordIdFromSearch(globalThis.location?.search ?? ""));
  }, []);

  // One loader for mount AND the refresh after "Record a payment" (REQ-019).
  async function load(): Promise<void> {
    const [payments, invoices, customers, chargebackFeeCents] = await Promise
      .all([
        paymentsClient.list().catch(() => [] as Payment[]),
        dashboardClient.invoices(undefined).catch(() => [] as Invoice[]),
        dashboardClient.customers().catch(() => [] as Customer[]),
        // REQ-926: the chargeback modal's default fee (Settings)
        profileClient.get().catch(() => null),
      ]).then(([p, i, c, prof]) =>
        [p, i, c, prof?.identity?.chargebackFeeCents ?? 0] as const
      );
    setS({
      loading: false,
      error: null,
      payments,
      invoices,
      customers,
      chargebackFeeCents,
    });
  }

  useEffect(() => {
    let alive = true;
    load().catch((err: Error) => {
      if (!alive) return;
      setS({ ...INITIAL, loading: false, error: err.message });
    });
    return () => {
      alive = false;
    };
  }, []);

  // REQ-926: the payment whose Chargeback modal is open
  const [chargeback, setChargeback] = useState<EnrichedPayment | null>(null);
  async function undoChargeback(p: EnrichedPayment) {
    try {
      await paymentsClient.undoChargeback(p.id);
    } finally {
      await load();
      refreshDash().catch(() => {/* the badge keeps its last count */});
    }
  }

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
  // Partition by status. Landed = recorded this month (REQ-926: at once —
  // no In transit). Reversed = charged back (kept, outside every total).
  // Attention = customer claims awaiting confirm/reject (REQ-281): they are
  // on the invoices, not the payments, until the contractor confirms.
  const landed = enriched.filter((p) =>
    p.status === "landed" && new Date(p.receivedAt) >= monthCutoff
  );
  const reversed = enriched.filter((p) => p.status === "reversed");
  const reversedTotal = reversed.reduce((sum, p) => sum + p.amount, 0);
  const attention = pendingClaims(s.invoices, customerNames, now);
  const recentLanded = landed.filter((p) => p.daysAgo <= 1);
  const olderLanded = landed.filter((p) => p.daysAgo > 1);

  // REQ-551 (demo B2): one "paid" definition with /invoices — a payment
  // counts what its bill still owed when it arrived; the overpaid rest is
  // its own line under the hero, never part of the total. REQ-959: the
  // month's sum is the SAME helper the /invoices "Paid this month" tile
  // calls, so a part payment counts on both screens.
  const month = paidThisMonthCents(
    s.payments, // reversed ones (REQ-926) are skipped inside
    Array.isArray(s.invoices) ? s.invoices : [],
    monthCutoff,
  );
  const monthTotal = month.cents;
  const monthOverpaid = month.overCents;
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
  // REQ-562 (demo-loop cycle 4, m21): null = no landed payment yet; a
  // same-day payment averages 0 days, which is history, not "no history".
  const avgDays = daysToPay.length > 0
    ? Math.round(daysToPay.reduce((s, d) => s + d, 0) / daysToPay.length)
    : null;

  // Top three landed for the hero stub stack (rotated cards)
  const stubs = recentLanded.slice(0, 3);

  return (
    <>
      <PaymentsHero
        lang={lang}
        monthTotal={monthTotal}
        monthOverpaid={monthOverpaid}
        attentionCount={attention.length}
        stubs={stubs}
        recordOptions={(Array.isArray(s.invoices) ? s.invoices : [])
          .filter((i) => i.status !== "paid" && i.status !== "void")
          .map((i) => ({
            id: i.id,
            amountCents: i.amount,
            paidCents: i.paidCents, // REQ-551
            // REQ-587 (cycle 4, M27): number → job name in the app's
            // language → the localized word; never a hard-coded "Invoice".
            label: recordOptionLabel(
              lang,
              i as Invoice & RecordOptionInvoice,
              customerNames.get(i.customerId ?? ""),
            ),
          }))}
        onRecorded={load}
        initialRecordId={wantRecord}
      />
      <PaymentsKpis
        lang={lang}
        landedCount={landed.length}
        monthTotal={monthTotal}
        reversedCount={reversed.length}
        reversedTotal={reversedTotal}
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
              unit={tFor(lang, "paymentsPage.unit.claim")}
              defaultOpen
              storageKey="payments:track:attention"
            >
              <div class="qcards">
                {attention.map((c, i) => (
                  <ClaimCard
                    key={c.invoiceId}
                    lang={lang}
                    c={c}
                    idx={i}
                    onSettled={load}
                  />
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
                        <PaymentCard
                          key={p.id}
                          lang={lang}
                          p={p}
                          idx={i}
                          onChargeback={setChargeback}
                          onUndo={undoChargeback}
                        />
                      ))}
                    </div>
                  )}
                  {olderLanded.length > 0 && (
                    <div class="qdone" style="margin-top:14px">
                      {olderLanded.map((p) => (
                        <LandedRow
                          key={p.id}
                          lang={lang}
                          p={p}
                          onChargeback={setChargeback}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
          </QuoteTrack>

          {/* REQ-926: charged back — kept on record, outside every total */}
          {reversed.length > 0 && (
            <QuoteTrack
              num={attention.length > 0 ? "03" : "02"}
              unit={tFor(lang, "paymentsPage.unit.payment")}
              title={tFor(lang, "paymentsPage.track.reversed")}
              count={reversed.length}
              defaultOpen
              storageKey="payments:track:reversed"
            >
              <div class="qcards" data-cy="payments-reversed-track">
                {reversed.map((p, i) => (
                  <PaymentCard
                    key={p.id}
                    lang={lang}
                    p={p}
                    idx={i}
                    onChargeback={setChargeback}
                    onUndo={undoChargeback}
                  />
                ))}
              </div>
            </QuoteTrack>
          )}
        </div>

        <aside class="qside">
          <PSideFlow lang={lang} landed={landed} />
          <PSideTopPayors lang={lang} landed={landed} />
          <PSideMix lang={lang} landed={landed} />
          <PSideTip lang={lang} />
        </aside>
      </div>
      {chargeback && (
        <ChargebackModal
          lang={lang}
          p={chargeback}
          defaultFeeCents={s.chargebackFeeCents ?? 0}
          onCancel={() => setChargeback(null)}
          onDone={async () => {
            setChargeback(null);
            await load();
            refreshDash().catch(() => {/* the badge keeps its last count */});
          }}
        />
      )}
    </>
  );
}

/* ---------------- Hero ---------------- */

function PaymentsHero(
  {
    lang,
    monthTotal,
    monthOverpaid = 0,
    attentionCount,
    stubs,
    recordOptions,
    onRecorded,
    initialRecordId = "",
  }: {
    lang: Lang;
    monthTotal: number;
    /** REQ-551: received this month beyond what the bills owed. */
    monthOverpaid?: number;
    attentionCount: number;
    stubs: EnrichedPayment[];
    /** REQ-019 (NW-33): unpaid invoices the contractor can record against. */
    recordOptions: Array<
      { id: string; label: string; amountCents?: number; paidCents?: number }
    >;
    onRecorded: () => Promise<void>;
    /** REQ-909: the invoice a `/payments?record=<id>` link asks for. */
    initialRecordId?: string;
  },
) {
  // REQ-019 (NW-33): "Record a payment" is an in-page picker, not a chat seed.
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordId, setRecordId] = useState("");
  const recordInvoice = recordOptions.find((o) => o.id === recordId);
  // REQ-909: the deep link opens the picker on its invoice — once, as soon as
  // that invoice is among the unpaid options (they load after mount).
  const appliedRef = useRef("");
  useEffect(() => {
    if (!initialRecordId || appliedRef.current === initialRecordId) return;
    if (!recordOptions.some((o) => o.id === initialRecordId)) return;
    appliedRef.current = initialRecordId;
    setRecordId(initialRecordId);
    setRecordOpen(true);
  }, [initialRecordId, recordOptions]);
  const today = new Date();
  const exportHref =
    `/api/invoices/export.csv?year=${today.getFullYear()}&month=${
      today.getMonth() + 1
    }`;
  // UX-35: the hero chip month renders in the page language ("PAGOS ·
  // AGOSTO"), never the en-US month inside the Spanish UI.
  const MONTH_KEYS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ] as const;
  const monthName = tFor(
    lang,
    `dashboardPage.month.${MONTH_KEYS[new Date().getMonth()]}`,
  );
  const fresh = monthTotal === 0 && attentionCount === 0 &&
    monthOverpaid === 0;
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
          {fresh ? <>{tFor(lang, "paymentsPage.hero.freshSub")}</> : (
            <>
              {/* REQ-926: no In transit — what is waiting, else every dollar */}
              {attentionCount > 0
                // REQ-350: one counted sentence — never "logged. and 1 waiting"
                ? (
                  <>
                    {tnFor(
                      lang,
                      "paymentsPage.hero.everyDollarWaiting",
                      attentionCount,
                    )}
                  </>
                )
                : <>{tFor(lang, "paymentsPage.hero.everyDollar")}</>}
            </>
          )}
        </p>
        {monthOverpaid > 0 && (
          <p class="pph__sub" data-cy="payments-overpaid">
            {tFor(lang, "paymentsPage.hero.overpaid", {
              amount: fmtMoney(monthOverpaid),
            })}
          </p>
        )}
        <div class="pph__cta-row">
          <button
            type="button"
            class="pph__cta"
            data-cy="payments-record"
            onClick={() => setRecordOpen(true)}
          >
            <I d={ICN.plus} size={14} sw={2.5} />{" "}
            {tFor(lang, "paymentsPage.hero.recordCta")}
          </button>
          <a
            class="pph__ghost"
            data-cy="payments-export"
            href={exportHref}
            download
          >
            <I d={ICN.arrow} size={13} sw={2.5} />{" "}
            {tFor(lang, "paymentsPage.hero.exportCta")}
          </a>
        </div>
        {recordOpen && (
          <Backdrop
            data-cy="payments-record-modal"
            style="position:fixed;inset:0;z-index:60;background:rgba(20,72,82,0.35);display:flex;align-items:center;justify-content:center;padding:20px"
            onClose={() => setRecordOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              style="background:#fff;border-radius:16px;padding:20px 22px;width:min(560px,100%);box-shadow:0 20px 60px rgba(20,72,82,0.25);display:flex;flex-direction:column;gap:12px;text-align:left"
              onClick={(e) => e.stopPropagation()}
            >
              <div style="font-size:18px;font-weight:800;color:var(--fg,#144852)">
                {tFor(lang, "paymentsPage.record.title")}
              </div>
              {
                /* REQ-909: type to find the invoice — customer, number or job
                  (the REQ-136 SearchSelect, as the New invoice client field
                  since REQ-801). A <div>, not a <label>: REQ-809. */
              }
              <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
                <span>{tFor(lang, "paymentsPage.record.invoiceLabel")}</span>
                <div data-cy="payments-record-invoice" data-value={recordId}>
                  <SearchSelect
                    options={recordOptions.map((o) => ({
                      id: o.id,
                      label: o.label,
                    }))}
                    value={recordId}
                    placeholder={tFor(lang, "paymentsPage.record.search")}
                    onSelect={(o) => setRecordId(o.id)}
                    onQuery={(q) => {
                      // the box was cleared or retyped: no invoice until the next pick
                      if (recordId && q.trim() === "") setRecordId("");
                    }}
                  />
                </div>
              </div>
              {recordOptions.length === 0 && (
                <div style="font-size:13px;color:var(--fg-muted,#6b7560)">
                  {tFor(lang, "paymentsPage.record.noneUnpaid")}
                </div>
              )}
              {recordInvoice && (
                <PaymentReceivedForm
                  key={recordInvoice.id}
                  invoiceId={recordInvoice.id}
                  amountCents={recordInvoice.amountCents}
                  paidCents={recordInvoice.paidCents}
                  lang={lang}
                  onSaved={async () => {
                    await onRecorded();
                    setRecordOpen(false);
                    setRecordId("");
                  }}
                  onCancel={() => setRecordOpen(false)}
                />
              )}
            </div>
          </Backdrop>
        )}
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
  // REQ-926: charged back — a neutral grey, not the alert red
  reversed: {
    from: "#E4E6E3",
    to: "#8A918A",
    shadow: "rgba(110,118,110,0.24)",
    statusFg: "#1F2420",
  },
  attention: {
    from: "#FFD9D9",
    to: "#FF6B6B",
    shadow: "rgba(255,107,107,0.30)",
    statusFg: "#fff",
  },
};

function PaymentCard(
  { lang, p, idx, onChargeback, onUndo }: {
    lang: Lang;
    p: EnrichedPayment;
    idx: number;
    /** REQ-926: opens the Chargeback modal on this payment */
    onChargeback: (p: EnrichedPayment) => void;
    /** REQ-926: Undo on a charged-back payment */
    onUndo: (p: EnrichedPayment) => Promise<void>;
  },
) {
  const [undoing, setUndoing] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const mood = STATUS_MOOD[p.status];
  const moodLabel = tFor(lang, `paymentsPage.mood.${p.status}.label`);
  const moodCta = tFor(lang, `paymentsPage.mood.${p.status}.cta`);
  // REQ-626: every card button goes somewhere real
  const invoiceHref = `/invoices?open=${encodeURIComponent(p.invoiceId)}`;
  const receiptHref = `/i/${encodeURIComponent(p.invoiceId)}`;
  const clientHref = p.customerId
    ? `/clients?open=${encodeURIComponent(p.customerId)}`
    : invoiceHref;
  // REQ-626 AMENDMENT — reconciled with develop on demo-fixes: the front CTA
  // is a real link (REQ-555: "View receipt" opens the receipt page in a new
  // tab); a charged-back card's (REQ-926) opens the invoice that owes again.
  function onCta(e: Event) {
    e.stopPropagation();
  }
  return (
    <article
      class={`qcard ${flipped ? "qcard--flipped" : ""}`}
      data-cy="payment-card"
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
        <div
          class="pcard__amount"
          style={p.status === "reversed"
            ? "text-decoration:line-through;opacity:0.6"
            : ""}
        >
          {fmtMoney(p.amount)}
        </div>
        <p class="qcard__story">{p.note}</p>
        {/* REQ-926: Chargeback on a landed payment; Undo on a reversed one */}
        {p.status === "reversed"
          ? (
            <div class="pcard__cb">
              {p.reversedFeeCents
                ? (
                  <span class="pcard__cb-fee" data-cy="pay-card-chargeback-fee">
                    {tFor(lang, "paymentsPage.chargeback.feeAdded", {
                      amount: fmtMoneyExact(p.reversedFeeCents),
                    })}
                  </span>
                )
                : null}
              <button
                type="button"
                class="pcard__cb-btn"
                data-cy="pay-card-chargeback-undo"
                disabled={undoing}
                onClick={async (e) => {
                  e.stopPropagation();
                  setUndoing(true);
                  try {
                    await onUndo(p);
                  } finally {
                    setUndoing(false);
                  }
                }}
              >
                {tFor(lang, "paymentsPage.chargeback.undo")}
              </button>
            </div>
          )
          : (
            <div class="pcard__cb">
              <button
                type="button"
                class="pcard__cb-btn"
                data-cy="pay-card-chargeback"
                onClick={(e) => {
                  e.stopPropagation();
                  onChargeback(p);
                }}
              >
                {tFor(lang, "paymentsPage.chargeback.button")}
              </button>
            </div>
          )}
      </div>
      <div class="qcard__foot">
        {
          /* REQ-555 (M24): the CTA goes somewhere — the receipt (landed) or
            the invoice detail (charged back, REQ-926). */
        }
        <a
          class="qcard__cta"
          data-cy="pay-card-cta"
          href={paymentCardCtaHref(p.status, p.invoiceId)}
          {...(p.status === "landed"
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          style="text-decoration:none"
          onClick={onCta}
        >
          {moodCta}{" "}
          <span style="display:inline-block;transition:transform 240ms">→</span>
        </a>
        <div class="qcard__val-wrap">
          <div class="qcard__val-lbl">
            {tFor(lang, "paymentsPage.card.method")}
          </div>
          <div class="qcard__val-num" style="font-size:13px">
            {paidMethodLabel(lang, p.method)}
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
            <small>· {paidMethodLabel(lang, p.method)}</small>
          </p>
        </div>
        <div class="qcard__back-body">
          <p class="qcard__read">{p.note}</p>
        </div>
        {
          /* REQ-555 (M24) / REQ-626: every action has a destination — the
            receipt is the paid invoice's page, the invoice opens its own
            detail, the client's sheet carries Message. */
        }
        <div
          class="qcard__back-foot"
          style="grid-template-columns:repeat(3,1fr)"
        >
          {/* REQ-626: the customer's copy of the invoice is the receipt */}
          <a
            data-cy="pay-card-receipt"
            href={receiptHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {tFor(lang, "paymentsPage.card.receipt")}
          </a>
          {/* the invoice this payment is matched to, in its editable panel */}
          <a
            data-cy="pay-card-match"
            href={invoiceHref}
            onClick={(e) => e.stopPropagation()}
          >
            {tFor(lang, "paymentsPage.card.matchInvoice")}
          </a>
          {/* the client's sheet: Message (a text) and their details */}
          <a
            data-cy="pay-card-text"
            href={clientHref}
            onClick={(e) => e.stopPropagation()}
          >
            {tFor(lang, "paymentsPage.card.textClient")}
          </a>
        </div>
      </div>
    </article>
  );
}

/* ---------------- Claim card (attention) ---------------- */

/** REQ-281 (demo M34): a customer's "I paid by X" claim, waiting for the
 *  contractor. Confirm records the Payment (confirm-payment); reject reopens
 *  the invoice (reject-claim). Either way the page reloads its data. */
function ClaimCard(
  { lang, c, idx, onSettled }: {
    lang: Lang;
    c: PaymentClaim;
    idx: number;
    onSettled: () => Promise<void>;
  },
) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mood = STATUS_MOOD.attention;
  const name = (c.claimedBy?.trim() || c.client).split(/\s+/)[0];
  const method = methodLabel(lang, c.method);
  const note = c.reference
    ? tFor(lang, "paymentsPage.claim.noteRef", {
      name,
      method,
      ref: c.reference,
    })
    : tFor(lang, "paymentsPage.claim.note", { name, method });

  // REQ-930: "Got it" opens the Mark as paid modal for the reference number
  const [markPaidOpen, setMarkPaidOpen] = useState(false);

  async function act(action: "confirm" | "reject", reference = "") {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const url = action === "confirm"
      ? `/api/invoices/${c.invoiceId}/confirm-payment`
      : `/api/invoices/${c.invoiceId}/reject-claim`;
    try {
      const r = await fetch(
        url,
        action === "confirm"
          ? confirmPaymentInit(reference)
          : { method: "POST", credentials: "include" },
      );
      await r.body?.cancel();
      if (!r.ok) {
        setFailed(true);
        return;
      }
      setMarkPaidOpen(false);
      // REQ-554 (demo-loop cycle 4, m23): the sidebar's Invoices badge
      // reads the dash cache — a settled claim re-counts it.
      refreshDash().catch(() => {/* the badge keeps its last count */});
      await onSettled();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      class="qcard"
      data-cy="payment-claim"
      style={`--mood-from:${mood.from};--mood-to:${mood.to};--mood-shadow:${mood.shadow};--mood-status:${mood.statusFg}`}
    >
      <div class="qcard__mood">
        <div class="qcard__numeral">{String(idx + 1).padStart(2, "0")}</div>
        <div class="qcard__status">
          <span class="qcard__status-dot" />{" "}
          {tFor(lang, "paymentsPage.claim.label")}
        </div>
        <div class="qcard__opens" style="text-transform:uppercase">
          <I d={METHOD_ICON[c.method]} size={12} sw={2} /> {method}
        </div>
      </div>
      <div class="qcard__av">{c.initials}</div>
      <div class="qcard__body">
        <div class="qcard__client-name">{c.client} · {c.invoiceRef}</div>
        <div class="pcard__amount">{fmtMoney(c.amount)}</div>
        <p class="qcard__story">
          {note} · {whenLabel(lang, c.daysAgo)}
        </p>
        {failed && (
          <p class="qcard__story" role="alert" style="color:#B3261E">
            {tFor(lang, "paymentsPage.claim.failed")}
          </p>
        )}
      </div>
      <div class="qcard__foot">
        <button
          type="button"
          class="qcard__cta"
          data-cy="payment-claim-confirm"
          disabled={busy}
          onClick={() => {
            setFailed(false);
            setMarkPaidOpen(true);
          }}
        >
          {tFor(lang, "paymentsPage.claim.confirm")}{" "}
          <span style="display:inline-block;transition:transform 240ms">→</span>
        </button>
        <button
          type="button"
          class="pph__ghost"
          data-cy="payment-claim-reject"
          disabled={busy}
          onClick={() => act("reject")}
        >
          {tFor(lang, "paymentsPage.claim.reject")}
        </button>
      </div>
      {markPaidOpen && (
        <MarkPaidDialog
          lang={lang}
          initialReference={c.reference}
          busy={busy}
          failed={failed}
          onCancel={() => setMarkPaidOpen(false)}
          onConfirm={(ref) => act("confirm", ref)}
        />
      )}
    </article>
  );
}

/* ---------------- Landed row (compact tail of month) ---------------- */

function LandedRow(
  { lang, p, onChargeback }: {
    lang: Lang;
    p: EnrichedPayment;
    /** REQ-926 */
    onChargeback: (p: EnrichedPayment) => void;
  },
) {
  return (
    <div class="qdone__row">
      <div class="qdone__badge qdone__badge--won">
        <I d={ICN.check} size={13} sw={2.5} />
      </div>
      <div class="qdone__body">
        <div class="qdone__title">{p.client}</div>
        <div class="qdone__sub">
          {paidMethodLabel(lang, p.method)} · {p.whenLabel} · {p.invoiceRef}
        </div>
      </div>
      <div class="qdone__amt">{fmtMoney(p.amount)}</div>
      <button
        type="button"
        class="pcard__cb-btn"
        data-cy="pay-card-chargeback"
        onClick={() => onChargeback(p)}
      >
        {tFor(lang, "paymentsPage.chargeback.button")}
      </button>
    </div>
  );
}

/**
 * REQ-926 — "a modal when the chargeback is clicked to add a fee with the
 * default populated." The fee box starts on Settings' Chargeback fee; the
 * reason is optional. Confirm keeps the payment (struck through, outside
 * every total), reopens its invoice and adds the fee to it as a line.
 */
function ChargebackModal(
  { lang, p, defaultFeeCents, onCancel, onDone }: {
    lang: Lang;
    p: EnrichedPayment;
    defaultFeeCents: number;
    onCancel: () => void;
    onDone: () => Promise<void>;
  },
) {
  const [fee, setFee] = useState(
    chargebackFeeDollars({ chargebackFeeCents: defaultFeeCents }),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function confirm() {
    const feeCents = parseChargebackFee(fee);
    if (feeCents === null) {
      setErr(tFor(lang, "paymentsPage.chargeback.feeInvalid"));
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await paymentsClient.chargeback(p.id, {
        feeCents,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      await onDone();
    } catch {
      setErr(tFor(lang, "paymentsPage.chargeback.failed"));
      setBusy(false);
    }
  }
  return (
    <Backdrop
      class="send-dialog__backdrop"
      onClose={() => !busy && onCancel()}
    >
      <div
        class="send-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chargeback-title"
        data-cy="chargeback-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 id="chargeback-title" class="send-dialog__title">
          {tFor(lang, "paymentsPage.chargeback.title", {
            amount: fmtMoney(p.amount),
            invoice: p.invoiceRef,
          })}
        </h4>
        <p class="send-dialog__paper-note">
          {tFor(lang, "paymentsPage.chargeback.explain", {
            invoice: p.invoiceRef,
          })}
        </p>
        <label class="send-dialog__add">
          <span>{tFor(lang, "paymentsPage.chargeback.feeLabel")}</span>
          <input
            type="text"
            inputMode="decimal"
            class="cust-pick__search"
            data-cy="chargeback-fee"
            placeholder="0.00"
            value={fee}
            onInput={(e) => setFee((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="send-dialog__add">
          <span>{tFor(lang, "paymentsPage.chargeback.reasonLabel")}</span>
          <input
            type="text"
            class="cust-pick__search"
            data-cy="chargeback-reason"
            placeholder={tFor(
              lang,
              "paymentsPage.chargeback.reasonPlaceholder",
            )}
            value={reason}
            onInput={(e) =>
              setReason((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        {err ? <div class="cust-pick__err">{err}</div> : null}
        <div class="send-dialog__actions">
          <button
            type="button"
            class="send-dialog__cancel"
            data-cy="chargeback-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {tFor(lang, "asstChat.send.cancel")}
          </button>
          <button
            type="button"
            class="send-dialog__keep"
            data-cy="chargeback-confirm"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? "…" : tFor(lang, "paymentsPage.chargeback.confirm")}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/* ---------------- Side rail components ---------------- */

function PSideFlow(
  { lang, landed }: { lang: Lang; landed: EnrichedPayment[] },
) {
  // REQ-325 (demo m38): 12 ISO-week buckets keyed off receivedAt, ending in
  // the current week; the axis months are derived from today, not fixed.
  const { weeks, labels } = cashFlowWeeks(landed);
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
            <stop offset="0%" stop-color="#FF6B6B" stop-opacity="0.32" />
            <stop offset="100%" stop-color="#FF6B6B" stop-opacity="0" />
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
        {labels.map((m, i) => (
          <span key={i}>{tFor(lang, `dashboardPage.month.${m}`)}</span>
        ))}
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
