/**
 * /invoices island — receivables view matching the canonical reference
 * (reference/extracted/Paperwork Monster Invoices.html). Despite the URL
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
import { clientsClient } from "../clients/clients.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";
import { fmtMoney, fmtMoneyExact } from "../lib/format.ts";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
import QuoteTrack from "./QuoteTrack.tsx";

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

const SHORT_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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

/** "2026-05-19" → "Tue" / "May 19" — short day-of-week label for the
 *  forecast hero breakdown. Falls back to MMM d when the date is more
 *  than a week out. */
function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  const diffDays = Math.round((d.getTime() - Date.now()) / (24 * 3600 * 1000));
  if (diffDays >= 0 && diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function monthLabel(idx: number, lang: Lang): string {
  return tFor(lang, `invoicesPage.month.${SHORT_MONTH[idx].toLowerCase()}`);
}

function fmtDate(iso: string | undefined, now: Date, lang: Lang): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${monthLabel(d.getMonth(), lang)} ${d.getDate()}`
    : `${monthLabel(d.getMonth(), lang)} ${d.getDate()}, ${d.getFullYear()}`;
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
    invoiceRef: `INV-${inv.id.slice(0, 6).toUpperCase()}`,
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

export default function InvoicesPage(_props: { lang?: Lang }) {
  // Self-source the reactive UI language. Reading langSignal.value during
  // render makes this island re-render live when SettingsPage flips the
  // language. The optional `lang` prop is an ignored SSR seed.
  const lang = langSignal.value;
  const [s, setS] = useState<State>(INITIAL);
  const [forecast, setForecast] = useState<ForecastResult | undefined>(
    undefined,
  );
  const [newOpen, setNewOpen] = useState(false);

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
    // Forecast hero — fire-and-forget. If it 404s on older backends we
    // silently fall back to the legacy "outstanding total" headline.
    fetch("/api/invoices/forecast/this-week", { credentials: "include" })
      .then((r) => r.ok ? r.json() as Promise<ForecastResult> : undefined)
      .then((f) => {
        if (alive && f) setForecast(f);
      })
      .catch(() => {/* ignore */});
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
  const paidThisMonthTotal = paidThisMonth.reduce(
    (sum, i) => sum + (i.amount ?? 0),
    0,
  );

  return (
    <>
      <InvoicesHero
        outstandingTotal={outstandingTotal}
        outstandingCount={overdue.length + out.length}
        overdueCount={overdue.length}
        totalInvoiceCount={enriched.length}
        forecast={forecast}
        lang={lang}
        onNew={() => setNewOpen(true)}
      />
      {newOpen && (
        <NewInvoiceModal
          customers={Array.isArray(s.customers) ? s.customers : []}
          lang={lang}
          onClose={() => setNewOpen(false)}
        />
      )}
      <InvoicesKpis
        overdueCount={overdue.length}
        overdueTotal={overdueTotal}
        outCount={out.length}
        outTotal={outTotal}
        draftingCount={drafting.length}
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
            defaultOpen={false}
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
            defaultOpen={false}
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
    overdueCount,
    totalInvoiceCount,
    forecast,
    lang,
    onNew,
  }: {
    outstandingTotal: number;
    outstandingCount: number;
    overdueCount: number;
    totalInvoiceCount: number;
    forecast?: ForecastResult;
    lang: Lang;
    onNew: () => void;
  },
) {
  const trulyEmpty = totalInvoiceCount === 0;
  const fresh = !trulyEmpty && outstandingCount === 0;
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
            : fresh && !haveForecast
            ? (
              <>
                {tFor(lang, "invoicesPage.hero.clearPre")}{" "}
                <em>{tFor(lang, "invoicesPage.hero.clearEm")}</em>.
              </>
            )
            : haveForecast && forecast!.thisWeekCents > 0
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
            : haveForecast && forecast!.nextWeekCents > 0
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
            : haveForecast && forecast!.thisWeek.length > 0
            ? (
              <span data-cy="forecast-breakdown">
                {forecast!.thisWeek.slice(0, 3).map((e, i) => (
                  <span key={e.invoiceId}>
                    {i > 0 ? " · " : ""}
                    {shortDay(e.expectedLandDate)}:{" "}
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
          <a
            class="qph__cta qph__cta--ghost"
            data-cy="invoice-export"
            href={`/api/invoices/export.csv?year=${new Date().getFullYear()}`}
            style="margin-left:10px;background:transparent;border:1px solid currentColor"
          >
            {tFor(lang, "invoicesPage.exportCsv", {
              year: new Date().getFullYear(),
            })}
          </a>
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
    paidCount,
    paidTotal,
    lang,
  }: {
    overdueCount: number;
    overdueTotal: number;
    outCount: number;
    outTotal: number;
    draftingCount: number;
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
        <div class="qkpi__sub">
          {tFor(
            lang,
            draftingCount === 0
              ? "invoicesPage.kpi.draftingSubEmpty"
              : "invoicesPage.kpi.draftingSub",
          )}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">{tFor(lang, "invoicesPage.kpi.paid")}</div>
        <div class="qkpi__val">{fmtMoney(paidTotal)}</div>
        <div class="qkpi__sub">
          {tFor(lang, "invoicesPage.kpi.paidSub", { n: paidCount })}
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

/** Dispatch an invoice to the customer over both channels (best-effort — the
 *  backend handles "no email/phone on file" gracefully). Single source for the
 *  card "Send now"/"Finish + send" actions and the New Invoice "Create & send"
 *  so the channel set + request shape can't drift across the three call sites. */
function dispatchInvoice(id: string): Promise<PromiseSettledResult<Response>[]> {
  return Promise.allSettled([
    fetch(`/api/invoices/${id}/email`, { method: "POST", credentials: "include" }),
    fetch(`/api/invoices/${id}/text`, { method: "POST", credentials: "include" }),
  ]);
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
  // Roadmap p.12: in-card discount + change-order controls.
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [discountDollars, setDiscountDollars] = useState("");
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
    ? tFor(lang, "invoicesPage.cta.out")
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
    ? tFor(lang, "invoicesPage.subline.scheduled", {
      date: inv.scheduledFor ?? "—",
    })
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
    try {
      const r = await fetch(`/api/invoices/${inv.id}/text`, {
        method: "POST",
        credentials: "include",
      });
      if (r.ok) globalThis.location.reload();
    } finally {
      setBusy(false);
    }
  }
  async function doSendNow(e: Event) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      // Fire both channels — the backend coordinator handles "no
      // email/phone on file" gracefully and the user gets a fresh state
      // on reload either way.
      await dispatchInvoice(inv.id);
      globalThis.location.reload();
    } finally {
      setBusy(false);
    }
  }
  // "Finish + send" on a draft: a fully deterministic dashboard action — no
  // assistant round-trip. Finalize the invoice (draft → sent, stamp issuedDate
  // if missing), then dispatch to the customer over both channels. The backend
  // send coordinators only stamp quotes as "sent", so we flip the invoice
  // status ourselves up front; that also moves the card to "Out for payment"
  // even when there's no email/phone on file to deliver to.
  async function doFinishDraft(e: Event) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/invoices/${inv.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "sent",
          ...(inv.issuedDate
            ? {}
            : { issuedDate: new Date().toISOString().slice(0, 10) }),
        }),
      });
      // Deliver over both channels — the backend handles "no email/phone on
      // file" gracefully; the invoice still lands in "Out for payment".
      await dispatchInvoice(inv.id);
      globalThis.location.reload();
    } finally {
      setBusy(false);
    }
  }
  function ctaAction(e: Event) {
    if (inv.stage === "claimed") return doConfirmReceived(e);
    if (inv.stage === "overdue") return doSendText(e);
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
      const r = await fetch(`/api/invoices/${inv.id}/discount`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discountCents: cents }),
      });
      if (r.ok) globalThis.location.reload();
      else setAdjErr(tFor(lang, "invoicesPage.adjust.errDiscountApply"));
    } finally {
      setBusy(false);
    }
  }
  async function loadChangeOrders() {
    try {
      const r = await fetch(`/api/invoices/${inv.id}/change-orders`, {
        credentials: "include",
      });
      if (r.ok) setChangeOrders(await r.json() as ChangeOrderRow[]);
    } catch { /* best-effort — the panel still works without the list */ }
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
      const r = await fetch(`/api/invoices/${inv.id}/change-orders`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: coDesc.trim(),
          deltaAmountCents: cents,
        }),
      });
      if (!r.ok) {
        setAdjErr(tFor(lang, "invoicesPage.adjust.errCoCreate"));
        return;
      }
      const co = await r.json() as { id: string };
      setCoLink(`${globalThis.location.origin}/co/${co.id}`);
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
      </div>
      <div class="qcard__av">{inv.initials}</div>
      <div class="qcard__body">
        <div class="qcard__client-name">{inv.client} · {inv.invoiceRef}</div>
        <h3 class="qcard__title">{fmtMoney(inv.amount)}</h3>
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
          <p class="qcard__read">
            {inv.stage === "overdue" && (
              <>
                {tFor(
                  lang,
                  inv.daysOverdue === 1
                    ? "invoicesPage.read.overdue.one"
                    : "invoicesPage.read.overdue.other",
                  { n: inv.daysOverdue },
                )}
              </>
            )}
            {inv.stage === "out" && (
              <>
                {tFor(lang, "invoicesPage.read.out", {
                  issued: fmtDate(inv.issuedDate ?? inv.createdAt, now, lang),
                  due: fmtDate(inv.dueDate, now, lang),
                })}
              </>
            )}
            {inv.stage === "drafting" && (
              <>
                {tFor(lang, "invoicesPage.read.drafting", {
                  date: fmtDate(inv.issuedDate ?? inv.createdAt, now, lang),
                })}
              </>
            )}
            {inv.stage === "paid" && (
              <>
                {tFor(lang, "invoicesPage.read.paid", {
                  date: fmtDate(inv.paidAt, now, lang),
                })}
              </>
            )}
          </p>
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
                {adjustOpen
                  ? tFor(lang, "invoicesPage.adjust.hide")
                  : `${tFor(lang, "invoicesPage.adjust.open")} ▾`}
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
                                    {fmtMoneyExact(Math.abs(co.deltaAmountCents))}
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
                                          onClick={() => setConfirmDelCoId(null)}
                                          disabled={busy}
                                          style="appearance:none;background:none;border:1px solid var(--border);border-radius:7px;padding:3px 8px;font:inherit;font-size:11.5px;font-weight:700;color:var(--fg-muted);cursor:pointer"
                                        >
                                          {tFor(lang, "common.cancel")}
                                        </button>
                                      </>
                                    )
                                    : (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => startEditCo(co)}
                                          disabled={busy}
                                          style="appearance:none;background:none;border:1px solid var(--border);border-radius:7px;padding:3px 8px;font:inherit;font-size:11.5px;font-weight:700;color:var(--brand-teal);cursor:pointer;white-space:nowrap"
                                        >
                                          {tFor(lang, "invoicesPage.adjust.coEdit")}
                                        </button>
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
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setConfirmDelCoId(co.id)}
                                          disabled={busy}
                                          style="appearance:none;background:none;border:1px solid var(--border);border-radius:7px;padding:3px 8px;font:inherit;font-size:11.5px;font-weight:700;color:#a83b3b;cursor:pointer;white-space:nowrap"
                                        >
                                          {tFor(lang, "invoicesPage.adjust.coDelete")}
                                        </button>
                                      </>
                                    )}
                                </div>
                                {coReapprovedId === co.id && (
                                  <div style="font-size:11.5px;color:var(--brand-green);font-weight:600">
                                    {tFor(lang, "invoicesPage.adjust.coReapproved")}
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
        <div class="qcard__back-foot">
          <button
            type="button"
            onClick={ctaAction}
            disabled={busy}
            data-cy={`invoice-back-cta-${inv.stage}`}
          >
            {busy ? "…" : cta.replace(/ →$/, "")}
          </button>
          <button type="button" onClick={doOpenInvoice}>
            {tFor(lang, "invoicesPage.back.open")}
          </button>
          {inv.stage === "claimed" && (
            <button
              type="button"
              onClick={doRejectClaim}
              disabled={busy}
              data-cy="invoice-reject-claim"
              title={tFor(lang, "invoicesPage.back.rejectTitle")}
            >
              {tFor(lang, "invoicesPage.back.reject")}
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

/* ---------------- New invoice modal ---------------- */

const NEW_SENTINEL = "__new__";

/** Create a standalone invoice — no quote/contract behind it. Pick (or add)
 *  a client, set an amount + due date, and it lands as a draft in the
 *  Drafting track. Mirrors the add-client modal pattern on /clients. */
function NewInvoiceModal(
  { customers, lang, onClose }: {
    customers: Customer[];
    lang: Lang;
    onClose: () => void;
  },
) {
  const [clientSel, setClientSel] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [jobName, setJobName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whether the chosen client is reachable — gates the "Create & send" button
  // (a send with no email/phone on file would just no-op).
  const selectedCustomer = clientSel && clientSel !== NEW_SENTINEL
    ? customers.find((c) => c.id === clientSel)
    : undefined;
  const canSend = clientSel === NEW_SENTINEL
    ? !!(newEmail.trim() || newPhone.trim())
    : !!(selectedCustomer?.email || selectedCustomer?.phoneNumber);

  const labelStyle =
    "display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)";
  const inputStyle =
    "padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)";

  async function submit(send: boolean) {
    if (busy) return;
    const cents = Math.round(Number(amount) * 100);
    if (!cents || cents <= 0) {
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
      if (clientSel === NEW_SENTINEL) {
        const created = await clientsClient.create({
          name: newName.trim(),
          ...(newPhone.trim() ? { phoneNumber: newPhone.trim() } : {}),
          ...(newEmail.trim() ? { email: newEmail.trim() } : {}),
        });
        customerId = created.id;
      } else if (clientSel) {
        customerId = clientSel;
      }
      const invoice = await dashboardClient.createInvoice({
        ...(customerId ? { customerId } : {}),
        amount: cents,
        dueDate,
        issuedDate: new Date().toISOString().slice(0, 10),
        // Send → mark it sent up front (the send coordinators don't stamp
        // invoice status); draft → lands in the Drafting track to send later.
        status: send ? "sent" : "draft",
        ...(jobName.trim() ? { jobName: jobName.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      // One-step send: dispatch the pay link over both channels. The backend
      // handles "no email/phone on file" gracefully.
      if (send && invoice?.id) {
        await dispatchInvoice(invoice.id);
      }
      // Reload so the new invoice enriches into the right track.
      globalThis.location.reload();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tFor(lang, "invoicesPage.new.errCreate"),
      );
      setBusy(false);
    }
  }
  function onFormSubmit(e: Event) {
    e.preventDefault();
    submit(canSend);
  }

  return (
    <div
      onClick={() => !busy && onClose()}
      style="position:fixed;inset:0;background:rgba(20,40,45,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px"
    >
      <form
        data-cy="new-invoice-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onFormSubmit}
        style="background:#fff;border-radius:16px;padding:24px 26px;max-width:460px;width:100%;box-shadow:0 24px 64px rgba(20,72,82,0.22);display:flex;flex-direction:column;gap:14px"
      >
        <h2 style="margin:0;font-size:20px;font-weight:800;color:var(--fg,#144852)">
          {tFor(lang, "invoicesPage.new.title")}
        </h2>
        <p style="margin:0;font-size:13px;color:var(--fg-muted,#6b7560)">
          {tFor(lang, "invoicesPage.new.intro")}
        </p>

        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.new.client")}
          <select
            data-cy="new-invoice-client"
            value={clientSel}
            disabled={busy}
            onInput={(e) => setClientSel((e.target as HTMLSelectElement).value)}
            style={inputStyle}
          >
            <option value="">
              {tFor(lang, "invoicesPage.new.clientNone")}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value={NEW_SENTINEL}>
              {tFor(lang, "invoicesPage.new.newClient")}
            </option>
          </select>
        </label>

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
                value={newPhone}
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
            placeholder={tFor(lang, "invoicesPage.new.jobNamePlaceholder")}
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

        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.new.amount")}
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            data-cy="new-invoice-amount"
            placeholder="0.00"
            value={amount}
            disabled={busy}
            onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.new.dueDate")}
          <input
            type="date"
            data-cy="new-invoice-due"
            value={dueDate}
            disabled={busy}
            onInput={(e) => setDueDate((e.target as HTMLInputElement).value)}
            style={inputStyle}
          />
        </label>

        {error && (
          <p
            role="alert"
            style="margin:0;color:#a83b3b;font-size:13.5px;font-weight:600"
          >
            {error}
          </p>
        )}

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
            {tFor(lang, "invoicesPage.new.saveDraft")}
          </button>
          <button
            type="submit"
            data-cy="new-invoice-submit"
            disabled={busy || !canSend}
            title={!canSend
              ? tFor(lang, "invoicesPage.new.needContact")
              : undefined}
            style={`padding:10px 20px;border:0;border-radius:10px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;cursor:${
              canSend ? "pointer" : "not-allowed"
            };opacity:${canSend ? "1" : "0.55"}`}
          >
            {busy
              ? tFor(lang, "invoicesPage.new.sending")
              : tFor(lang, "invoicesPage.new.createSend")}
          </button>
        </div>
        {!canSend && (
          <p style="margin:0;font-size:12px;color:var(--fg-muted,#6b7560);text-align:right">
            {tFor(lang, "invoicesPage.new.needContact")}
          </p>
        )}
      </form>
    </div>
  );
}
