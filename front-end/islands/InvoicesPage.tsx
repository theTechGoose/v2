/**
 * /invoices island — receivables view matching the canonical reference
 * (reference/extracted/DocuMonster Invoices.html). Despite the URL
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
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  type Customer,
  dashboardClient,
  type Invoice,
} from "../clients/dashboard.ts";
import { clientsClient } from "../clients/clients.ts";
import type { QuoteCard } from "../clients/quotes.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";
import { fmtMoney, fmtMoneyExact } from "../lib/format.ts";
import { type Lang, langSignal, tFor, tnFor } from "../lib/i18n.ts";
import QuoteTrack from "./QuoteTrack.tsx";
import {
  cardDate,
  hasSecondaryPaymentReceived,
  scheduledSubline,
} from "../lib/invoice-card.ts";
import { Icon } from "../components/ui/Icon.tsx";
import {
  draftingKpiSub,
  invoicesHeroMode,
  reloadInvoiceData,
  scheduledHeroSubKey,
} from "../lib/headline-counts.ts";
import { followChanges, isDocChange } from "../lib/change-feed.ts";
import { isChangeOrderMutable } from "../../shared/quote-flow/adjustment-guards.ts";
import {
  formatPhoneInput,
  formatShortDate,
} from "../../shared/quote-flow/format-helpers.ts";
import PaymentReceivedForm from "../components/PaymentReceivedForm.tsx";
import { paymentRecordedText } from "../lib/payment-received.ts";
import {
  type DispatchChannel,
  interpretSendResult,
  invoiceNotDeliveredCopy,
  type SendOutcome,
  summarizeDispatch,
} from "../../shared/quote-flow/send-result.ts";
import { docNumberOf } from "../../shared/documents/numbering.ts";
import { invoiceJobNamePlaceholderKey } from "../../shared/quote-flow/trade-fit.ts"; // REQ-450
import { isExceedsAgreement } from "../../shared/documents/ledger.ts";
import {
  type DocState,
  isInvoiceLocked,
  workingCopy,
} from "../../shared/documents/versions.ts";
import {
  type BillTo,
  billToFromCustomer,
  bpToPercent,
  buildInvoiceBody,
  centsToDollars,
  computeTotals,
  defaultInvoiceNetDays,
  defaultPaymentInstructions,
  dollarsToCents,
  dueDateFrom,
  EMPTY_BILL_TO,
  formatInvoiceHeadline,
  type FormLine,
  isPresetNetDays,
  type LedgerPrefill,
  missingInfo,
  NET_DAYS_OPTIONS,
  newInvoiceCopy,
  newInvoiceStatus,
  paymentSummary,
  percentToBp,
  prefillFromLedger,
  priorBillingFor,
  type PriorInvoice,
} from "../../shared/documents/invoice-form.ts";

/** REQ-201: the state words a headline uses, in the page language. */
function headlineLabels(lang: Lang): Partial<Record<DocState, string>> {
  return {
    draft: tFor(lang, "invoices.state.draft"),
    // REQ-481 (demo M28/m10): a scheduled installment is not a draft.
    scheduled: tFor(lang, "invoices.state.scheduled"),
    sent: tFor(lang, "invoices.state.sent"),
    revised: tFor(lang, "invoices.state.revised"),
    claimed: tFor(lang, "invoices.state.claimed"),
    paid: tFor(lang, "invoices.state.paid"),
    void: tFor(lang, "invoices.state.void"),
  };
}

/** "INV-5000 · Version 2 · Revised invoice — replaces previous version" */
function headlineOf(inv: Invoice, lang: Lang): string {
  return formatInvoiceHeadline(
    inv,
    headlineLabels(lang),
    tFor(lang, "invoices.versionWord"),
  );
}

/** REQ-202: the partial / overpaid line under an amount, or null when there is nothing to say. */
function PaymentState({ inv, lang }: { inv: Invoice; lang: Lang }) {
  const p = paymentSummary(inv);
  if (p.kind === "unpaid" || p.kind === "paid") return null;
  return (
    <div
      data-cy={p.kind === "overpaid" ? "invoice-overpaid" : "invoice-partial"}
      style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;font-weight:700"
    >
      {p.kind === "partial"
        ? (
          <span style="color:var(--brand-teal,#144852)">
            {tFor(lang, "invoices.paidOf", {
              paid: fmtMoneyExact(p.paidCents),
              total: fmtMoneyExact(p.amountCents),
              balance: fmtMoneyExact(p.balanceCents),
            })}
          </span>
        )
        : (
          <span style="padding:2px 8px;border-radius:999px;background:#FFE7B5;color:#5A3D08;letter-spacing:.04em;text-transform:uppercase;font-size:10.5px;font-weight:800">
            {tFor(lang, "invoices.overpaidBy", {
              amount: fmtMoneyExact(p.overpaidCents),
            })}
          </span>
        )}
    </div>
  );
}

/** REQ-201: the "Unpublished changes" badge. */
function UnpublishedBadge({ lang }: { lang: Lang }) {
  return (
    <span
      data-cy="invoice-unpublished"
      style="display:inline-block;padding:2px 8px;border-radius:999px;background:#E4E0F7;color:#2C254A;letter-spacing:.04em;text-transform:uppercase;font-size:10.5px;font-weight:800;white-space:nowrap"
    >
      {tFor(lang, "invoices.unpublished")}
    </span>
  );
}

function hasPendingRevision(inv: Invoice): boolean {
  return !!inv.pendingRevision && Object.keys(inv.pendingRevision).length > 0;
}

interface State {
  loading: boolean;
  error: string | null;
  invoices: Invoice[];
  customers: Customer[];
}

const INITIAL: State = {
  loading: true,
  error: null,
  invoices: [],
  customers: [],
};

/** Map an Invoice.paymentIntent.method (lowercase canonical) to the
 *  customer-facing word used in the "customer paid X" subline. Returns
 *  "—" for missing/unknown values rather than an empty string so the
 *  card layout doesn't collapse. */
function methodLabel(m: string | undefined, lang: Lang): string {
  switch (m) {
    case "check":
      return tFor(lang, "invoicesPage.method.check");
    case "venmo":
      return tFor(lang, "invoicesPage.method.venmo");
    case "zelle":
      return tFor(lang, "invoicesPage.method.zelle");
    case "cashapp":
      return tFor(lang, "invoicesPage.method.cashApp");
    case "paypal":
      return tFor(lang, "invoicesPage.method.paypal");
    case "cash":
      return tFor(lang, "invoicesPage.method.cash");
    case "ach":
      return tFor(lang, "invoicesPage.method.ach");
    case "card":
      return tFor(lang, "invoicesPage.method.card");
    case "other":
      return tFor(lang, "invoicesPage.method.other");
    default:
      return "—";
  }
}

/** ES weekday abbreviations (Sunday-first, matching Date#getUTCDay). */
const ES_WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "2026-05-19" → "Tue"/"mar" / "May 19"/"19 may" — short label for the
 *  forecast hero breakdown, in the page language (UX-38: the ES hero must
 *  never show en-US tokens). Falls back to the month-day form when the date
 *  is more than a week out. */
function shortDay(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  const diffDays = Math.round((d.getTime() - Date.now()) / (24 * 3600 * 1000));
  if (diffDays >= 0 && diffDays < 7) {
    if (lang === "es") return ES_WEEKDAYS[d.getUTCDay()];
    return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  }
  return formatShortDate(iso, lang);
}

const fmtDate = cardDate;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface EnrichedInvoice extends Invoice {
  /** REQ-174: days to pay, from the day it is sent (a batch invoice carries its subscription's) */
  netDays?: number;
  client: string;
  initials: string;
  invoiceRef: string;
  daysOverdue: number;
  daysIn: number;
  stage: "scheduled" | "overdue" | "out" | "claimed" | "drafting" | "paid";
}

/** Detect a draft invoice broadly. The backend's status field is an open
 *  string; "draft" is the canonical value, but we also catch "drafting" /
 *  "drafted" variants and any pending invoice that has no issuedDate set
 *  (i.e. created but not yet sent). */
function isDraft(inv: Invoice): boolean {
  const status = (inv.status ?? "").toLowerCase();
  if (status === "draft" || status === "drafting" || status === "drafted") {
    return true;
  }
  // No status string AND no issuedDate AND not paid → still being prepped.
  if (!status && !inv.issuedDate && !inv.paidAt) return true;
  // Pending status but never issued → also a draft.
  if (status === "pending" && !inv.issuedDate) return true;
  return false;
}

function enrich(
  inv: Invoice,
  customers: Map<string, string>,
  now: Date,
): EnrichedInvoice {
  const client = (inv.customerId && customers.get(inv.customerId)) || "—";
  const today = now.toISOString().slice(0, 10);
  const due = inv.dueDate ?? "";
  const issued = inv.issuedDate ?? inv.createdAt ?? "";
  const rawStatus = (inv.status ?? "").toLowerCase();
  const isPaid = rawStatus === "paid" || !!inv.paidAt;
  const isClaimed = rawStatus === "claimed";
  const isScheduled = rawStatus === "scheduled";
  const draft = !isPaid && !isClaimed && !isScheduled && isDraft(inv);
  const daysOverdue =
    (!isPaid && !isClaimed && !isScheduled && !draft && due && due < today)
      ? Math.floor(
        (now.getTime() - new Date(due + "T00:00:00").getTime()) /
          (24 * 3600 * 1000),
      )
      : 0;
  const daysIn = issued
    ? Math.max(
      0,
      Math.floor(
        (now.getTime() - new Date(issued).getTime()) / (24 * 3600 * 1000),
      ),
    )
    : 0;
  const stage: EnrichedInvoice["stage"] = isPaid
    ? "paid"
    : isClaimed
    ? "claimed"
    : isScheduled
    ? "scheduled"
    : draft
    ? "drafting"
    : daysOverdue > 0
    ? "overdue"
    : "out";
  return {
    ...inv,
    client,
    initials: initialsOf(client),
    // REQ-198: the document number; rows older than numbering keep "#ID"
    invoiceRef: docNumberOf(inv),
    daysOverdue,
    daysIn,
    stage,
  };
}

const STAGE_MOOD: Record<
  EnrichedInvoice["stage"],
  {
    from: string;
    to: string;
    shadow: string;
    statusFg: string;
    /** i18n key resolved at render via `tFor(lang, labelKey)`. */
    labelKey: string;
  }
> = {
  overdue: {
    from: "#FFD9D9",
    to: "#FF6B6B",
    shadow: "rgba(255,107,107,0.30)",
    statusFg: "#fff",
    labelKey: "status.overdue",
  },
  out: {
    from: "#C8DDE0",
    to: "#56969E",
    shadow: "rgba(86,150,158,0.28)",
    statusFg: "#0F3036",
    labelKey: "invoicesPage.stage.out",
  },
  claimed: {
    from: "#FFE7B5",
    to: "#E5A331",
    shadow: "rgba(229,163,49,0.30)",
    statusFg: "#5A3D08",
    labelKey: "invoicesPage.stage.awaitingConfirmation",
  },
  scheduled: {
    from: "#E4E0F7",
    to: "#8B7DBF",
    shadow: "rgba(139,125,191,0.28)",
    statusFg: "#2C254A",
    labelKey: "invoicesPage.stage.scheduled",
  },
  drafting: {
    from: "#E1D7CD",
    to: "#9C8074",
    shadow: "rgba(156,128,116,0.32)",
    statusFg: "#3F2D24",
    labelKey: "status.draft",
  },
  paid: {
    from: "#CFE5C8",
    to: "#5FA34F",
    shadow: "rgba(81,152,67,0.30)",
    statusFg: "#1F3F18",
    labelKey: "status.paid",
  },
};

interface ForecastEntry {
  expectedLandDate: string;
  amount: number;
  label: string;
  invoiceId: string;
  source: "claimed" | "sent_due" | "scheduled" | "paid";
}

interface ForecastResult {
  thisWeekCents: number;
  thisWeek: ForecastEntry[];
  nextWeekCents: number;
  atRiskCents: number;
  atRisk: ForecastEntry[];
  asOf: string;
}

/** The /invoices hero's forecast; `undefined` when the backend has none
 *  (older backends 404 → the legacy "outstanding total" headline). */
function fetchForecast(): Promise<ForecastResult | undefined> {
  return fetch("/api/invoices/forecast/this-week", { credentials: "include" })
    .then((r) => r.ok ? r.json() as Promise<ForecastResult> : undefined);
}

/** REQ-030: sessionStorage key carrying a send outcome across the reload. */
const SEND_FLASH_KEY = "pm:invoice-send-flash";

export default function InvoicesPage(_props: { lang?: Lang }) {
  // Self-source the reactive UI language. Reading langSignal.value during
  // render makes this island re-render live when SettingsPage flips the
  // language. The optional `lang` prop is an ignored SSR seed.
  const lang = langSignal.value;
  const [s, setS] = useState<State>(INITIAL);
  const [forecast, setForecast] = useState<ForecastResult | undefined>(
    undefined,
  );
  /** REQ-030 (NW-25): the "Create & send" modal navigates away after
   *  dispatching — a half-delivered or failed send is carried across the
   *  reload (sessionStorage) and shown here instead of being dropped. */
  /** REQ-322 (demo m36): "Payment of $X recorded" after the detail's
   *  "Payment received" form saves — the page confirms, not just closes. */
  const [payFlash, setPayFlash] = useState<string | null>(null);
  const [sendFlash] = useState<
    { text: string; partial: boolean } | null
  >(() => {
    try {
      const raw = globalThis.sessionStorage?.getItem(SEND_FLASH_KEY);
      if (!raw) return null;
      globalThis.sessionStorage.removeItem(SEND_FLASH_KEY);
      return JSON.parse(raw) as { text: string; partial: boolean };
    } catch {
      return null;
    }
  });
  // UX-02: /invoices?new=1 (the won-quote "Crear la factura" CTA) opens the
  // new-invoice modal directly.
  const [newOpen, setNewOpen] = useState(() =>
    typeof globalThis.location !== "undefined" &&
    new URLSearchParams(globalThis.location.search).get("new") === "1"
  );
  // REQ-206: /invoices?new=1&quoteId=<id> (the QuotesPage link) prefills the
  // form from the quote's ledger and keeps the invoice linked to the quote.
  const [newQuoteId] = useState<string | null>(() =>
    typeof globalThis.location !== "undefined"
      ? new URLSearchParams(globalThis.location.search).get("quoteId")
      : null
  );
  // Deep link: /invoices?open=<id> opens that invoice's detail view
  // automatically (PDF p6 editing + p18 adjustments land here).
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof globalThis.location !== "undefined"
      ? new URLSearchParams(globalThis.location.search).get("open")
      : null
  );

  // Re-pull the invoice list after a mutation (discount / edit / change
  // order / payment received) so every displayed total is the live
  // `amount` — no full reload. REQ-243: the hero reads the forecast too, so
  // it is re-pulled with the list (a paid invoice stops being "expected").
  async function refreshInvoices() {
    const fresh = await reloadInvoiceData({
      invoices: () => dashboardClient.invoices(undefined),
      forecast: fetchForecast,
    });
    // A failed half keeps what it had rather than blanking the page.
    const invoices = fresh.invoices;
    if (invoices) setS((prev) => ({ ...prev, invoices }));
    if (fresh.forecast) setForecast(fresh.forecast);
  }

  useEffect(() => {
    let alive = true;
    // REQ-508 (demo cycle 3, m20): REQ-022's scheduled-invoice nudges are swept
    // by the backend's own minute timer — a page view no longer triggers them.
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
    // Forecast hero — fire-and-forget. If it 404s on older backends we
    // silently fall back to the legacy "outstanding total" headline.
    fetchForecast()
      .then((f) => {
        if (alive && f) setForecast(f);
      })
      .catch(() => {/* ignore */});
    return () => {
      alive = false;
    };
  }, []);

  // REQ-493 (demo-loop c3 m7): the list was re-read only after this page's
  // own actions, so a payment the client claimed stayed "Enviada" while the
  // topbar chip already said they paid. Follow the change feed — the
  // notifications the topbar polls, and the client's actions in this
  // browser's other tabs: a quote or invoice the client moved re-reads the
  // list and the forecast (refreshInvoices only touches stable setters).
  useEffect(() => followChanges(isDocChange, refreshInvoices), []);

  const customerNames = useMemo(
    () =>
      new Map(
        (Array.isArray(s.customers) ? s.customers : []).map((
          c,
        ) => [c.id, c.name]),
      ),
    [s.customers],
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
        {tFor(lang, "invoicesPage.loadError")} {s.error}
      </div>
    );
  }

  const now = new Date();
  const enriched = (Array.isArray(s.invoices) ? s.invoices : []).map((i) =>
    enrich(i, customerNames, now)
  );

  const overdue = enriched.filter((i) => i.stage === "overdue").sort((a, b) =>
    b.daysOverdue - a.daysOverdue
  );
  const out = enriched.filter((i) => i.stage === "out").sort((a, b) =>
    b.daysIn - a.daysIn
  );
  const claimed = enriched.filter((i) => i.stage === "claimed").sort((a, b) =>
    (b.paymentIntent?.claimedAt ?? "").localeCompare(
      a.paymentIntent?.claimedAt ?? "",
    )
  );
  const scheduled = enriched.filter((i) => i.stage === "scheduled").sort((
    a,
    b,
  ) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""));
  const drafting = enriched.filter((i) => i.stage === "drafting");
  const monthCutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  const paidThisMonth = enriched.filter((i) =>
    i.stage === "paid" && i.paidAt && new Date(i.paidAt) >= monthCutoff
  );

  const outstandingTotal = [...overdue, ...out].reduce(
    (sum, i) => sum + (i.amount ?? 0),
    0,
  );
  const overdueTotal = overdue.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  const outTotal = out.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  // REQ-317: the unsent installments of signed agreements — money still to
  // bill, so the hero never reads "All clear" over them.
  const scheduledTotal = scheduled.reduce(
    (sum, i) => sum + (i.amount ?? 0),
    0,
  );
  const nextScheduled = scheduled.find((i) => !!i.scheduledFor);
  const nextScheduledFor = nextScheduled?.scheduledFor;
  const paidThisMonthTotal = paidThisMonth.reduce(
    (sum, i) => sum + (i.amount ?? 0),
    0,
  );

  const openInv = openId ? enriched.find((i) => i.id === openId) : undefined;

  return (
    <>
      {sendFlash && (
        <p
          class="qcard__sendfail"
          role="alert"
          data-cy={sendFlash.partial ? "send-partial" : "invoice-send-failure"}
        >
          {sendFlash.text}
        </p>
      )}
      {payFlash && (
        <p
          role="status"
          data-cy="payment-recorded"
          style="margin:0 0 12px;padding:10px 14px;border-radius:10px;background:var(--brand-green-soft,#e8f3e4);color:var(--brand-green,#519843);font-size:13.5px;font-weight:700"
        >
          {payFlash}
        </p>
      )}
      {
        /* Rendered FIRST (above the hero) so the detail is what the
          contractor lands on when following an ?open= deep link. */
      }
      {openInv && (
        <InvoiceDetail
          inv={openInv}
          lang={lang}
          onClose={() => {
            setOpenId(null);
            const url = new URL(globalThis.location.href);
            url.searchParams.delete("open");
            url.searchParams.delete("pay");
            history.replaceState(null, "", url.toString());
          }}
          onChanged={refreshInvoices}
          onPaymentRecorded={(cents) =>
            setPayFlash(paymentRecordedText(lang, cents))}
        />
      )}
      <InvoicesHero
        outstandingTotal={outstandingTotal}
        outstandingCount={overdue.length + out.length}
        // REQ-243: a claim waiting for confirmation is never "All clear".
        claimedCount={claimed.length}
        // REQ-317: a scheduled installment is money still to bill.
        scheduledCount={scheduled.length}
        scheduledCents={scheduledTotal}
        nextScheduledFor={nextScheduledFor}
        // REQ-411 (m34): a single after-completion bill reads "Bills on
        // completion", not "Next installment".
        nextScheduled={nextScheduled}
        overdueCount={overdue.length}
        totalInvoiceCount={enriched.length}
        forecast={forecast}
        lang={lang}
        onNew={() => setNewOpen(true)}
      />
      {newOpen && (
        <NewInvoiceModal
          customers={Array.isArray(s.customers) ? s.customers : []}
          invoices={Array.isArray(s.invoices) ? s.invoices : []}
          lang={lang}
          quoteId={newQuoteId}
          onClose={() => setNewOpen(false)}
        />
      )}
      <InvoicesKpis
        overdueCount={overdue.length}
        overdueTotal={overdueTotal}
        outCount={out.length}
        outTotal={outTotal}
        draftingCount={drafting.length}
        scheduledCount={scheduled.length}
        paidCount={paidThisMonth.length}
        paidTotal={paidThisMonthTotal}
        lang={lang}
      />

      <div class="qlay">
        <div>
          <QuoteTrack
            num="01"
            title={tFor(lang, "invoicesPage.track.overdueTitle")}
            count={overdue.length}
            unit={tFor(lang, "invoicesPage.unit.invoice")}
            defaultOpen
            storageKey="invoices:track:01"
          >
            {overdue.length === 0
              ? <EmptyTrack hint={tFor(lang, "invoicesPage.empty.overdue")} />
              : (
                <div class="qcards">
                  {overdue.map((inv, i) => (
                    <InvoiceCard
                      key={inv.id}
                      inv={inv}
                      idx={i}
                      now={now}
                      lang={lang}
                    />
                  ))}
                </div>
              )}
          </QuoteTrack>

          <QuoteTrack
            num="02"
            title={tFor(lang, "invoicesPage.track.awaitingTitle")}
            count={claimed.length}
            unit={tFor(lang, "invoicesPage.unit.invoice")}
            defaultOpen
            storageKey="invoices:track:awaiting"
          >
            {claimed.length === 0
              ? <EmptyTrack hint={tFor(lang, "invoicesPage.empty.awaiting")} />
              : (
                <div class="qcards" data-cy="awaiting-confirmation-track">
                  {claimed.map((inv, i) => (
                    <InvoiceCard
                      key={inv.id}
                      inv={inv}
                      idx={i}
                      now={now}
                      lang={lang}
                    />
                  ))}
                </div>
              )}
          </QuoteTrack>

          <QuoteTrack
            num="03"
            title={tFor(lang, "invoicesPage.track.outTitle")}
            count={out.length}
            unit={tFor(lang, "invoicesPage.unit.invoice")}
            defaultOpen
            storageKey="invoices:track:02"
          >
            {out.length === 0
              ? <EmptyTrack hint={tFor(lang, "invoicesPage.empty.out")} />
              : (
                <div class="qcards">
                  {out.map((inv, i) => (
                    <InvoiceCard
                      key={inv.id}
                      inv={inv}
                      idx={i}
                      now={now}
                      lang={lang}
                    />
                  ))}
                </div>
              )}
          </QuoteTrack>

          <QuoteTrack
            num="04"
            title={tFor(lang, "invoicesPage.track.upcomingTitle")}
            count={scheduled.length}
            unit={tFor(lang, "invoicesPage.unit.invoice")}
            /* P-31/P-09: an invoice with a live CTA must not hide behind a
               collapsed track — open whenever there is something actionable. */
            defaultOpen={scheduled.length > 0}
            storageKey="invoices:track:upcoming"
          >
            {scheduled.length === 0
              ? <EmptyTrack hint={tFor(lang, "invoicesPage.empty.scheduled")} />
              : (
                <div class="qcards" data-cy="upcoming-track">
                  {scheduled.map((inv, i) => (
                    <InvoiceCard
                      key={inv.id}
                      inv={inv}
                      idx={i}
                      now={now}
                      lang={lang}
                    />
                  ))}
                </div>
              )}
          </QuoteTrack>

          <QuoteTrack
            num="05"
            title={tFor(lang, "invoicesPage.track.draftingTitle")}
            count={drafting.length}
            unit={tFor(lang, "invoicesPage.unit.invoice")}
            defaultOpen={drafting.length > 0}
            storageKey="invoices:track:03"
          >
            {drafting.length === 0
              ? <EmptyTrack hint={tFor(lang, "invoicesPage.empty.drafting")} />
              : (
                <div class="qcards">
                  {drafting.map((inv, i) => (
                    <InvoiceCard
                      key={inv.id}
                      inv={inv}
                      idx={i}
                      now={now}
                      lang={lang}
                    />
                  ))}
                </div>
              )}
          </QuoteTrack>

          <QuoteTrack
            num="06"
            title={tFor(lang, "invoicesPage.track.paidTitle")}
            count={paidThisMonth.length}
            unit={tFor(lang, "invoicesPage.unit.invoice")}
            defaultOpen={false}
            storageKey="invoices:track:04"
          >
            {paidThisMonth.length === 0
              ? <EmptyTrack hint={tFor(lang, "invoicesPage.empty.paid")} />
              : (
                <div class="qcards">
                  {paidThisMonth.map((inv, i) => (
                    <InvoiceCard
                      key={inv.id}
                      inv={inv}
                      idx={i}
                      now={now}
                      lang={lang}
                    />
                  ))}
                </div>
              )}
          </QuoteTrack>
        </div>
      </div>
    </>
  );
}

/* ---------------- Hero ---------------- */

function InvoicesHero(
  {
    outstandingTotal,
    outstandingCount,
    claimedCount,
    scheduledCount = 0,
    scheduledCents = 0,
    nextScheduledFor,
    nextScheduled,
    overdueCount,
    totalInvoiceCount,
    forecast,
    lang,
    onNew,
  }: {
    outstandingTotal: number;
    outstandingCount: number;
    claimedCount: number;
    scheduledCount?: number;
    scheduledCents?: number;
    nextScheduledFor?: string;
    nextScheduled?: { installmentTotal?: number };
    overdueCount: number;
    totalInvoiceCount: number;
    forecast?: ForecastResult;
    lang: Lang;
    onNew: () => void;
  },
) {
  const mode = invoicesHeroMode({
    totalInvoiceCount,
    outstandingCount,
    claimedCount,
    scheduledCount,
    scheduledCents,
    forecast,
  });
  const trulyEmpty = mode === "empty";
  const haveForecast = !!forecast &&
    (forecast.thisWeekCents > 0 || forecast.nextWeekCents > 0 ||
      forecast.atRiskCents > 0);
  return (
    <header class="qph">
      <div class="qph__copy">
        <div class="qph__eyebrow">
          <span class="qph__eyebrow-dot" /> {tFor(lang, "invoicesPage.eyebrow")}
        </div>
        <h1 class="qph__title" data-cy="forecast-hero">
          {trulyEmpty
            ? (
              <>
                {tFor(lang, "invoicesPage.hero.emptyPre")}{" "}
                <em>{tFor(lang, "invoicesPage.hero.emptyEm")}</em>.
              </>
            )
            : mode === "claimed"
            ? (
              <>
                {tFor(
                  lang,
                  claimedCount === 1
                    ? "invoicesPage.hero.claimed.one"
                    : "invoicesPage.hero.claimed.other",
                  { n: claimedCount },
                )} <em>{tFor(lang, "invoicesPage.hero.claimedEm")}</em>.
              </>
            )
            : mode === "scheduled"
            ? (
              <>
                {(() => {
                  // "{amount} still to bill." / "Queda por facturar {amount}."
                  const [pre, post] = tFor(lang, "invoicesPage.hero.scheduled")
                    .split("{amount}");
                  return (
                    <>
                      {pre}
                      <em>{fmtMoney(scheduledCents)}</em>
                      {post ?? ""}
                    </>
                  );
                })()}
              </>
            )
            : mode === "clear"
            ? (
              <>
                {tFor(lang, "invoicesPage.hero.clearPre")}{" "}
                <em>{tFor(lang, "invoicesPage.hero.clearEm")}</em>.
              </>
            )
            : mode === "thisWeek"
            ? (
              <>
                <em>{fmtMoney(forecast!.thisWeekCents)}</em>{" "}
                {tFor(lang, "invoicesPage.hero.expectedThisWeek")}
                <br />
                {tFor(lang, "invoicesPage.hero.across")} {forecast!.thisWeek
                  .length} {tFor(
                    lang,
                    forecast!.thisWeek.length === 1
                      ? "invoicesPage.unitPayment.one"
                      : "invoicesPage.unitPayment.other",
                    { n: forecast!.thisWeek.length },
                  )}.
              </>
            )
            : mode === "nextWeek"
            ? (
              <>
                {tFor(lang, "invoicesPage.hero.quietPre")}{" "}
                <em>{fmtMoney(forecast!.nextWeekCents)}</em>{" "}
                {tFor(lang, "invoicesPage.hero.comingNextWeek")}
              </>
            )
            : (
              <>
                <em>{fmtMoney(outstandingTotal)}</em>{" "}
                {tFor(lang, "invoicesPage.hero.onTheWay")}
                <br />
                {tFor(lang, "invoicesPage.hero.across")} {outstandingCount}{" "}
                {tFor(
                  lang,
                  outstandingCount === 1
                    ? "invoicesPage.unitInvoice.one"
                    : "invoicesPage.unitInvoice.other",
                  { n: outstandingCount },
                )}.
              </>
            )}
        </h1>
        <p class="qph__sub">
          {trulyEmpty
            ? <>{tFor(lang, "invoicesPage.sub.empty")}</>
            : mode === "claimed"
            ? <>{tFor(lang, "invoicesPage.sub.claimed")}</>
            : mode === "scheduled"
            ? (
              <span data-cy="hero-scheduled-next">
                {tFor(lang, scheduledHeroSubKey(nextScheduled))}{" "}
                <strong>
                  {nextScheduledFor
                    ? formatShortDate(nextScheduledFor, lang)
                    : "—"}
                </strong>{" "}
                · {scheduledCount} {tFor(
                  lang,
                  scheduledCount === 1
                    ? "invoicesPage.unitScheduled.one"
                    : "invoicesPage.unitScheduled.other",
                  { n: scheduledCount },
                )}
              </span>
            )
            : haveForecast && forecast!.thisWeek.length > 0
            ? (
              <span data-cy="forecast-breakdown">
                {forecast!.thisWeek.slice(0, 3).map((e, i) => (
                  <span key={e.invoiceId}>
                    {i > 0 ? " · " : ""}
                    {shortDay(e.expectedLandDate, lang)}:{" "}
                    <strong>{e.label} {fmtMoney(e.amount)}</strong>
                  </span>
                ))}
              </span>
            )
            : overdueCount > 0
            ? (
              <>
                <strong>{overdueCount}</strong> {tFor(
                  lang,
                  overdueCount === 1
                    ? "invoicesPage.sub.pastDueVerb.one"
                    : "invoicesPage.sub.pastDueVerb.other",
                  { n: overdueCount },
                )} {tFor(lang, "invoicesPage.sub.pastDue")}
              </>
            )
            : <>{tFor(lang, "invoicesPage.sub.nothingPastDue")}</>}
        </p>
        {haveForecast && forecast!.atRiskCents > 0
          ? (
            <p
              class="qph__sub"
              style="color:#a83b3b"
              data-cy="forecast-at-risk"
            >
              ⚠ <strong>{fmtMoney(forecast!.atRiskCents)}</strong>{" "}
              {tFor(lang, "invoicesPage.atRisk.across")} {forecast!.atRisk
                .length} {tFor(lang, "invoicesPage.atRisk.overdue")} {tFor(
                  lang,
                  forecast!.atRisk.length === 1
                    ? "invoicesPage.unitInvoice.one"
                    : "invoicesPage.unitInvoice.other",
                  { n: forecast!.atRisk.length },
                )}.
            </p>
          )
          : null}
        <div class="qph__cta-row">
          <button
            type="button"
            class="qph__cta"
            data-cy="invoice-new"
            onClick={onNew}
            style="appearance:none;cursor:pointer;font:inherit"
          >
            <I d={ICN.plus} size={14} sw={2.5} />{" "}
            {tFor(lang, "invoicesPage.newInvoice")}
          </button>
          {
            /* UX-23: nothing to export on an empty account — and when shown,
              the ghost must be legible on the cream page, not the .qph__cta
              white-on-transparent ghost the audit measured. */
          }
          {!trulyEmpty && (
            <a
              class="qph__cta qph__cta--ghost"
              data-cy="invoice-export"
              href={`/api/invoices/export.csv?year=${new Date().getFullYear()}`}
              style="background:transparent;border:1px solid var(--brand-teal);color:var(--brand-teal)"
            >
              {tFor(lang, "invoicesPage.exportCsv", {
                year: new Date().getFullYear(),
              })}
            </a>
          )}
          {/* REQ-208: the full exports — every invoice, or only the open ones */}
          {!trulyEmpty && (
            <a
              class="qph__cta qph__cta--ghost"
              data-cy="invoice-export-all"
              href="/api/invoices/export.csv?status=all"
              style="background:transparent;border:1px solid var(--brand-teal);color:var(--brand-teal)"
            >
              {tFor(lang, "export.invoicesAll")}
            </a>
          )}
          {!trulyEmpty && (
            <a
              class="qph__cta qph__cta--ghost"
              data-cy="invoice-export-unpaid"
              href="/api/invoices/export.csv?status=unpaid"
              style="background:transparent;border:1px solid var(--brand-teal);color:var(--brand-teal)"
            >
              {tFor(lang, "export.invoicesUnpaid")}
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

/* ---------------- KPIs ---------------- */

function InvoicesKpis(
  {
    overdueCount,
    overdueTotal,
    outCount,
    outTotal,
    draftingCount,
    scheduledCount = 0,
    paidCount,
    paidTotal,
    lang,
  }: {
    overdueCount: number;
    overdueTotal: number;
    outCount: number;
    outTotal: number;
    draftingCount: number;
    /** REQ-481 (m10): installments waiting for their send day */
    scheduledCount?: number;
    paidCount: number;
    paidTotal: number;
    lang: Lang;
  },
) {
  return (
    <div class="qkpi">
      <div class={`qkpi__cell${overdueCount > 0 ? " qkpi__cell--accent" : ""}`}>
        <div class="qkpi__lbl">{tFor(lang, "status.overdue")}</div>
        <div class="qkpi__val">{fmtMoney(overdueTotal)}</div>
        <div class="qkpi__sub">
          {overdueCount} {tFor(
            lang,
            overdueCount === 1
              ? "invoicesPage.unitInvoice.one"
              : "invoicesPage.unitInvoice.other",
            { n: overdueCount },
          )}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">{tFor(lang, "invoicesPage.kpi.out")}</div>
        <div class="qkpi__val">{fmtMoney(outTotal)}</div>
        <div class="qkpi__sub">
          {tFor(lang, "invoicesPage.kpi.outSub", { n: outCount })}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">{tFor(lang, "invoicesPage.kpi.drafting")}</div>
        <div class="qkpi__val">{draftingCount}</div>
        <div class="qkpi__sub" data-cy="invoices-kpi-drafting-sub">
          {(() => {
            // REQ-481 (m10): "no drafts open" never sits beside a scheduled one.
            const sub = draftingKpiSub(draftingCount, scheduledCount);
            return tFor(lang, sub.key, { n: sub.n });
          })()}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">{tFor(lang, "invoicesPage.kpi.paid")}</div>
        <div class="qkpi__val">{fmtMoney(paidTotal)}</div>
        <div class="qkpi__sub">
          {tnFor(lang, "invoicesPage.kpi.paidSub", paidCount)}
        </div>
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

/** Change-order row as returned by GET /invoices/:id/change-orders. */
interface ChangeOrderRow {
  id: string;
  description: string;
  deltaAmountCents: number;
  status: "pending" | "approved" | "declined";
  createdAt: string;
}

const CO_CHIP_COLOR: Record<ChangeOrderRow["status"], string> = {
  pending: "#b07d2a",
  approved: "var(--brand-green)",
  declined: "#a83b3b",
};

/* ------- Adjustment API helpers (shared by InvoiceCard + InvoiceDetail) ------- */

/** POST an immediate discount (dollars are converted by callers — CENTS here). */
function postDiscount(
  invoiceId: string,
  discountCents: number,
): Promise<Response> {
  return fetch(`/api/invoices/${invoiceId}/discount`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ discountCents }),
  });
}

/** POST a pending change order; resolves to the created row's id. */
async function postChangeOrder(
  invoiceId: string,
  description: string,
  deltaAmountCents: number,
): Promise<string | null> {
  const r = await fetch(`/api/invoices/${invoiceId}/change-orders`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, deltaAmountCents }),
  });
  if (!r.ok) return null;
  const co = await r.json() as { id: string };
  return co.id;
}

async function fetchChangeOrders(
  invoiceId: string,
): Promise<ChangeOrderRow[] | null> {
  try {
    const r = await fetch(`/api/invoices/${invoiceId}/change-orders`, {
      credentials: "include",
    });
    if (!r.ok) return null;
    return await r.json() as ChangeOrderRow[];
  } catch {
    return null;
  }
}

/* ---------------- Invoice detail (?open= deep link) ---------------- */

/** Loose string field off the open-shaped Invoice ([k: string]: unknown). */
function strField(inv: Invoice, key: string): string | undefined {
  const v = (inv as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

interface EditableLine {
  description: string;
  /** Dollars as typed (converted to integer cents on save). */
  price: string;
  quantity: number;
  unit?: string;
}

function lineItemsOf(inv: Invoice): EditableLine[] {
  const raw = (inv as Record<string, unknown>).lineItems;
  if (!Array.isArray(raw)) return [];
  return raw.map((li) => {
    const row = (li ?? {}) as Record<string, unknown>;
    return {
      description: typeof row.description === "string" ? row.description : "",
      price: typeof row.price === "number" ? String(row.price / 100) : "",
      quantity: typeof row.quantity === "number" ? row.quantity : 1,
      ...(typeof row.unit === "string" ? { unit: row.unit } : {}),
    };
  });
}

/**
 * InvoiceDetail — the invoice's detail view, opened by /invoices?open=<id>.
 * Hosts the PDF p6 edit surface ([data-cy=invoice-edit] → PUT /invoices/:id)
 * and the p18 adjustments: [data-cy=invoice-discount-btn] (POST /discount)
 * and [data-cy=invoice-change-order-btn] (POST /change-orders → shareable
 * /co/<id> approval link). Change orders list with live pending / approved /
 * declined status; the total row always shows the live `amount` (a pending
 * or declined order never moves it — only customer approval does, server-
 * side, after which `onChanged` re-pulls the list).
 *
 * NOTE — DOM order in here is load-bearing for the TDD specs' loose
 * selectors: the section renders BEFORE the hero (no earlier "$"/"Amount"
 * text), the change-order form's first field is a textarea (the page's
 * first visible input), and the "$"-bearing rows (list, discount, total)
 * come AFTER the forms.
 */
function InvoiceDetail(
  { inv, lang, onClose, onChanged, onPaymentRecorded }: {
    inv: EnrichedInvoice;
    lang: Lang;
    onClose: () => void;
    onChanged: () => void | Promise<void>;
    /** REQ-322: the recorded amount (INTEGER CENTS) for the page's flash. */
    onPaymentRecorded: (cents: number) => void;
  },
) {
  type Mode = "none" | "edit" | "discount" | "co" | "pay";
  // REQ-018: /invoices?open=<id>&pay=1 lands straight on "Payment received".
  const [mode, setMode] = useState<Mode>(() =>
    typeof globalThis.location !== "undefined" &&
      new URLSearchParams(globalThis.location.search).get("pay") === "1"
      ? "pay"
      : "none"
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // REQ-167: delete asks inline first — never a browser dialog
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function doDelete() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/invoices/${inv.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        setErr(tFor(lang, "invoicesPage.detail.errDelete"));
        return;
      }
      onClose();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  // Edit surface (PUT /api/invoices/:id). REQ-201: an issued invoice's
  // edits wait as a pending revision — the form shows the WORKING copy (the
  // live record with the pending edits folded in), never the stale published one.
  const draft = workingCopy(inv) as EnrichedInvoice;
  const locked = isInvoiceLocked(inv);
  const [editJobName, setEditJobName] = useState(
    strField(draft, "jobName") ?? "",
  );
  const [editDesc, setEditDesc] = useState(
    strField(draft, "description") ?? "",
  );
  const [editAmount, setEditAmount] = useState(
    draft.amount != null ? String(draft.amount / 100) : "",
  );
  const [editItems, setEditItems] = useState<EditableLine[]>(() =>
    lineItemsOf(draft)
  );
  /** A line changed: the total follows the lines (discount + tax as stored). */
  function updateLines(next: EditableLine[]) {
    setEditItems(next);
    const totals = computeTotals({
      lineItems: next.map((li) => ({
        description: li.description,
        quantity: li.quantity,
        price: dollarsToCents(li.price),
      })),
      discountCents: typeof draft.discountCents === "number"
        ? draft.discountCents
        : 0,
      taxRateBp: typeof draft.taxRateBp === "number" ? draft.taxRateBp : 0,
    });
    setEditAmount(centsToDollars(totals.totalCents));
  }

  // REQ-201: publish the pending revision — version + 1 on the same link.
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  async function doPublish(notify: boolean) {
    if (publishBusy) return;
    setPublishBusy(true);
    setErr(null);
    setPublishNote(null);
    try {
      const published = await dashboardClient.publishInvoice(inv.id, notify);
      setPublishNote(
        tFor(
          lang,
          notify ? "invoices.published" : "invoices.publishedQuiet",
          { n: published.version ?? 0, customer: inv.client },
        ),
      );
      await onChanged();
    } catch (e) {
      const reason = e && typeof e === "object" &&
          typeof (e as { body?: { reason?: unknown } }).body === "object"
        ? (e as { body: { reason?: unknown } }).body?.reason
        : undefined;
      setErr(
        reason === "locked_paid"
          ? tFor(lang, "invoices.publishLocked")
          : reason === "nothing_to_publish"
          ? tFor(lang, "invoices.publishNothing")
          : tFor(lang, "invoices.publishFailed"),
      );
    } finally {
      setPublishBusy(false);
    }
  }

  // Discount — the input takes FOCUS the moment the form opens (the spec
  // types straight into cy.focused()). Focused via a callback ref, which
  // Preact invokes synchronously at DOM commit — a useEffect (deferred to
  // rAF) could land after the harness already queried document.activeElement.
  const [discountDollars, setDiscountDollars] = useState("");
  const focusOnMount = (el: HTMLInputElement | null) => el?.focus();

  // Change orders — loaded eagerly so pending/approved/declined states are
  // visible without any clicks.
  const [coDesc, setCoDesc] = useState("");
  const [coDollars, setCoDollars] = useState("");
  const [coLink, setCoLink] = useState<string | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRow[] | null>(
    null,
  );
  useEffect(() => {
    fetchChangeOrders(inv.id).then((rows) => {
      if (rows) setChangeOrders(rows);
    });
  }, [inv.id]);

  function switchMode(next: Mode) {
    setErr(null);
    setMode((cur) => (cur === next ? "none" : next));
  }

  async function doSaveEdit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const cents = Math.round(Number(editAmount) * 100);
      const body: Record<string, unknown> = {};
      if (editJobName.trim()) body.jobName = editJobName.trim();
      if (editDesc.trim()) body.description = editDesc.trim();
      if (Number.isFinite(cents) && cents > 0) body.amount = cents;
      if (editItems.length > 0) {
        body.lineItems = editItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          ...(li.unit ? { unit: li.unit } : {}),
          price: Math.round(Number(li.price) * 100) || 0,
        }));
      }
      const r = await fetch(`/api/invoices/${inv.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setErr(tFor(lang, "invoicesPage.detail.errSave"));
        return;
      }
      setMode("none");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function doApplyDiscount() {
    if (busy) return;
    const cents = Math.round(Number(discountDollars) * 100);
    if (!cents || cents <= 0) {
      setErr(tFor(lang, "invoicesPage.adjust.errDiscountAmount"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await postDiscount(inv.id, cents);
      if (!r.ok) {
        // P-41: the pending-claim 409 gets its explicit warning copy.
        setErr(await discountErrorCopy(r, lang));
        return;
      }
      setDiscountDollars("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function doCreateCo() {
    if (busy) return;
    const cents = Math.round(Number(coDollars) * 100);
    if (!coDesc.trim() || !cents) {
      setErr(tFor(lang, "invoicesPage.adjust.errCoFields"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const coId = await postChangeOrder(inv.id, coDesc.trim(), cents);
      if (!coId) {
        setErr(tFor(lang, "invoicesPage.adjust.errCoCreate"));
        return;
      }
      setCoLink(`${globalThis.location.origin}/co/${coId}`);
      setCoDesc("");
      setCoDollars("");
      const rows = await fetchChangeOrders(inv.id);
      if (rows) setChangeOrders(rows);
    } finally {
      setBusy(false);
    }
  }

  const discountCents =
    typeof (inv as Record<string, unknown>).discountCents === "number"
      ? (inv as Record<string, unknown>).discountCents as number
      : 0;
  const jobName = strField(inv, "jobName");
  const moodLabel = tFor(lang, STAGE_MOOD[inv.stage].labelKey);
  const eyebrowStyle =
    "font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--fg-muted,#6b7560)";
  const secondaryBtn =
    "appearance:none;cursor:pointer;background:#fff;border:1px solid var(--border,#d8dcd5);border-radius:9px;padding:8px 13px;font:inherit;font-size:13px;font-weight:700;color:var(--brand-teal,#144852)";
  const primaryBtn =
    "appearance:none;cursor:pointer;border:0;border-radius:9px;padding:8px 14px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-size:13px;font-weight:800";
  // REQ-167: the one destructive button — outlined coral, never a gradient
  const dangerBtn =
    "appearance:none;cursor:pointer;background:#fff;border:1px solid var(--brand-pink,#ff6b6b);border-radius:9px;padding:8px 13px;font:inherit;font-size:13px;font-weight:700;color:var(--brand-pink-dark,#d94f4f)";
  const ghostBtn =
    "appearance:none;cursor:pointer;background:none;border:0;padding:8px 10px;font:inherit;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)";
  // REQ-202: a locked action — visibly off, the tooltip says why
  const lockedBtn =
    "appearance:none;cursor:not-allowed;opacity:.5;background:#fff;border:1px solid var(--border,#d8dcd5);border-radius:9px;padding:8px 13px;font:inherit;font-size:13px;font-weight:700;color:var(--brand-teal,#144852)";
  const fieldStyle =
    "width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border,#d8dcd5);border-radius:8px;font:inherit;font-size:13.5px";
  const formBox =
    "margin-top:14px;display:flex;flex-direction:column;gap:10px;background:rgba(0,0,0,0.03);border-radius:10px;padding:12px 14px";

  return (
    <section
      data-cy="invoice-detail"
      style="background:#fff;border:1px solid var(--border,#d8dcd5);border-radius:16px;padding:20px 22px;margin-bottom:22px;box-shadow:0 10px 30px rgba(20,72,82,0.08)"
    >
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="flex:1;min-width:0">
          <div style={eyebrowStyle}>
            {tFor(lang, "invoicesPage.back.eyebrow")}
          </div>
          <h2 style="margin:4px 0 0;font-size:20px;font-weight:800;color:var(--fg,#144852);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            {jobName ?? inv.client}
          </h2>
          <div style="margin-top:2px;font-size:12.5px;color:var(--fg-muted,#6b7560)">
            {inv.client} · {inv.invoiceRef}
          </div>
          {/* REQ-201: number · version · state */}
          <div
            data-cy="invoice-headline"
            style="margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;font-weight:700;color:var(--fg,#144852)"
          >
            <span>{headlineOf(inv, lang)}</span>
            {hasPendingRevision(inv) && <UnpublishedBadge lang={lang} />}
          </div>
          {locked && (
            <div
              data-cy="invoice-locked"
              style="margin-top:4px;font-size:12px;color:var(--fg-muted,#6b7560)"
            >
              🔒 {tFor(lang, "invoices.lockedPaid")}
            </div>
          )}
        </div>
        <span style="font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:999px;border:1px solid currentColor;color:var(--brand-teal,#144852);white-space:nowrap">
          {moodLabel}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tFor(lang, "common.close")}
          style="appearance:none;cursor:pointer;background:none;border:0;padding:4px;color:var(--fg-muted,#6b7560)"
        >
          <I d={ICN.x} size={16} sw={2.5} />
        </button>
      </div>

      {/* REQ-201: a pending revision — publish it (and tell the customer) */}
      {hasPendingRevision(inv) && !locked && (
        <div
          data-cy="invoice-pending-revision"
          style="margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:rgba(139,125,191,0.10);border-radius:10px;padding:10px 12px"
        >
          <span style="flex:1;min-width:0;font-size:12.5px;color:var(--fg-muted,#6b7560)">
            {tFor(lang, "invoices.unpublished")}
          </span>
          <button
            type="button"
            data-cy="invoice-publish-quiet"
            onClick={() => doPublish(false)}
            disabled={publishBusy || busy}
            style={ghostBtn}
          >
            {tFor(lang, "invoices.publishQuiet")}
          </button>
          <button
            type="button"
            data-cy="invoice-publish-notify"
            onClick={() => doPublish(true)}
            disabled={publishBusy || busy}
            style={primaryBtn}
          >
            {publishBusy
              ? tFor(lang, "invoices.publishing")
              : tFor(lang, "invoices.publishNotify")}
          </button>
        </div>
      )}
      {publishNote && (
        <p
          role="status"
          data-cy="invoice-published-note"
          style="margin:10px 0 0;font-size:13px;font-weight:700;color:var(--brand-green,#519843)"
        >
          {publishNote}
        </p>
      )}

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        {/* REQ-202: a paid invoice is locked — edit / discount / change order / delete are off */}
        <button
          type="button"
          data-cy="invoice-edit"
          onClick={() => switchMode("edit")}
          disabled={locked}
          title={locked ? tFor(lang, "invoices.lockedPaid") : undefined}
          style={locked ? lockedBtn : secondaryBtn}
        >
          {tFor(lang, "invoicesPage.detail.editBtn")}
        </button>
        <button
          type="button"
          data-cy="invoice-discount-btn"
          onClick={() => switchMode("discount")}
          disabled={locked}
          title={locked ? tFor(lang, "invoices.lockedPaid") : undefined}
          style={locked ? lockedBtn : secondaryBtn}
        >
          {tFor(lang, "invoicesPage.detail.discountBtn")}
        </button>
        <button
          type="button"
          data-cy="invoice-change-order-btn"
          onClick={() => switchMode("co")}
          disabled={locked}
          title={locked ? tFor(lang, "invoices.lockedPaid") : undefined}
          style={locked ? lockedBtn : secondaryBtn}
        >
          {tFor(lang, "invoicesPage.detail.changeOrderBtn")}
        </button>
        {/* REQ-167: delete, with an inline two-step confirm */}
        {confirmDelete
          ? (
            <span
              data-cy="invoice-delete-ask"
              style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--fg,#144852)"
            >
              {tFor(lang, "invoicesPage.detail.deleteAsk")}
              <button
                type="button"
                data-cy="invoice-delete-confirm"
                onClick={doDelete}
                disabled={busy}
                style={dangerBtn}
              >
                {tFor(lang, "invoicesPage.detail.deleteYes")}
              </button>
              <button
                type="button"
                data-cy="invoice-delete-cancel"
                onClick={() => setConfirmDelete(false)}
                style={secondaryBtn}
              >
                {tFor(lang, "invoicesPage.detail.deleteNo")}
              </button>
            </span>
          )
          : (
            <button
              type="button"
              data-cy="invoice-delete"
              onClick={() => setConfirmDelete(true)}
              disabled={locked}
              title={locked ? tFor(lang, "invoices.lockedPaid") : undefined}
              style={locked ? lockedBtn : secondaryBtn}
            >
              {tFor(lang, "invoicesPage.detail.deleteBtn")}
            </button>
          )}
        {
          /* REQ-018 (NW-27): the contractor can say "payment received" on
            anything the customer still owes — no customer claim required. */
        }
        {(inv.stage === "out" || inv.stage === "overdue" ||
          inv.stage === "claimed") && (
          <button
            type="button"
            data-cy="invoice-payment-received"
            onClick={() => switchMode("pay")}
            style={secondaryBtn}
          >
            {tFor(lang, "invoicesPage.detail.paymentReceivedBtn")}
          </button>
        )}
      </div>

      {mode === "pay" && (
        <div style={formBox} data-cy="invoice-pay-form">
          <PaymentReceivedForm
            invoiceId={inv.id}
            amountCents={inv.amount}
            lang={lang}
            onSaved={async (cents) => {
              await onChanged();
              // REQ-322: confirm before the detail closes.
              onPaymentRecorded(cents);
              onClose();
            }}
            onCancel={() => setMode("none")}
          />
        </div>
      )}

      {mode === "edit" && (
        <div style={formBox} data-cy="invoice-edit-form">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
            {tFor(lang, "invoicesPage.new.jobName")}
            <input
              type="text"
              value={editJobName}
              disabled={busy}
              onInput={(e) =>
                setEditJobName((e.target as HTMLInputElement).value)}
              style={fieldStyle}
            />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
            {tFor(lang, "invoicesPage.new.description")}
            <textarea
              rows={2}
              value={editDesc}
              disabled={busy}
              onInput={(e) =>
                setEditDesc((e.target as HTMLTextAreaElement).value)}
              style={`${fieldStyle};resize:vertical`}
            />
          </label>
          {editItems.length > 0 && (
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
                {tFor(lang, "invoicesPage.detail.lineItemsLabel")}
              </div>
              {editItems.map((li, i) => (
                <div key={i} style="display:flex;gap:6px">
                  <input
                    type="text"
                    data-cy={`invoice-edit-line-desc-${i}`}
                    value={li.description}
                    disabled={busy}
                    onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value;
                      setEditItems((items) =>
                        items.map((it, j) =>
                          j === i ? { ...it, description: v } : it
                        )
                      );
                    }}
                    style={`${fieldStyle};flex:1;min-width:0`}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    data-cy={`invoice-edit-line-qty-${i}`}
                    value={li.quantity}
                    disabled={busy}
                    onInput={(e) => {
                      const v = Number((e.target as HTMLInputElement).value);
                      updateLines(
                        editItems.map((it, j) =>
                          j === i
                            ? { ...it, quantity: Number.isFinite(v) ? v : 0 }
                            : it
                        ),
                      );
                    }}
                    style={`${fieldStyle};width:70px;flex:none`}
                  />
                  <input
                    type="number"
                    step="0.01"
                    data-cy={`invoice-edit-line-price-${i}`}
                    value={li.price}
                    disabled={busy}
                    onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value;
                      updateLines(
                        editItems.map((it, j) =>
                          j === i ? { ...it, price: v } : it
                        ),
                      );
                    }}
                    style={`${fieldStyle};width:110px;flex:none`}
                  />
                </div>
              ))}
            </div>
          )}
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
            {tFor(lang, "invoicesPage.new.amount")}
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={editAmount}
              disabled={busy}
              onInput={(e) =>
                setEditAmount((e.target as HTMLInputElement).value)}
              style={fieldStyle}
            />
          </label>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button
              type="button"
              onClick={() => switchMode("edit")}
              disabled={busy}
              style={ghostBtn}
            >
              {tFor(lang, "common.cancel")}
            </button>
            <button
              type="button"
              data-cy="invoice-edit-save"
              onClick={doSaveEdit}
              disabled={busy}
              style={primaryBtn}
            >
              {tFor(lang, "invoicesPage.detail.saveBtn")}
            </button>
          </div>
        </div>
      )}

      {mode === "discount" && (
        <div style={formBox} data-cy="invoice-discount-form">
          <div style={eyebrowStyle}>
            {tFor(lang, "invoicesPage.adjust.discountLabel")}
          </div>
          <div style="display:flex;gap:6px">
            <input
              ref={focusOnMount}
              type="number"
              min="0"
              step="1"
              placeholder={tFor(
                lang,
                "invoicesPage.adjust.discountPlaceholder",
              )}
              value={discountDollars}
              disabled={busy}
              onInput={(e) =>
                setDiscountDollars((e.target as HTMLInputElement).value)}
              style={`${fieldStyle};flex:1;min-width:0`}
            />
            <button
              type="button"
              onClick={doApplyDiscount}
              disabled={busy}
              style={primaryBtn}
            >
              {tFor(lang, "invoicesPage.adjust.apply")}
            </button>
          </div>
        </div>
      )}

      {mode === "co" && (
        <div style={formBox} data-cy="invoice-co-form">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
            <span>{tFor(lang, "invoicesPage.detail.coDescLabel")}</span>
            <textarea
              rows={2}
              placeholder={tFor(lang, "invoicesPage.adjust.coDescPlaceholder")}
              value={coDesc}
              disabled={busy}
              onInput={(e) =>
                setCoDesc((e.target as HTMLTextAreaElement).value)}
              style={`${fieldStyle};resize:vertical`}
            />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
            <span>{tFor(lang, "invoicesPage.detail.coAmountLabel")}</span>
            <input
              type="number"
              step="1"
              placeholder={tFor(
                lang,
                "invoicesPage.adjust.coAmountPlaceholder",
              )}
              value={coDollars}
              disabled={busy}
              onInput={(e) =>
                setCoDollars((e.target as HTMLInputElement).value)}
              style={fieldStyle}
            />
          </label>
          <div style="display:flex;justify-content:flex-end">
            <button
              type="button"
              onClick={doCreateCo}
              disabled={busy}
              style={primaryBtn}
            >
              {tFor(lang, "invoicesPage.adjust.createLink")}
            </button>
          </div>
        </div>
      )}

      {err && (
        <div
          role="alert"
          style="margin-top:10px;color:#a83b3b;font-size:12.5px"
        >
          {err}
        </div>
      )}

      {coLink && (
        <div style="margin-top:12px;font-size:12.5px;color:var(--fg,#1c2c30)">
          {tFor(lang, "invoicesPage.adjust.approvalLink")}{" "}
          <a
            data-cy="change-order-approval-link"
            href={coLink}
            target="_blank"
            rel="noopener noreferrer"
            style="color:var(--brand-teal,#144852);word-break:break-all"
          >
            {coLink}
          </a>
          <div style="color:var(--fg-muted,#6b7560);margin-top:2px">
            {tFor(lang, "invoicesPage.adjust.approvalHelp")}
          </div>
        </div>
      )}

      {changeOrders && changeOrders.length > 0 && (
        <div style="margin-top:14px" data-cy="invoice-detail-change-orders">
          <div style={eyebrowStyle}>
            {tFor(lang, "invoicesPage.adjust.coListLabel")}
          </div>
          <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
            {changeOrders.map((co) => (
              <div
                key={co.id}
                style="display:flex;align-items:center;gap:8px;font-size:13px"
              >
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  {co.description}
                </span>
                <span style="font-weight:700;white-space:nowrap">
                  {co.deltaAmountCents >= 0 ? "+" : "−"}
                  {fmtMoneyExact(Math.abs(co.deltaAmountCents))}
                </span>
                <span
                  style={`font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid currentColor;color:${
                    CO_CHIP_COLOR[co.status]
                  }`}
                >
                  {tFor(lang, `invoicesPage.adjust.coStatus.${co.status}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {discountCents > 0 && (
        <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:var(--brand-green,#519843)">
          <span>{tFor(lang, "invoicesPage.detail.discountApplied")}</span>
          <span>−{fmtMoneyExact(discountCents)}</span>
        </div>
      )}

      {
        /* Live total — always the invoice's current `amount`; pending or
          declined change orders never move it. */
      }
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,#d8dcd5);display:flex;justify-content:space-between;align-items:center">
        <span style={eyebrowStyle}>
          {tFor(lang, "invoicesPage.detail.total")}
        </span>
        <span
          data-cy="invoice-detail-total"
          style="font-weight:900;font-size:22px;color:var(--fg,#144852);font-variant-numeric:tabular-nums"
        >
          {fmtMoneyExact(inv.amount)}
        </span>
      </div>
      {/* REQ-202: partial payments count down; an overpayment is flagged */}
      <div style="display:flex;justify-content:flex-end">
        <PaymentState inv={inv} lang={lang} />
      </div>
    </section>
  );
}

/** One channel's honest send result: the interpreted outcome plus the raw
 *  backend reason string (for the "email failed — {reason}" copy). */
interface ChannelSendResult {
  outcome: SendOutcome;
  rawReason?: string;
}

/** Everything a caller needs to report a dispatch honestly (P-09):
 *  `delivered` is true when AT LEAST one channel actually delivered. */
interface DispatchResult {
  delivered: boolean;
  /** REQ-030 (NW-25): one channel went, the other did not. */
  partial: boolean;
  failedChannels: DispatchChannel[];
  email: ChannelSendResult;
  text: ChannelSendResult;
}

/** Interpret one settled send Response through the shared honest-result
 *  contract — an HTTP 200 + {ok:false} body is a FAILURE. */
async function interpretSettledSend(
  r: PromiseSettledResult<Response>,
): Promise<ChannelSendResult> {
  if (r.status === "rejected") {
    return { outcome: { delivered: false, reason: "http" } };
  }
  let body: unknown = null;
  try {
    body = await r.value.json();
  } catch { /* empty / non-JSON body — interpret on httpOk alone */ }
  const reason = body && typeof body === "object" &&
      typeof (body as { reason?: unknown }).reason === "string"
    ? (body as { reason: string }).reason
    : undefined;
  return {
    outcome: interpretSendResult({ httpOk: r.value.ok, body }),
    ...(reason ? { rawReason: reason } : {}),
  };
}

/** Dispatch an invoice to the customer over both channels and interpret the
 *  BODIES, never just Response.ok (P-09: the endpoints report logical failure
 *  as HTTP 200 + {ok:false, reason}). Single source for the card "Send now"/
 *  "Finish + send" actions and the New Invoice "Create & send" so the channel
 *  set + request shape can't drift across the three call sites. */
async function dispatchInvoice(id: string): Promise<DispatchResult> {
  const settled = await Promise.allSettled([
    fetch(`/api/invoices/${id}/email`, {
      method: "POST",
      credentials: "include",
    }),
    fetch(`/api/invoices/${id}/text`, {
      method: "POST",
      credentials: "include",
    }),
  ]);
  const [email, text] = await Promise.all(settled.map(interpretSettledSend));
  return {
    ...summarizeDispatch({ email: email.outcome, text: text.outcome }),
    email,
    text,
  };
}

/** REQ-030 (NW-25): honest copy for a HALF-delivered send — which channel
 *  went, which did not, and why (the backend's translated reason). */
function partialDispatchCopy(lang: Lang, d: DispatchResult): string {
  const textFailed = d.failedChannels.includes("text");
  const failed = textFailed ? d.text : d.email;
  return tFor(
    lang,
    textFailed
      ? "invoicesPage.send.partialTextFailed"
      : "invoicesPage.send.partialEmailFailed",
    { reason: failed.rawReason ?? failed.outcome.reason ?? "unknown" },
  );
}

/** Honest failure copy when NO channel delivered. REQ-480 (demo cycle 3,
 *  M18): the invoice's own sentence — "INV-002 not delivered — no email on
 *  file; the text failed: …" — never the quote divider's "Quote + Agreement
 *  drafted" wording, and (REQ-030) neither channel's reason is dropped.
 *  `keptDraft`: the invoice stays a draft (the send endpoints stamp "sent"
 *  only on delivery), and the copy says so. */
function dispatchFailureCopy(
  lang: Lang,
  d: DispatchResult,
  opts: { number?: string; keptDraft?: boolean } = {},
): string {
  return invoiceNotDeliveredCopy((key, params) => tFor(lang, key, params), {
    number: opts.number,
    email: d.email,
    text: d.text,
    keptDraft: opts.keptDraft,
  });
}

/** Honest failure copy for the single-channel "Text client" action. */
function textFailureCopy(lang: Lang, r: ChannelSendResult): string {
  if (r.outcome.reason === "noPhone" || r.outcome.reason === "noEmail") {
    return tFor(lang, "invoicesPage.new.needContact");
  }
  return tFor(lang, "sendQuote.divider.emailFailed", {
    reason: r.rawReason ?? r.outcome.reason ?? "unknown",
  });
}

/** Map a discount rejection to its copy — the 409 unconfirmed-payment-claim
 *  guard (P-41) gets its specific warning, everything else the generic one. */
async function discountErrorCopy(r: Response, lang: Lang): Promise<string> {
  let body: unknown = null;
  try {
    body = await r.json();
  } catch { /* non-JSON error body */ }
  const reason = body && typeof body === "object"
    ? (body as { reason?: unknown }).reason
    : undefined;
  return r.status === 409 && reason === "unconfirmed-payment-claim"
    ? tFor(lang, "invoicesPage.adjust.errClaimPending")
    : tFor(lang, "invoicesPage.adjust.errDiscountApply");
}

/** REQ-174: today + n days, as yyyy-mm-dd (UTC) */
function plusDays(n: number): string {
  const d = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function InvoiceCard(
  { inv, idx, now, lang }: {
    inv: EnrichedInvoice;
    idx: number;
    now: Date;
    lang: Lang;
  },
) {
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  // P-09: honest send state — set when a dispatch delivered on NO channel,
  // rendered on the card instead of the old silent reload-as-success.
  const [sendFail, setSendFail] = useState<string | null>(null);
  /** REQ-030: one channel delivered, the other did not. */
  const [sendPartial, setSendPartial] = useState<string | null>(null);
  // REQ-021: inline confirmation after a nudge (no reload — nothing on the
  // card changes except that the reminder went out).
  const [sendNote, setSendNote] = useState<string | null>(null);
  // REQ-250 (demo m12): a nudge on a CLAIMED invoice — the customer said they
  // paid — asks first, inline, naming the claim.
  const [nudgeAsk, setNudgeAsk] = useState(false);
  // REQ-488 (demo m56): "Didn't get it" asks first, inline.
  const [rejectAsk, setRejectAsk] = useState(false);
  // REQ-022 (NW-31c): inline "Change date" editor on an Upcoming card.
  const [dateEdit, setDateEdit] = useState<string | null>(null);
  async function doSaveScheduledFor(e: Event) {
    e.stopPropagation();
    if (busy || !dateEdit) return;
    setBusy(true);
    setSendFail(null);
    try {
      const r = await fetch(`/api/invoices/${inv.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduledFor: dateEdit }),
      });
      if (r.ok) globalThis.location.reload();
      else setSendFail(tFor(lang, "invoicesPage.back.changeDateFailed"));
    } finally {
      setBusy(false);
    }
  }
  // Roadmap p.12: in-card discount + change-order controls.
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [discountDollars, setDiscountDollars] = useState("");
  // REQ-167: delete from the card, asked inline first
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function doDeleteInvoice() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/invoices/${inv.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) globalThis.location.reload();
      else setSendFail(tFor(lang, "invoicesPage.detail.errDelete"));
    } finally {
      setBusy(false);
    }
  }
  const [coDesc, setCoDesc] = useState("");
  const [coDollars, setCoDollars] = useState("");
  const [coLink, setCoLink] = useState<string | null>(null);
  const [adjErr, setAdjErr] = useState<string | null>(null);
  // Existing change orders for this invoice — loaded when the panel opens
  // so pending approval links stay recoverable (audit: "unrecoverable links").
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRow[] | null>(
    null,
  );
  const [copiedCoId, setCopiedCoId] = useState<string | null>(null);
  // Inline change-order editing. Editing re-opens approval: the server resets
  // the order to pending, reverts any already-applied amount, and re-alerts
  // the contractor with the fresh link to share.
  const [editingCoId, setEditingCoId] = useState<string | null>(null);
  const [editCoDesc, setEditCoDesc] = useState("");
  const [editCoDollars, setEditCoDollars] = useState("");
  const [coReapprovedId, setCoReapprovedId] = useState<string | null>(null);
  const [confirmDelCoId, setConfirmDelCoId] = useState<string | null>(null);
  const mood = STAGE_MOOD[inv.stage];
  const moodLabel = tFor(lang, mood.labelKey);
  const cta = inv.stage === "claimed"
    ? tFor(lang, "invoicesPage.cta.claimed")
    : inv.stage === "overdue"
    ? tFor(lang, "invoicesPage.cta.overdue")
    : inv.stage === "scheduled"
    ? tFor(lang, "invoicesPage.cta.scheduled")
    : inv.stage === "out"
    // REQ-018 (NW-27): the receipt is the out-for-payment card's next step;
    // "View invoice" stays on the card back ("Open").
    ? tFor(lang, "invoicesPage.cta.outReceived")
    : inv.stage === "drafting"
    ? tFor(lang, "invoicesPage.cta.drafting")
    : tFor(lang, "invoicesPage.cta.paid");
  const subline = inv.stage === "claimed"
    ? `${
      tFor(lang, "invoicesPage.subline.claimed", {
        method: methodLabel(inv.paymentIntent?.method, lang),
      })
    }${
      inv.paymentIntent?.reference
        ? tFor(lang, "invoicesPage.subline.ref", {
          ref: inv.paymentIntent.reference,
        })
        : ""
    }`
    : inv.stage === "overdue"
    ? tFor(lang, "invoicesPage.subline.overdue", {
      n: inv.daysOverdue,
      date: fmtDate(inv.dueDate, now, lang),
    })
    : inv.stage === "scheduled"
    ? scheduledSubline(inv.scheduledFor, now, lang)
    : inv.stage === "out"
    ? tFor(lang, "invoicesPage.subline.out", {
      n: inv.daysIn,
      date: fmtDate(inv.dueDate, now, lang),
    })
    : inv.stage === "drafting"
    ? tFor(lang, "invoicesPage.subline.drafting", {
      date: fmtDate(inv.issuedDate ?? inv.createdAt, now, lang),
    })
    : tFor(lang, "invoicesPage.subline.paid", {
      date: fmtDate(inv.paidAt, now, lang),
    });

  async function doConfirmReceived(e: Event) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/invoices/${inv.id}/confirm-payment`, {
        method: "POST",
        credentials: "include",
      });
      if (r.ok) globalThis.location.reload();
    } finally {
      setBusy(false);
    }
  }
  // "Didn't get it" — reopen a claim the customer reported but you never
  // actually received. Reverts the invoice to sent so they can re-pay.
  async function doRejectClaim(e: Event) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/invoices/${inv.id}/reject-claim`, {
        method: "POST",
        credentials: "include",
      });
      if (r.ok) globalThis.location.reload();
    } finally {
      setBusy(false);
    }
  }
  function doOpenInvoice(e: Event) {
    e.stopPropagation();
    // Public invoice page is the canonical detail surface today — opens
    // in a new tab so the dashboard stays put.
    globalThis.open(`/i/${inv.id}`, "_blank", "noopener,noreferrer");
  }
  async function doSendText(e: Event) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setSendFail(null);
    try {
      const settled = await Promise.allSettled([
        fetch(`/api/invoices/${inv.id}/text`, {
          method: "POST",
          credentials: "include",
        }),
      ]);
      // P-09: interpret the BODY — a 200 {ok:false} is a failure, not a send.
      const result = await interpretSettledSend(settled[0]);
      if (result.outcome.delivered) globalThis.location.reload();
      else setSendFail(textFailureCopy(lang, result));
    } finally {
      setBusy(false);
    }
  }
  async function doSendNow(e: Event) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setSendFail(null);
    try {
      // Fire both channels and interpret honestly (P-09): only reload-as-
      // success when at least one channel actually delivered; otherwise the
      // failure is surfaced on the card and nothing pretends it was sent.
      const d = await dispatchInvoice(inv.id);
      // REQ-030 (NW-25): reload only when NOTHING failed; a half-delivered
      // send says which channel went and which did not.
      if (d.delivered && !d.partial) globalThis.location.reload();
      else if (d.delivered) setSendPartial(partialDispatchCopy(lang, d));
      else {
        setSendFail(dispatchFailureCopy(lang, d, { number: inv.invoiceRef }));
      }
    } finally {
      setBusy(false);
    }
  }
  // "Finish + send" on a draft: a fully deterministic dashboard action — no
  // assistant round-trip. Stamp issuedDate / dueDate if missing, then
  // dispatch to the customer over both channels. REQ-480 (demo cycle 3, M18):
  // the status is NOT flipped up front — the send endpoints stamp the
  // invoice "sent" once a channel delivers, so an invoice nobody received
  // stays a draft instead of reading "Sent".
  async function doFinishDraft(e: Event) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setSendFail(null);
    try {
      const dates = {
        ...(inv.issuedDate
          ? {}
          : { issuedDate: new Date().toISOString().slice(0, 10) }),
        // REQ-174: due = today + the invoice's days to pay, when it has them
        ...(typeof inv.netDays === "number"
          ? { dueDate: plusDays(inv.netDays) }
          : {}),
      };
      if (Object.keys(dates).length > 0) {
        await fetch(`/api/invoices/${inv.id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(dates),
        });
      }
      // Deliver over both channels; a delivery failure is SURFACED (P-09) —
      // the contractor must never walk away believing an undeliverable
      // invoice reached anyone.
      const d = await dispatchInvoice(inv.id);
      // REQ-030 (NW-25): reload only when NOTHING failed; a half-delivered
      // send says which channel went and which did not.
      if (d.delivered && !d.partial) globalThis.location.reload();
      else if (d.delivered) setSendPartial(partialDispatchCopy(lang, d));
      else {
        setSendFail(
          dispatchFailureCopy(lang, d, {
            number: inv.invoiceRef,
            keptDraft: true,
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  }
  /** REQ-018 (NW-27): open this invoice's detail panel in "Payment received"
   *  mode via the deep link the panel already honours. */
  function doPaymentReceived(e: Event) {
    e.stopPropagation();
    globalThis.location.assign(`/invoices?open=${inv.id}&pay=1`);
  }
  /** REQ-021 (NW-31a): a nudge is the reminder CADENCE (day 3 / 7 / 14 / 30
   *  by how overdue the invoice is), never the full invoice re-texted. */
  async function doSendNudge(e: Event) {
    e.stopPropagation();
    if (busy) return;
    const d = inv.daysOverdue;
    const day = d <= 3 ? 3 : d <= 7 ? 7 : d <= 14 ? 14 : 30;
    setBusy(true);
    setSendFail(null);
    setSendNote(null);
    try {
      const res = await fetch("/api/cron/invoice-reminder", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId: inv.id, day }),
      });
      const body = res.ok
        ? (await res.json().catch(() => ({}))) as { channels?: string[] }
        : null;
      if (body && Array.isArray(body.channels) && body.channels.length > 0) {
        setSendNote(tFor(lang, "invoicesPage.nudge.sent"));
      } else if (body) {
        // 200 with no channel = the cadence already fired this rung today,
        // or reminders are muted for this invoice.
        setSendNote(tFor(lang, "invoicesPage.nudge.alreadySent"));
      } else {
        setSendFail(tFor(lang, "invoicesPage.nudge.failed"));
      }
    } catch {
      setSendFail(tFor(lang, "invoicesPage.nudge.failed"));
    } finally {
      setBusy(false);
    }
  }
  function ctaAction(e: Event) {
    if (inv.stage === "claimed") return doConfirmReceived(e);
    if (inv.stage === "out") return doPaymentReceived(e);
    if (inv.stage === "overdue") return doSendNudge(e);
    if (inv.stage === "scheduled") return doSendNow(e);
    if (inv.stage === "drafting") return doFinishDraft(e);
    return doOpenInvoice(e);
  }
  async function doToggleMute(e: Event) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/invoices/${inv.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ remindersMuted: !inv.remindersMuted }),
      });
      globalThis.location.reload();
    } finally {
      setBusy(false);
    }
  }
  async function doApplyDiscount(e: Event) {
    e.stopPropagation();
    if (busy) return;
    const cents = Math.round(Number(discountDollars) * 100);
    if (!cents || cents <= 0) {
      setAdjErr(tFor(lang, "invoicesPage.adjust.errDiscountAmount"));
      return;
    }
    setBusy(true);
    setAdjErr(null);
    try {
      const r = await postDiscount(inv.id, cents);
      if (r.ok) globalThis.location.reload();
      // P-41: the pending-claim 409 gets its explicit warning copy.
      else setAdjErr(await discountErrorCopy(r, lang));
    } finally {
      setBusy(false);
    }
  }
  async function loadChangeOrders() {
    // Best-effort — the panel still works without the list.
    const rows = await fetchChangeOrders(inv.id);
    if (rows) setChangeOrders(rows);
  }
  useEffect(() => {
    if (adjustOpen && changeOrders === null) loadChangeOrders();
  }, [adjustOpen]);
  async function doCopyCoLink(id: string) {
    try {
      await navigator.clipboard.writeText(
        `${globalThis.location.origin}/co/${id}`,
      );
      setCopiedCoId(id);
      setTimeout(() => setCopiedCoId((cur) => (cur === id ? null : cur)), 1500);
    } catch { /* clipboard denied — nothing to surface */ }
  }
  async function doCreateChangeOrder(e: Event) {
    e.stopPropagation();
    if (busy) return;
    const cents = Math.round(Number(coDollars) * 100);
    if (!coDesc.trim() || !cents) {
      setAdjErr(tFor(lang, "invoicesPage.adjust.errCoFields"));
      return;
    }
    setBusy(true);
    setAdjErr(null);
    try {
      const coId = await postChangeOrder(inv.id, coDesc.trim(), cents);
      if (!coId) {
        setAdjErr(tFor(lang, "invoicesPage.adjust.errCoCreate"));
        return;
      }
      setCoLink(`${globalThis.location.origin}/co/${coId}`);
      // Refresh the list so the new pending order shows up immediately.
      loadChangeOrders();
    } finally {
      setBusy(false);
    }
  }
  function startEditCo(co: ChangeOrderRow) {
    setEditingCoId(co.id);
    setEditCoDesc(co.description);
    // Credits are negative — surface the signed dollar value so the contractor
    // can edit it directly.
    setEditCoDollars(String(co.deltaAmountCents / 100));
    setCoReapprovedId(null);
    setAdjErr(null);
  }
  function cancelEditCo() {
    setEditingCoId(null);
    setAdjErr(null);
  }
  async function doSaveChangeOrder(coId: string) {
    if (busy) return;
    const cents = Math.round(Number(editCoDollars) * 100);
    if (!editCoDesc.trim() || !cents) {
      setAdjErr(tFor(lang, "invoicesPage.adjust.errCoFields"));
      return;
    }
    setBusy(true);
    setAdjErr(null);
    try {
      const r = await fetch(`/api/invoices/${inv.id}/change-orders/${coId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: editCoDesc.trim(),
          deltaAmountCents: cents,
        }),
      });
      if (!r.ok) {
        setAdjErr(tFor(lang, "invoicesPage.adjust.errCoEdit"));
        return;
      }
      setEditingCoId(null);
      // Editing re-opens approval — flag the row so the contractor sees it's
      // back to pending and a fresh link was sent to them.
      setCoReapprovedId(coId);
      setTimeout(
        () => setCoReapprovedId((cur) => (cur === coId ? null : cur)),
        5000,
      );
      loadChangeOrders();
    } finally {
      setBusy(false);
    }
  }
  async function doDeleteChangeOrder(coId: string) {
    if (busy) return;
    setBusy(true);
    setAdjErr(null);
    try {
      const r = await fetch(`/api/invoices/${inv.id}/change-orders/${coId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        setAdjErr(tFor(lang, "invoicesPage.adjust.errCoDelete"));
        return;
      }
      setConfirmDelCoId(null);
      loadChangeOrders();
    } finally {
      setBusy(false);
    }
  }
  // Coral alert content per stage — rendered ONLY when there is something to
  // say (P-31: never an empty coral bar). The claimed stage gets the claim
  // context so the "confirm or reject" decision is self-explanatory.
  const readText = inv.stage === "overdue"
    ? tFor(
      lang,
      inv.daysOverdue === 1
        ? "invoicesPage.read.overdue.one"
        : "invoicesPage.read.overdue.other",
      { n: inv.daysOverdue },
    )
    : inv.stage === "out"
    ? tFor(lang, "invoicesPage.read.out", {
      issued: fmtDate(inv.issuedDate ?? inv.createdAt, now, lang),
      due: fmtDate(inv.dueDate, now, lang),
    })
    : inv.stage === "drafting"
    ? tFor(lang, "invoicesPage.read.drafting", {
      date: fmtDate(inv.issuedDate ?? inv.createdAt, now, lang),
    })
    : inv.stage === "paid"
    ? tFor(lang, "invoicesPage.read.paid", {
      date: fmtDate(inv.paidAt, now, lang),
    })
    : inv.stage === "claimed"
    ? tFor(lang, "invoicesPage.read.claimed", {
      name: inv.paymentIntent?.claimedBy?.trim() || inv.client,
      method: methodLabel(inv.paymentIntent?.method, lang),
    })
    : null;
  return (
    <article
      class={`qcard qcard--inv ${flipped ? "qcard--flipped" : ""}`}
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
      </div>
      <div class="qcard__av">{inv.initials}</div>
      <div class="qcard__body">
        <div class="qcard__client-name">{inv.client} · {inv.invoiceRef}</div>
        {/* REQ-201: number · version · state, and the unpublished badge */}
        <div
          data-cy="invoice-card-headline"
          style="margin-top:2px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11.5px;font-weight:700;color:var(--fg-muted,#6b7560)"
        >
          <span>{headlineOf(inv, lang)}</span>
          {hasPendingRevision(inv) && <UnpublishedBadge lang={lang} />}
        </div>
        {/* NW-30 (REQ-011): the job name tells invoices apart. */}
        {inv.jobName
          ? (
            <div class="qcard__job" data-cy="invoice-card-job">
              {inv.jobName}
            </div>
          )
          : null}
        <h3 class="qcard__title">{fmtMoney(inv.amount)}</h3>
        <PaymentState inv={inv} lang={lang} />
        <p class="qcard__story">{subline}</p>
      </div>
      <div class="qcard__foot">
        <button
          type="button"
          class="qcard__cta"
          data-cy={`invoice-cta-${inv.stage}`}
          onClick={ctaAction}
          disabled={busy}
        >
          {busy ? "…" : cta}{" "}
          <span style="display:inline-block;transition:transform 240ms">→</span>
        </button>
        <div class="qcard__val-wrap">
          <div class="qcard__val-lbl">
            {tFor(
              lang,
              inv.stage === "paid"
                ? "invoicesPage.valLbl.cleared"
                : "invoicesPage.valLbl.due",
            )}
          </div>
          <div class="qcard__val-num" style="font-size:13px">
            {inv.stage === "paid"
              ? fmtDate(inv.paidAt, now, lang)
              : fmtDate(inv.dueDate, now, lang)}
          </div>
        </div>
      </div>
      {sendFail && (
        <p class="qcard__sendfail" role="alert" data-cy="invoice-send-failure">
          {sendFail}
        </p>
      )}
      {sendPartial && (
        <p class="qcard__sendfail" role="alert" data-cy="send-partial">
          {sendPartial}
        </p>
      )}
      {sendNote && (
        <p
          class="qcard__sendfail"
          role="status"
          data-cy="invoice-send-note"
          style="color:var(--brand-green,#519843)"
        >
          {sendNote}
        </p>
      )}

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
            {tFor(lang, "invoicesPage.back.eyebrow")}
          </div>
          <p class="qcard__back-big">
            {fmtMoney(inv.amount)}
            <small>· {moodLabel}</small>
          </p>
        </div>
        <div class="qcard__back-body">
          {readText && <p class="qcard__read">{readText}</p>}
          {/* REQ-167: every card can delete its invoice — asks first */}
          <div
            style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"
            onClick={(e) => e.stopPropagation()}
          >
            {confirmDelete
              ? (
                <>
                  <span style="font-size:12.5px;color:var(--fg)">
                    {tFor(lang, "invoicesPage.detail.deleteAsk")}
                  </span>
                  <button
                    type="button"
                    data-cy="invoice-card-delete-confirm"
                    onClick={doDeleteInvoice}
                    disabled={busy}
                    style="appearance:none;background:#fff;border:1px solid var(--brand-pink,#ff6b6b);border-radius:7px;padding:4px 10px;font:inherit;font-size:12.5px;font-weight:700;color:var(--brand-pink-dark,#d94f4f);cursor:pointer"
                  >
                    {tFor(lang, "invoicesPage.detail.deleteYes")}
                  </button>
                  <button
                    type="button"
                    data-cy="invoice-card-delete-cancel"
                    onClick={() => setConfirmDelete(false)}
                    style="appearance:none;background:none;border:none;color:var(--brand-teal);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;padding:2px 0"
                  >
                    {tFor(lang, "invoicesPage.detail.deleteNo")}
                  </button>
                </>
              )
              : (
                <button
                  type="button"
                  data-cy="invoice-card-delete"
                  onClick={() => setConfirmDelete(true)}
                  /* REQ-202: a paid invoice is locked — nothing on it changes */
                  disabled={isInvoiceLocked(inv)}
                  title={isInvoiceLocked(inv)
                    ? tFor(lang, "invoices.lockedPaid")
                    : undefined}
                  style={`appearance:none;background:none;border:none;color:var(--brand-pink-dark,#d94f4f);font:inherit;font-size:12.5px;font-weight:700;padding:2px 0;${
                    isInvoiceLocked(inv)
                      ? "cursor:not-allowed;opacity:.5"
                      : "cursor:pointer"
                  }`}
                >
                  {tFor(lang, "invoicesPage.detail.deleteBtn")}
                </button>
              )}
            {isInvoiceLocked(inv) && (
              <span
                data-cy="invoice-card-locked"
                style="font-size:11.5px;color:var(--fg-muted,#6b7560)"
              >
                {tFor(lang, "invoices.lockedPaid")}
              </span>
            )}
          </div>
          {inv.stage !== "paid" && (
            <div
              style="margin-top:6px"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setAdjustOpen((o) => !o)}
                style="appearance:none;background:none;border:none;color:var(--brand-teal);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;padding:2px 0"
              >
                {adjustOpen ? tFor(lang, "invoicesPage.adjust.hide") : (
                  <>
                    {tFor(lang, "invoicesPage.adjust.open")}{" "}
                    <Icon
                      name="chevron-down"
                      size={13}
                      style="vertical-align:-2px"
                    />
                  </>
                )}
              </button>
              {adjustOpen && (
                <div style="margin-top:8px;display:flex;flex-direction:column;gap:12px;background:rgba(0,0,0,0.03);border-radius:10px;padding:10px 12px">
                  <div>
                    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted);margin-bottom:4px">
                      {tFor(lang, "invoicesPage.adjust.discountLabel")}
                    </div>
                    <div style="display:flex;gap:6px">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder={tFor(
                          lang,
                          "invoicesPage.adjust.discountPlaceholder",
                        )}
                        value={discountDollars}
                        onInput={(e) =>
                          setDiscountDollars(
                            (e.target as HTMLInputElement).value,
                          )}
                        style="flex:1;min-width:0;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font:inherit;font-size:13px"
                      />
                      <button
                        type="button"
                        onClick={doApplyDiscount}
                        disabled={busy}
                        style="padding:7px 12px;border:0;border-radius:7px;background:var(--brand-green);color:#fff;font:inherit;font-weight:700;cursor:pointer"
                      >
                        {tFor(lang, "invoicesPage.adjust.apply")}
                      </button>
                    </div>
                  </div>
                  <div>
                    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted);margin-bottom:4px">
                      {tFor(lang, "invoicesPage.adjust.coLabel")}
                    </div>
                    <input
                      type="text"
                      placeholder={tFor(
                        lang,
                        "invoicesPage.adjust.coDescPlaceholder",
                      )}
                      value={coDesc}
                      onInput={(e) =>
                        setCoDesc((e.target as HTMLInputElement).value)}
                      style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font:inherit;font-size:13px;margin-bottom:6px"
                    />
                    <div style="display:flex;gap:6px">
                      <input
                        type="number"
                        step="1"
                        placeholder={tFor(
                          lang,
                          "invoicesPage.adjust.coAmountPlaceholder",
                        )}
                        value={coDollars}
                        onInput={(e) =>
                          setCoDollars((e.target as HTMLInputElement).value)}
                        style="flex:1;min-width:0;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font:inherit;font-size:13px"
                      />
                      <button
                        type="button"
                        onClick={doCreateChangeOrder}
                        disabled={busy}
                        style="padding:7px 12px;border:0;border-radius:7px;background:var(--brand-teal);color:#fff;font:inherit;font-weight:700;cursor:pointer"
                      >
                        {tFor(lang, "invoicesPage.adjust.createLink")}
                      </button>
                    </div>
                  </div>
                  {coLink && (
                    <div style="font-size:12px;color:var(--fg)">
                      {tFor(lang, "invoicesPage.adjust.approvalLink")}{" "}
                      <a
                        href={coLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style="color:var(--brand-teal);word-break:break-all"
                      >
                        {coLink}
                      </a>
                      <div style="color:var(--fg-muted);margin-top:2px">
                        {tFor(lang, "invoicesPage.adjust.approvalHelp")}
                      </div>
                    </div>
                  )}
                  {changeOrders && changeOrders.length > 0 && (
                    <div>
                      <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted);margin-bottom:4px">
                        {tFor(lang, "invoicesPage.adjust.coListLabel")}
                      </div>
                      <div style="display:flex;flex-direction:column;gap:6px">
                        {changeOrders.map((co) =>
                          editingCoId === co.id
                            ? (
                              <div
                                key={co.id}
                                style="display:flex;flex-direction:column;gap:6px;background:rgba(20,72,82,0.05);border-radius:8px;padding:8px"
                              >
                                <input
                                  type="text"
                                  value={editCoDesc}
                                  onInput={(e) =>
                                    setEditCoDesc(
                                      (e.target as HTMLInputElement).value,
                                    )}
                                  style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font:inherit;font-size:13px"
                                />
                                <div style="display:flex;gap:6px">
                                  <input
                                    type="number"
                                    step="1"
                                    value={editCoDollars}
                                    onInput={(e) =>
                                      setEditCoDollars(
                                        (e.target as HTMLInputElement).value,
                                      )}
                                    style="flex:1;min-width:0;padding:7px 9px;border:1px solid var(--border);border-radius:7px;font:inherit;font-size:13px"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => doSaveChangeOrder(co.id)}
                                    disabled={busy}
                                    style="padding:7px 12px;border:0;border-radius:7px;background:var(--brand-teal);color:#fff;font:inherit;font-weight:700;cursor:pointer;white-space:nowrap"
                                  >
                                    {tFor(lang, "invoicesPage.adjust.coSave")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditCo}
                                    disabled={busy}
                                    style="appearance:none;background:none;border:1px solid var(--border);border-radius:7px;padding:7px 10px;font:inherit;font-size:12px;font-weight:700;color:var(--fg-muted);cursor:pointer"
                                  >
                                    {tFor(lang, "common.cancel")}
                                  </button>
                                </div>
                              </div>
                            )
                            : (
                              <div
                                key={co.id}
                                style="display:flex;flex-direction:column;gap:3px"
                              >
                                <div style="display:flex;align-items:center;gap:8px;font-size:12.5px">
                                  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                                    {co.description}
                                  </span>
                                  <span style="font-weight:700;white-space:nowrap">
                                    {co.deltaAmountCents >= 0 ? "+" : "−"}
                                    {fmtMoneyExact(
                                      Math.abs(co.deltaAmountCents),
                                    )}
                                  </span>
                                  <span
                                    style={`font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid currentColor;color:${
                                      CO_CHIP_COLOR[co.status]
                                    }`}
                                  >
                                    {tFor(
                                      lang,
                                      `invoicesPage.adjust.coStatus.${co.status}`,
                                    )}
                                  </span>
                                  {confirmDelCoId === co.id
                                    ? (
                                      <>
                                        <span style="font-size:11.5px;color:#a83b3b;font-weight:700;white-space:nowrap">
                                          {tFor(
                                            lang,
                                            "invoicesPage.adjust.coConfirmDel",
                                          )}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            doDeleteChangeOrder(co.id)}
                                          disabled={busy}
                                          style="appearance:none;background:#a83b3b;border:0;border-radius:7px;padding:3px 8px;font:inherit;font-size:11.5px;font-weight:700;color:#fff;cursor:pointer;white-space:nowrap"
                                        >
                                          {tFor(
                                            lang,
                                            "invoicesPage.adjust.coDelete",
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setConfirmDelCoId(null)}
                                          disabled={busy}
                                          style="appearance:none;background:none;border:1px solid var(--border);border-radius:7px;padding:3px 8px;font:inherit;font-size:11.5px;font-weight:700;color:var(--fg-muted);cursor:pointer"
                                        >
                                          {tFor(lang, "common.cancel")}
                                        </button>
                                      </>
                                    )
                                    : (
                                      <>
                                        {
                                          /* P-41: a customer-APPROVED change
                                            order is immutable — no Edit, no
                                            Delete (server 409s them too). */
                                        }
                                        {isChangeOrderMutable(co) && (
                                          <button
                                            type="button"
                                            onClick={() => startEditCo(co)}
                                            disabled={busy}
                                            style="appearance:none;background:none;border:1px solid var(--border);border-radius:7px;padding:3px 8px;font:inherit;font-size:11.5px;font-weight:700;color:var(--brand-teal);cursor:pointer;white-space:nowrap"
                                          >
                                            {tFor(
                                              lang,
                                              "invoicesPage.adjust.coEdit",
                                            )}
                                          </button>
                                        )}
                                        {co.status === "pending" && (
                                          <button
                                            type="button"
                                            onClick={() => doCopyCoLink(co.id)}
                                            style="appearance:none;background:none;border:1px solid var(--border);border-radius:7px;padding:3px 8px;font:inherit;font-size:11.5px;font-weight:700;color:var(--brand-teal);cursor:pointer;white-space:nowrap"
                                          >
                                            {copiedCoId === co.id
                                              ? tFor(
                                                lang,
                                                "invoicesPage.adjust.coCopied",
                                              )
                                              : tFor(
                                                lang,
                                                "invoicesPage.adjust.coCopyLink",
                                              )}
                                          </button>
                                        )}
                                        {isChangeOrderMutable(co) && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setConfirmDelCoId(co.id)}
                                            disabled={busy}
                                            style="appearance:none;background:none;border:1px solid var(--border);border-radius:7px;padding:3px 8px;font:inherit;font-size:11.5px;font-weight:700;color:#a83b3b;cursor:pointer;white-space:nowrap"
                                          >
                                            {tFor(
                                              lang,
                                              "invoicesPage.adjust.coDelete",
                                            )}
                                          </button>
                                        )}
                                      </>
                                    )}
                                </div>
                                {coReapprovedId === co.id && (
                                  <div style="font-size:11.5px;color:var(--brand-green);font-weight:600">
                                    {tFor(
                                      lang,
                                      "invoicesPage.adjust.coReapproved",
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                        )}
                      </div>
                    </div>
                  )}
                  {adjErr && (
                    <div style="color:#a83b3b;font-size:12px">{adjErr}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {dateEdit !== null && (
          <div
            data-cy="invoice-change-date-form"
            style="display:flex;gap:8px;align-items:center;padding:0 0 10px"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="date"
              data-cy="invoice-change-date-input"
              value={dateEdit}
              disabled={busy}
              onInput={(e) => setDateEdit((e.target as HTMLInputElement).value)}
              style="padding:7px 9px;border:1px solid var(--border,#d8dcd5);border-radius:8px;font:inherit;font-size:13px"
            />
            <button
              type="button"
              data-cy="invoice-change-date-save"
              onClick={doSaveScheduledFor}
              disabled={busy || !dateEdit}
            >
              {tFor(lang, "invoicesPage.back.changeDateSave")}
            </button>
          </div>
        )}
        {inv.stage === "claimed" && nudgeAsk && (
          <div
            data-cy="invoice-nudge-ask"
            role="alert"
            style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:0 0 10px;font-size:13px"
            onClick={(e) => e.stopPropagation()}
          >
            <span style="flex:1 1 100%">
              {tFor(lang, "invoicesPage.back.nudgeClaimedAsk", {
                name: inv.paymentIntent?.claimedBy?.trim() || inv.client,
                method: methodLabel(inv.paymentIntent?.method, lang),
                ref: inv.paymentIntent?.reference
                  ? tFor(lang, "invoicesPage.subline.ref", {
                    ref: inv.paymentIntent.reference,
                  })
                  : "",
              })}
            </span>
            <button
              type="button"
              data-cy="invoice-nudge-ask-yes"
              onClick={(e) => {
                setNudgeAsk(false);
                return doSendNudge(e);
              }}
              disabled={busy}
            >
              {tFor(lang, "invoicesPage.back.nudgeClaimedYes")}
            </button>
            <button
              type="button"
              data-cy="invoice-nudge-ask-no"
              onClick={(e) => {
                e.stopPropagation();
                setNudgeAsk(false);
              }}
            >
              {tFor(lang, "invoicesPage.back.nudgeClaimedNo")}
            </button>
          </div>
        )}
        {inv.stage === "claimed" && rejectAsk && (
          <div
            data-cy="invoice-reject-ask"
            role="alert"
            style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:0 0 10px;font-size:13px"
            onClick={(e) => e.stopPropagation()}
          >
            <span style="flex:1 1 100%">
              {tFor(lang, "invoicesPage.back.rejectAsk", {
                name: inv.paymentIntent?.claimedBy?.trim() || inv.client,
                method: methodLabel(inv.paymentIntent?.method, lang),
              })}
            </span>
            <button
              type="button"
              data-cy="invoice-reject-ask-yes"
              onClick={(e) => {
                setRejectAsk(false);
                return doRejectClaim(e);
              }}
              disabled={busy}
            >
              {tFor(lang, "invoicesPage.back.rejectYes")}
            </button>
            <button
              type="button"
              data-cy="invoice-reject-ask-no"
              onClick={(e) => {
                e.stopPropagation();
                setRejectAsk(false);
              }}
            >
              {tFor(lang, "invoicesPage.back.rejectNo")}
            </button>
          </div>
        )}
        <div class="qcard__back-foot">
          {
            /* Design rule: exactly ONE solid primary per action row — the
              stage CTA (e.g. "Confirm payment" on a claimed card); every
              other action stays outlined. */
          }
          <button
            type="button"
            class="qcard__back-btn--primary"
            onClick={ctaAction}
            disabled={busy}
            data-cy={`invoice-back-cta-${inv.stage}`}
          >
            {busy ? "…" : cta}
          </button>
          <button type="button" onClick={doOpenInvoice}>
            {tFor(lang, "invoicesPage.back.open")}
          </button>
          {inv.stage === "claimed" && (
            <button
              type="button"
              data-cy="invoice-nudge"
              onClick={(e) => {
                e.stopPropagation();
                setNudgeAsk(true);
              }}
              disabled={busy || nudgeAsk}
            >
              {tFor(lang, "invoicesPage.back.nudge")}
            </button>
          )}
          {inv.stage === "claimed" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRejectAsk(true);
              }}
              disabled={busy || rejectAsk}
              data-cy="invoice-reject-claim"
              title={tFor(lang, "invoicesPage.back.rejectTitle")}
            >
              {tFor(lang, "invoicesPage.back.reject")}
            </button>
          )}
          {inv.stage === "scheduled" && (
            <button
              type="button"
              data-cy="invoice-change-date"
              onClick={(e) => {
                e.stopPropagation();
                setDateEdit((v) =>
                  v === null ? (inv.scheduledFor ?? "") : null
                );
              }}
              disabled={busy}
            >
              {tFor(lang, "invoicesPage.back.changeDate")}
            </button>
          )}
          {hasSecondaryPaymentReceived(inv.stage) && (
            <button
              type="button"
              data-cy="invoice-payment-received"
              onClick={doPaymentReceived}
              disabled={busy}
            >
              {tFor(lang, "invoicesPage.detail.paymentReceivedBtn")}
            </button>
          )}
          {(inv.stage === "overdue" || inv.stage === "out")
            ? (
              <button
                type="button"
                data-cy="invoice-mute-toggle"
                onClick={doToggleMute}
                disabled={busy}
                title={inv.remindersMuted
                  ? tFor(lang, "invoicesPage.back.muteTitleOff")
                  : tFor(lang, "invoicesPage.back.muteTitleOn")}
              >
                {inv.remindersMuted
                  ? tFor(lang, "invoicesPage.back.muted")
                  : tFor(lang, "invoicesPage.back.mute")}
              </button>
            )
            : (
              <button type="button" onClick={doSendText} disabled={busy}>
                {tFor(lang, "invoicesPage.back.textClient")}
              </button>
            )}
        </div>
      </div>
    </article>
  );
}

/* ---------------- New invoice modal (REQ-206) ---------------- */

const NEW_SENTINEL = "__new__";
/** Where the form remembers the payment instructions when Settings has none. */
const PAY_INSTR_KEY = "pm:invoice-payment-instructions";

/** A line as typed: dollars and quantity as strings, converted on submit. */
interface TypedLine {
  description: string;
  quantity: string;
  unit: string;
  price: string;
}

function toFormLines(lines: TypedLine[]): FormLine[] {
  return lines.map((l) => ({
    description: l.description.trim(),
    quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 0,
    ...(l.unit.trim() ? { unit: l.unit.trim() } : {}),
    price: dollarsToCents(l.price),
  }));
}

/**
 * A standalone invoice is complete on its own (REQ-206): bill-to (prefilled
 * from the customer, editable), service address and dates, line items,
 * subtotal / discount / tax / total in cents, payment terms → due date,
 * payment instructions (from Settings, else remembered here), a
 * "what's missing" prompt that warns but never blocks, and Save draft /
 * Issue invoice. No acceptance, no signature. One `requestId` per open
 * modal, so a retried submit cannot create two invoices (REQ-200).
 *
 * With `quoteId` (the /invoices?new=1&quoteId= link from a quote) the form
 * is prefilled from the quote's ledger — its customer, job name and the
 * amount still to invoice — and the invoice stays linked to the quote.
 *
 * REQ-474 (demo-loop cycle 3, M17): picking a client shows what they already
 * have — scheduled / drafted / unpaid invoices and signed quotes — with "Send
 * INV-001 now" and "Link to Q-001". Linking sends the quoteId, so the REQ-233
 * agreement cap applies; a direct bill no longer lands beside a scheduled one
 * unseen.
 */
function NewInvoiceModal(
  { customers, invoices, lang, quoteId, onClose }: {
    customers: Customer[];
    /** the page's invoices — what the picked client already has (REQ-474) */
    invoices: Invoice[];
    lang: Lang;
    quoteId?: string | null;
    onClose: () => void;
  },
) {
  const today = new Date().toISOString().slice(0, 10);
  const [requestId] = useState(() => crypto.randomUUID());
  const [clientSel, setClientSel] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [jobName, setJobName] = useState("");
  const [description, setDescription] = useState("");
  const [billTo, setBillTo] = useState<BillTo>(EMPTY_BILL_TO);
  const [serviceAddress, setServiceAddress] = useState("");
  const [serviceFrom, setServiceFrom] = useState("");
  const [serviceTo, setServiceTo] = useState("");
  const [lines, setLines] = useState<TypedLine[]>([]);
  /** the one-amount bill: used only while there are no line items */
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [issuedDate, setIssuedDate] = useState(today);
  // REQ-483 (demo-loop cycle 3, m18): the terms start from Settings' days to
  // pay and, drawn from a quote, that quote's payment terms — applied below
  // once the profile / quote load, until the contractor picks terms himself.
  const [netDays, setNetDays] = useState<number>(() =>
    defaultInvoiceNetDays(undefined, null)
  );
  const [customTerms, setCustomTerms] = useState(false);
  const [dueDate, setDueDate] = useState(() =>
    dueDateFrom(today, defaultInvoiceNetDays(undefined, null))
  );
  const [termsTouched, setTermsTouched] = useState(false);
  const [accountNetDays, setAccountNetDays] = useState<number | undefined>(
    undefined,
  );
  const [quoteTerms, setQuoteTerms] = useState<
    Array<{ stepId?: string; value?: string }> | null
  >(null);
  const [paymentInstructions, setPaymentInstructions] = useState("");
  // REQ-022 (NW-31c): "Send on" — optional; when set the invoice is created
  // scheduled (Upcoming) instead of drafted/sent.
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // REQ-205: the quote's ledger, when the form opened from a quote
  const [ledger, setLedger] = useState<LedgerPrefill | null>(null);
  const [ledgerErr, setLedgerErr] = useState(false);
  // REQ-474: the quote this invoice bills against — the ?quoteId= link, or
  // the signed quote picked with "Link to Q-001"
  const [linkedQuoteId, setLinkedQuoteId] = useState<string | null>(
    quoteId ?? null,
  );
  // REQ-474: the account's quotes, fetched once a client is picked
  const [allQuotes, setAllQuotes] = useState<QuoteCard[] | null>(null);
  /** REQ-450: the job-name example fits the business's trade. */
  const [businessName, setBusinessName] = useState<string | undefined>();

  // Payment instructions: Settings' contract defaults first, else the last
  // ones typed here, else (REQ-483, M40) the accepted payment methods saved
  // at onboarding — "Zelle: 5125550102 · Cash". The profile also carries
  // Settings' days to pay (identity.invoiceNetDays) for the terms (m18).
  useEffect(() => {
    let alive = true;
    let remembered: string | null = null;
    try {
      remembered = globalThis.localStorage?.getItem(PAY_INSTR_KEY) ?? null;
      if (remembered) setPaymentInstructions(remembered);
    } catch { /* storage unavailable */ }
    dashboardClient.profile().then((p) => {
      if (!alive) return;
      const identity = p?.identity ?? null;
      // REQ-450: the job-name example fits the business's trade.
      const name = p?.identity?.businessName ?? p?.identity?.displayName;
      if (typeof name === "string") setBusinessName(name);
      const text = defaultPaymentInstructions({
        settings: p?.contractDefaults?.paymentInstructions,
        remembered,
        methods: identity?.acceptedPaymentMethods,
        lang,
      });
      if (text) setPaymentInstructions(text);
      if (typeof identity?.invoiceNetDays === "number") {
        setAccountNetDays(identity.invoiceNetDays);
      }
    }).catch(() => {/* the field stays editable */});
    return () => {
      alive = false;
    };
  }, []);

  // REQ-205: prefill from the quote's ledger
  useEffect(() => {
    if (!linkedQuoteId) return;
    let alive = true;
    setLedgerErr(false);
    Promise.all([
      dashboardClient.quoteLedger(linkedQuoteId),
      dashboardClient.quote(linkedQuoteId).catch(() => null),
    ]).then(([l, q]) => {
      if (!alive) return;
      const p = prefillFromLedger(l, q);
      setLedger(p);
      if (Array.isArray(q?.terms)) setQuoteTerms(q.terms);
      if (p.customerId) pickCustomer(p.customerId);
      if (p.jobName) setJobName(p.jobName);
      setAmount(centsToDollars(p.amountCents));
    }).catch(() => {
      if (alive) setLedgerErr(true);
    });
    return () => {
      alive = false;
    };
  }, [linkedQuoteId]);

  // REQ-474: a client picked → load the quotes once, to find their signed ones
  const pickedId = clientSel && clientSel !== NEW_SENTINEL ? clientSel : "";
  useEffect(() => {
    if (!pickedId || allQuotes) return;
    let alive = true;
    dashboardClient.quotes().then((qs) => {
      if (alive) setAllQuotes(Array.isArray(qs) ? qs : []);
    }).catch(() => {
      if (alive) setAllQuotes([]);
    });
    return () => {
      alive = false;
    };
  }, [pickedId]);
  const prior = useMemo(
    () => priorBillingFor(pickedId, invoices, allQuotes ?? []),
    [pickedId, invoices, allQuotes],
  );
  const priorQuotes = linkedQuoteId ? [] : prior.quotes;

  /** REQ-474: "Send INV-001 now" — the scheduled / drafted bill goes out
   *  instead of a second one: issue it (status sent) and dispatch it. */
  async function sendPrior(inv: PriorInvoice) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/invoices/${inv.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "sent",
          issuedDate: new Date().toISOString().slice(0, 10),
        }),
      });
      await r.body?.cancel();
      if (!r.ok) throw new Error(String(r.status));
      const d = await dispatchInvoice(inv.id);
      if (!d.delivered || d.partial) {
        try {
          globalThis.sessionStorage?.setItem(
            SEND_FLASH_KEY,
            JSON.stringify({
              text: d.delivered
                ? partialDispatchCopy(lang, d)
                : dispatchFailureCopy(lang, d),
              partial: d.delivered,
            }),
          );
        } catch { /* storage unavailable — the reload still happens */ }
      }
      const back = new URL(globalThis.location.href);
      back.searchParams.delete("new");
      back.searchParams.delete("quoteId");
      globalThis.location.assign(back.toString());
    } catch {
      setError(
        tFor(lang, "invoicesPage.new.prior.sendFailed", { number: inv.number }),
      );
      setBusy(false);
    }
  }

  // REQ-483 (m18): apply the default terms as the profile and the quote
  // arrive — never over terms the contractor already picked.
  useEffect(() => {
    if (termsTouched) return;
    const n = defaultInvoiceNetDays(accountNetDays, quoteTerms);
    setNetDays(n);
    setCustomTerms(!isPresetNetDays(n));
    setDueDate(dueDateFrom(issuedDate, n));
  }, [accountNetDays, quoteTerms]);

  /** Pick a customer: bill-to and the service address follow (editable after). */
  function pickCustomer(id: string) {
    setClientSel(id);
    if (id && id !== NEW_SENTINEL) {
      const c = customers.find((x) => x.id === id);
      const bt = billToFromCustomer(c);
      setBillTo(bt);
      setServiceAddress(bt.address);
    } else {
      setBillTo(EMPTY_BILL_TO);
      setServiceAddress("");
    }
  }

  function pickTerms(value: string) {
    setTermsTouched(true);
    if (value === "custom") {
      setCustomTerms(true);
      return;
    }
    const n = Number(value);
    setCustomTerms(false);
    setNetDays(n);
    setDueDate(dueDateFrom(issuedDate, n));
  }

  function changeIssued(value: string) {
    setIssuedDate(value);
    if (!customTerms && value) setDueDate(dueDateFrom(value, netDays));
  }

  const formLines = toFormLines(lines);
  const totals = computeTotals({
    lineItems: formLines,
    amountCents: dollarsToCents(amount),
    discountCents: dollarsToCents(discount),
    taxRateBp: percentToBp(taxRate),
  });
  const missing = missingInfo({
    billTo,
    serviceAddress,
    lineItems: formLines,
    amountCents: totals.totalCents,
  });

  // Whether the chosen client is reachable — gates the dispatch, never the issue.
  const selectedCustomer = clientSel && clientSel !== NEW_SENTINEL
    ? customers.find((c) => c.id === clientSel)
    : undefined;
  const canSend = clientSel === NEW_SENTINEL
    ? !!(newEmail.trim() || newPhone.trim())
    : !!(selectedCustomer?.email || selectedCustomer?.phoneNumber ||
      billTo.email.trim() || billTo.phoneNumber.trim());

  const labelStyle =
    "display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)";
  const inputStyle =
    "padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)";
  const smallInput =
    "padding:8px 10px;border:1px solid var(--border,#d8dcd5);border-radius:8px;font:inherit;font-size:13.5px;font-weight:400;color:var(--fg);min-width:0";
  const sectionTitle =
    "margin:6px 0 0;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--fg-muted,#6b7560)";

  async function submit(issue: boolean) {
    if (busy) return;
    if (totals.totalCents <= 0) {
      setError(tFor(lang, "invoicesPage.new.errAmount"));
      return;
    }
    if (!dueDate) {
      setError(tFor(lang, "invoicesPage.new.errDueDate"));
      return;
    }
    if (clientSel === NEW_SENTINEL && !newName.trim()) {
      setError(tFor(lang, "invoicesPage.new.errClientName"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let customerId: string | undefined;
      let bt = billTo;
      if (clientSel === NEW_SENTINEL) {
        const created = await clientsClient.create({
          name: newName.trim(),
          ...(newPhone.trim() ? { phoneNumber: newPhone.trim() } : {}),
          ...(newEmail.trim() ? { email: newEmail.trim() } : {}),
        });
        customerId = created.id;
        bt = {
          ...billTo,
          name: billTo.name.trim() || newName.trim(),
          email: billTo.email.trim() || newEmail.trim(),
          phoneNumber: billTo.phoneNumber.trim() || newPhone.trim(),
        };
      } else if (clientSel) {
        customerId = clientSel;
      }
      try {
        if (paymentInstructions.trim()) {
          globalThis.localStorage?.setItem(
            PAY_INSTR_KEY,
            paymentInstructions.trim(),
          );
        }
      } catch { /* storage unavailable */ }
      const body = buildInvoiceBody(
        {
          customerId,
          // REQ-474: the linked quote (REQ-233 caps what it may bill)
          quoteId: linkedQuoteId ?? undefined,
          jobName,
          description,
          lineItems: formLines,
          amountCents: dollarsToCents(amount),
          discountCents: dollarsToCents(discount),
          discountReason,
          taxRateBp: percentToBp(taxRate),
          netDays,
          issuedDate,
          dueDate,
          serviceAddress,
          serviceDateFrom: serviceFrom || undefined,
          serviceDateTo: serviceTo || undefined,
          paymentInstructions,
          billTo: bt,
        },
        {
          requestId,
          // REQ-480 (demo cycle 3, M18): Issue with a dispatch to follow →
          // created unissued; the send endpoints stamp "sent" only once a
          // channel delivers. Issue with no contact → sent (issued by hand);
          // draft → the Drafting track; a "Send on" date (REQ-022) →
          // scheduled, in the Upcoming track.
          status: newInvoiceStatus({
            issue,
            dispatch: issue && canSend,
            scheduledFor,
          }),
          ...(!issue && scheduledFor ? { scheduledFor } : {}),
        },
      );
      const invoice = await dashboardClient.createInvoice(
        body as { dueDate: string } & Record<string, unknown>,
      );
      // Issue + reachable: dispatch the pay link over both channels. The
      // backend handles "no email/phone on file" gracefully; unreachable is
      // one of the "missing info" prompts, never a block.
      if (issue && canSend && invoice?.id) {
        const d = await dispatchInvoice(invoice.id);
        // REQ-030 (NW-25): never drop a channel failure on the way to the
        // reload — the page shows it after navigating.
        if (!d.delivered || d.partial) {
          try {
            globalThis.sessionStorage?.setItem(
              SEND_FLASH_KEY,
              JSON.stringify({
                text: d.delivered
                  ? partialDispatchCopy(lang, d)
                  : dispatchFailureCopy(lang, d, {
                    number: invoice.number,
                    keptDraft: true,
                  }),
                partial: d.delivered,
              }),
            );
          } catch { /* storage unavailable — the reload still happens */ }
        }
      }
      // Reload so the new invoice enriches into the right track — without the
      // ?new=1 deep link, or the modal would reopen over the fresh card.
      const back = new URL(globalThis.location.href);
      back.searchParams.delete("new");
      back.searchParams.delete("quoteId");
      globalThis.location.assign(back.toString());
    } catch (err) {
      setError(
        isExceedsAgreement(err) // REQ-233: the agreement cap's 409
          ? tFor(lang, "invoicesPage.new.errExceedsAgreement")
          : err instanceof Error
          ? err.message
          : tFor(lang, "invoicesPage.new.errCreate"),
      );
      setBusy(false);
    }
  }
  function onFormSubmit(e: Event) {
    e.preventDefault();
    submit(true);
  }

  function setLine(i: number, patch: Partial<TypedLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function setBill(patch: Partial<BillTo>) {
    setBillTo((b) => ({ ...b, ...patch }));
  }
  // REQ-409: the intro and ledger line follow the quote (and its acceptance)
  const copy = newInvoiceCopy(ledger);

  // REQ-440 (cycle 3, m2): the sheet scrolls, so it ends above the demo pill's band (0 with no demo)
  return (
    <Backdrop
      onClose={() => !busy && onClose()}
      style="position:fixed;inset:0 0 var(--demo-pill-h, 0px) 0;background:rgba(20,40,45,0.45);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:20px;overflow-y:auto"
    >
      <form
        data-cy="new-invoice-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onFormSubmit}
        style="background:#fff;border-radius:16px;padding:24px 26px;max-width:640px;width:100%;box-shadow:0 24px 64px rgba(20,72,82,0.22);display:flex;flex-direction:column;gap:14px;margin:auto"
      >
        <h2 style="margin:0;font-size:20px;font-weight:800;color:var(--fg,#144852)">
          {tFor(lang, "invoicesPage.new.title")}
        </h2>
        <p style="margin:0;font-size:13px;color:var(--fg-muted,#6b7560)">
          {tFor(lang, copy.introKey, { number: ledger?.quoteNumber ?? "" })}
        </p>

        {/* REQ-205 / REQ-409: the quote this bill draws on */}
        {ledger && copy.ledgerKey && (
          <p
            data-cy="new-invoice-ledger"
            style="margin:0;font-size:13px;font-weight:700;color:var(--brand-teal,#144852);background:rgba(20,72,82,0.06);border-radius:10px;padding:10px 12px"
          >
            {tFor(lang, copy.ledgerKey, {
              number: ledger.quoteNumber,
              agreed: fmtMoneyExact(ledger.agreedCents),
              quoted: fmtMoneyExact(ledger.agreedCents),
              invoiced: fmtMoneyExact(ledger.invoicedCents),
              remaining: fmtMoneyExact(ledger.remainingCents),
            })}
          </p>
        )}
        {copy.notAcceptedKey && (
          <p
            data-cy="new-invoice-quote-not-accepted"
            style="margin:0;font-size:12.5px;color:#8a5a00"
          >
            {tFor(lang, copy.notAcceptedKey)}
          </p>
        )}
        {ledgerErr && (
          <p style="margin:0;font-size:12.5px;color:#a83b3b">
            {tFor(lang, "invoices.form.quoteLoadFailed")}
          </p>
        )}

        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.new.client")}
          <select
            data-cy="new-invoice-client"
            value={clientSel}
            disabled={busy}
            onInput={(e) => pickCustomer((e.target as HTMLSelectElement).value)}
            style={inputStyle}
          >
            <option value="">
              {tFor(lang, "invoicesPage.new.clientNone")}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number ? `${c.number} · ` : ""}
                {c.name}
              </option>
            ))}
            <option value={NEW_SENTINEL}>
              {tFor(lang, "invoicesPage.new.newClient")}
            </option>
          </select>
        </label>

        {/* REQ-474 (M17): what this client already has — bill that instead */}
        {(prior.invoices.length > 0 || priorQuotes.length > 0) && (
          <div
            data-cy="new-invoice-prior"
            role="status"
            style="display:flex;flex-direction:column;gap:8px;background:#FFF6E0;border:1px solid #F1D48A;border-radius:10px;padding:12px 14px;font-size:13px;color:#5A3D08"
          >
            {prior.invoices.map((inv) => {
              const quote = inv.quoteNumber;
              return (
                <div
                  key={inv.id}
                  style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"
                >
                  <span data-cy="new-invoice-prior-invoice">
                    {tFor(
                      lang,
                      `invoicesPage.new.prior.${inv.kind}${
                        quote ? "Quote" : ""
                      }`,
                      {
                        name: selectedCustomer?.name ?? "",
                        number: inv.number,
                        amount: fmtMoneyExact(inv.amountCents),
                        quote: quote ?? "",
                      },
                    )}
                  </span>
                  {inv.kind !== "open" && (
                    <button
                      type="button"
                      data-cy="new-invoice-prior-send"
                      disabled={busy}
                      onClick={() => sendPrior(inv)}
                      style="padding:7px 12px;border-radius:999px;border:0;background:var(--brand-teal,#144852);color:#fff;font:inherit;font-size:12.5px;font-weight:800;cursor:pointer"
                    >
                      {tFor(lang, "invoicesPage.new.prior.sendNow", {
                        number: inv.number,
                      })}
                    </button>
                  )}
                </div>
              );
            })}
            {priorQuotes.map((q) => (
              <div
                key={q.id}
                style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"
              >
                <span>
                  {tFor(
                    lang,
                    q.remainingCents > 0
                      ? "invoicesPage.new.prior.quote"
                      : "invoicesPage.new.prior.quoteBilled",
                    {
                      quote: q.number,
                      amount: fmtMoneyExact(q.remainingCents),
                    },
                  )}
                </span>
                <button
                  type="button"
                  data-cy="new-invoice-prior-link"
                  disabled={busy}
                  onClick={() => setLinkedQuoteId(q.id)}
                  style="padding:7px 12px;border-radius:999px;border:1px solid var(--brand-teal,#144852);background:#fff;color:var(--brand-teal,#144852);font:inherit;font-size:12.5px;font-weight:800;cursor:pointer"
                >
                  {tFor(lang, "invoicesPage.new.prior.link", {
                    quote: q.number,
                  })}
                </button>
              </div>
            ))}
            <span style="font-size:12px">
              {tFor(lang, "invoicesPage.new.prior.hint")}
            </span>
          </div>
        )}

        {clientSel === NEW_SENTINEL && (
          <div style="display:flex;flex-direction:column;gap:12px;background:rgba(0,0,0,0.03);border-radius:10px;padding:12px 14px">
            <label style={labelStyle}>
              {tFor(lang, "settings.name")}
              <input
                type="text"
                autoFocus
                required
                value={newName}
                disabled={busy}
                onInput={(e) =>
                  setNewName((e.target as HTMLInputElement).value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              {tFor(lang, "settings.phone")}
              <input
                type="tel"
                value={formatPhoneInput(newPhone)} /* NW-34 (REQ-012) */
                disabled={busy}
                onInput={(e) =>
                  setNewPhone((e.target as HTMLInputElement).value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              {tFor(lang, "settings.email")}
              <input
                type="email"
                value={newEmail}
                disabled={busy}
                onInput={(e) =>
                  setNewEmail((e.target as HTMLInputElement).value)}
                style={inputStyle}
              />
            </label>
          </div>
        )}

        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.new.jobName")}
          <input
            type="text"
            data-cy="new-invoice-jobname"
            placeholder={tFor(lang, invoiceJobNamePlaceholderKey(businessName))}
            value={jobName}
            disabled={busy}
            onInput={(e) => setJobName((e.target as HTMLInputElement).value)}
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.new.description")}
          <textarea
            rows={2}
            data-cy="new-invoice-description"
            placeholder={tFor(lang, "invoicesPage.new.descriptionPlaceholder")}
            value={description}
            disabled={busy}
            onInput={(e) =>
              setDescription((e.target as HTMLTextAreaElement).value)}
            style={`${inputStyle};resize:vertical`}
          />
        </label>

        {/* ---- bill to ---- */}
        <div style={sectionTitle}>{tFor(lang, "invoices.form.billTo")}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.billName")}
            <input
              type="text"
              data-cy="new-invoice-bill-name"
              value={billTo.name}
              disabled={busy}
              onInput={(e) =>
                setBill({ name: (e.target as HTMLInputElement).value })}
              style={smallInput}
            />
          </label>
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.billBusiness")}
            <input
              type="text"
              data-cy="new-invoice-bill-business"
              value={billTo.businessName}
              disabled={busy}
              onInput={(e) =>
                setBill({ businessName: (e.target as HTMLInputElement).value })}
              style={smallInput}
            />
          </label>
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.billEmail")}
            <input
              type="email"
              data-cy="new-invoice-bill-email"
              value={billTo.email}
              disabled={busy}
              onInput={(e) =>
                setBill({ email: (e.target as HTMLInputElement).value })}
              style={smallInput}
            />
          </label>
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.billPhone")}
            <input
              type="tel"
              data-cy="new-invoice-bill-phone"
              value={billTo.phoneNumber}
              disabled={busy}
              onInput={(e) =>
                setBill({ phoneNumber: (e.target as HTMLInputElement).value })}
              style={smallInput}
            />
          </label>
        </div>
        <label style={labelStyle}>
          {tFor(lang, "invoices.form.billAddress")}
          <input
            type="text"
            data-cy="new-invoice-bill-address"
            value={billTo.address}
            disabled={busy}
            onInput={(e) =>
              setBill({ address: (e.target as HTMLInputElement).value })}
            style={smallInput}
          />
        </label>

        {/* ---- service ---- */}
        <label style={labelStyle}>
          {tFor(lang, "invoices.form.serviceAddress")}
          <input
            type="text"
            data-cy="new-invoice-service-address"
            value={serviceAddress}
            disabled={busy}
            onInput={(e) =>
              setServiceAddress((e.target as HTMLInputElement).value)}
            style={smallInput}
          />
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.serviceFrom")}
            <input
              type="date"
              data-cy="new-invoice-service-from"
              value={serviceFrom}
              disabled={busy}
              onInput={(e) =>
                setServiceFrom((e.target as HTMLInputElement).value)}
              style={smallInput}
            />
          </label>
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.serviceTo")}
            <input
              type="date"
              data-cy="new-invoice-service-to"
              value={serviceTo}
              disabled={busy}
              onInput={(e) =>
                setServiceTo((e.target as HTMLInputElement).value)}
              style={smallInput}
            />
          </label>
        </div>

        {/* ---- line items ---- */}
        <div style={sectionTitle}>{tFor(lang, "invoices.form.lineItems")}</div>
        {lines.length > 0 && (
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:grid;grid-template-columns:1fr 64px 76px 110px 28px;gap:6px;font-size:11px;font-weight:700;color:var(--fg-muted,#6b7560)">
              <span>{tFor(lang, "invoices.form.lineDesc")}</span>
              <span>{tFor(lang, "invoices.form.lineQty")}</span>
              <span>{tFor(lang, "invoices.form.lineUnit")}</span>
              <span>{tFor(lang, "invoices.form.linePrice")}</span>
              <span />
            </div>
            {lines.map((l, i) => (
              <div
                key={i}
                data-cy={`new-invoice-line-${i}`}
                style="display:grid;grid-template-columns:1fr 64px 76px 110px 28px;gap:6px;align-items:center"
              >
                <input
                  type="text"
                  data-cy={`new-invoice-line-desc-${i}`}
                  value={l.description}
                  disabled={busy}
                  onInput={(e) =>
                    setLine(i, {
                      description: (e.target as HTMLInputElement).value,
                    })}
                  style={smallInput}
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  data-cy={`new-invoice-line-qty-${i}`}
                  value={l.quantity}
                  disabled={busy}
                  onInput={(e) =>
                    setLine(i, {
                      quantity: (e.target as HTMLInputElement).value,
                    })}
                  style={smallInput}
                />
                <input
                  type="text"
                  data-cy={`new-invoice-line-unit-${i}`}
                  value={l.unit}
                  disabled={busy}
                  onInput={(e) =>
                    setLine(i, { unit: (e.target as HTMLInputElement).value })}
                  style={smallInput}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  data-cy={`new-invoice-line-price-${i}`}
                  value={l.price}
                  disabled={busy}
                  onInput={(e) =>
                    setLine(i, { price: (e.target as HTMLInputElement).value })}
                  style={smallInput}
                />
                <button
                  type="button"
                  data-cy={`new-invoice-line-remove-${i}`}
                  aria-label={tFor(lang, "invoices.form.removeLine")}
                  title={tFor(lang, "invoices.form.removeLine")}
                  disabled={busy}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  style="appearance:none;cursor:pointer;background:none;border:0;padding:4px;color:var(--fg-muted,#6b7560)"
                >
                  <I d={ICN.x} size={14} sw={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div>
          <button
            type="button"
            data-cy="new-invoice-line-add"
            disabled={busy}
            onClick={() => setLines((ls) => [
              ...ls,
              { description: "", quantity: "1", unit: "", price: "" },
            ])}
            style="appearance:none;cursor:pointer;background:none;border:1px dashed var(--border,#d8dcd5);border-radius:8px;padding:7px 12px;font:inherit;font-size:13px;font-weight:700;color:var(--brand-teal,#144852)"
          >
            {tFor(lang, "invoices.form.addLine")}
          </button>
        </div>

        {/* ---- money ---- */}
        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.new.amount")}
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            data-cy="new-invoice-amount"
            placeholder="0.00"
            value={lines.length > 0
              ? centsToDollars(totals.subtotalCents)
              : amount}
            readOnly={lines.length > 0}
            disabled={busy}
            onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
            style={`${inputStyle}${
              lines.length > 0 ? ";background:rgba(0,0,0,0.03)" : ""
            }`}
          />
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.discount")}
            <input
              type="number"
              min="0"
              step="0.01"
              data-cy="new-invoice-discount"
              placeholder="0.00"
              value={discount}
              disabled={busy}
              onInput={(e) => setDiscount((e.target as HTMLInputElement).value)}
              style={smallInput}
            />
          </label>
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.discountReason")}
            <input
              type="text"
              data-cy="new-invoice-discount-reason"
              value={discountReason}
              disabled={busy}
              onInput={(e) =>
                setDiscountReason((e.target as HTMLInputElement).value)}
              style={smallInput}
            />
          </label>
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.taxRate")}
            <input
              type="number"
              min="0"
              step="0.01"
              data-cy="new-invoice-tax"
              placeholder="0"
              value={taxRate}
              disabled={busy}
              onInput={(e) => setTaxRate((e.target as HTMLInputElement).value)}
              style={smallInput}
            />
          </label>
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.issueDate")}
            <input
              type="date"
              data-cy="new-invoice-issued"
              value={issuedDate}
              disabled={busy}
              onInput={(e) =>
                changeIssued((e.target as HTMLInputElement).value)}
              style={smallInput}
            />
          </label>
        </div>

        {/* totals */}
        <div
          data-cy="new-invoice-totals"
          style="display:flex;flex-direction:column;gap:4px;background:rgba(0,0,0,0.03);border-radius:10px;padding:10px 12px;font-size:13px;font-variant-numeric:tabular-nums"
        >
          <div style="display:flex;justify-content:space-between">
            <span>{tFor(lang, "invoices.form.subtotal")}</span>
            <span data-cy="new-invoice-subtotal">
              {fmtMoneyExact(totals.subtotalCents)}
            </span>
          </div>
          {totals.discountCents > 0 && (
            <div style="display:flex;justify-content:space-between;color:var(--brand-green,#519843)">
              <span>{tFor(lang, "invoices.form.discount")}</span>
              <span>−{fmtMoneyExact(totals.discountCents)}</span>
            </div>
          )}
          <div style="display:flex;justify-content:space-between">
            <span>
              {tFor(lang, "invoices.form.tax")}
              {percentToBp(taxRate) > 0
                ? ` (${bpToPercent(percentToBp(taxRate))}%)`
                : ""}
            </span>
            <span data-cy="new-invoice-tax-cents">
              {fmtMoneyExact(totals.taxCents)}
            </span>
          </div>
          <div style="display:flex;justify-content:space-between;font-weight:900;font-size:16px;color:var(--fg,#144852);border-top:1px solid var(--border,#d8dcd5);padding-top:6px;margin-top:2px">
            <span>{tFor(lang, "invoices.form.total")}</span>
            <span data-cy="new-invoice-total">
              {fmtMoneyExact(totals.totalCents)}
            </span>
          </div>
        </div>

        {/* ---- terms ---- */}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style={labelStyle}>
            {tFor(lang, "invoices.form.terms")}
            <select
              data-cy="new-invoice-terms"
              value={customTerms ? "custom" : String(netDays)}
              disabled={busy}
              onInput={(e) => pickTerms((e.target as HTMLSelectElement).value)}
              style={smallInput}
            >
              {NET_DAYS_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  {tFor(lang, `invoices.form.net${n}`)}
                </option>
              ))}
              <option value="custom">
                {tFor(lang, "invoices.form.netCustom")}
              </option>
            </select>
          </label>
          <label style={labelStyle}>
            {tFor(lang, "invoicesPage.new.dueDate")}
            <input
              type="date"
              data-cy="new-invoice-due"
              value={dueDate}
              disabled={busy}
              onInput={(e) => {
                setTermsTouched(true);
                setCustomTerms(true);
                setDueDate((e.target as HTMLInputElement).value);
              }}
              style={smallInput}
            />
          </label>
        </div>

        <label style={labelStyle}>
          {tFor(lang, "invoices.form.paymentInstructions")}
          <textarea
            rows={2}
            data-cy="new-invoice-payment-instructions"
            placeholder={tFor(
              lang,
              "invoices.form.paymentInstructionsPlaceholder",
            )}
            value={paymentInstructions}
            disabled={busy}
            onInput={(e) =>
              setPaymentInstructions((e.target as HTMLTextAreaElement).value)}
            style={`${inputStyle};resize:vertical`}
          />
        </label>

        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.new.sendOn")}
          <input
            type="date"
            data-cy="invoice-schedule-date"
            value={scheduledFor}
            disabled={busy}
            onInput={(e) =>
              setScheduledFor((e.target as HTMLInputElement).value)}
            style={inputStyle}
          />
        </label>

        {/* REQ-206: what's missing — a prompt, never a gate */}
        {missing.length > 0 && (
          <div
            data-cy="new-invoice-missing"
            style="font-size:12.5px;color:#5A3D08;background:#FFF4DC;border-radius:10px;padding:10px 12px"
          >
            <div style="font-weight:800">
              {tFor(lang, "invoices.form.missingTitle")}
            </div>
            <ul style="margin:4px 0 0;padding-left:18px">
              {missing.map((m) => (
                <li key={m}>{tFor(lang, `invoices.form.missing.${m}`)}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p
            role="alert"
            style="margin:0;color:#a83b3b;font-size:13.5px;font-weight:600"
          >
            {error}
          </p>
        )}

        {/* one solid primary (Issue), one outlined secondary (Save draft), a ghost cancel */}
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:6px;flex-wrap:wrap">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style="padding:10px 14px;border:0;background:transparent;color:var(--fg-muted,#6b7560);font:inherit;font-weight:700;cursor:pointer;border-radius:10px"
          >
            {tFor(lang, "common.cancel")}
          </button>
          <button
            type="button"
            data-cy="new-invoice-draft"
            disabled={busy}
            onClick={() => submit(false)}
            style="padding:10px 16px;border:1px solid var(--brand-green,#519843);border-radius:10px;background:#fff;color:var(--brand-green,#519843);font:inherit;font-weight:800;cursor:pointer"
          >
            {scheduledFor
              ? tFor(lang, "invoicesPage.new.schedule")
              : tFor(lang, "invoices.form.saveDraft")}
          </button>
          <button
            type="submit"
            data-cy="new-invoice-submit"
            disabled={busy}
            style="padding:10px 20px;border:0;border-radius:10px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;cursor:pointer"
          >
            {busy
              ? tFor(lang, "invoices.form.issuing")
              : tFor(lang, "invoices.form.issue")}
          </button>
        </div>
        {!canSend && (
          <p style="margin:0;font-size:12px;color:var(--fg-muted,#6b7560);text-align:right">
            {tFor(lang, "invoicesPage.new.needContact")}
          </p>
        )}
      </form>
    </Backdrop>
  );
}
