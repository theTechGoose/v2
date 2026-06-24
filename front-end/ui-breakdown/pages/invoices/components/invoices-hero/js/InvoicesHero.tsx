/* Extracted verbatim from islands/InvoicesPage.tsx (the `InvoicesHero`
 * sub-component + its ForecastResult/ForecastEntry types). Editorial `.qph`
 * header — outstanding/forecast headline, sub, at-risk line, and the
 * New-invoice + Export-CSV CTA row. Renders one of five headline variants
 * (truly-empty · fresh · forecast-this-week · forecast-next-week · legacy
 * outstanding-total). */
import { I, ICN } from "../../../../../shared-components/quote-track/js/dash-icons.tsx";
import { fmtMoney } from "../../../../invoices/components/invoices-page/js/format.ts";
import { type Lang, tFor } from "../../../../../../lib/i18n.ts";

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

/** "2026-05-19" → "Tue" / "May 19" — short day-of-week label for the
 *  forecast hero breakdown. Falls back to MMM d when the date is more than a
 *  week out. */
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

export function InvoicesHero(
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
