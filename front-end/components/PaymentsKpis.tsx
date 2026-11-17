/**
 * The /payments KPI strip (`.qkpi`, styled by static/quotes.css): landed this
 * month, in transit, needs attention, average days to land. Rendered by
 * islands/PaymentsPage.tsx; a plain component so it can be rendered on its own.
 */
import { fmtMoney } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";

/** Plural helper bound to an explicit language. */
const tnFor = (lang: Lang, key: string, n: number): string =>
  tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n });

export default function PaymentsKpis(
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
    /** REQ-562: average days to pay over landed payments; null = none landed
     *  (0 is a real average: paid the same day). */
    avgDays: number | null;
  },
) {
  return (
    <div class="qkpi">
      <div class="qkpi__cell">
        <div class="qkpi__lbl">
          {tFor(lang, "paymentsPage.kpi.landedLabel")}
        </div>
        <div class="qkpi__val">{fmtMoney(monthTotal)}</div>
        <div class="qkpi__sub">
          {tnFor(lang, "paymentsPage.kpi.payments", landedCount)}
        </div>
      </div>
      {
        /* REQ-408 (demo p13-a): the pink accent marks money actually on its
          way; with nothing in transit the cell is a plain one, not an alert. */
      }
      <div
        class={transitCount > 0
          ? "qkpi__cell qkpi__cell--accent"
          : "qkpi__cell"}
        data-cy="payments-kpi-transit"
      >
        <div class="qkpi__lbl">
          {tFor(lang, "paymentsPage.kpi.transitLabel")}
        </div>
        <div class="qkpi__val">
          {transitCount > 0 ? fmtMoney(transitTotal) : "—"}
        </div>
        <div class="qkpi__sub">
          {transitCount > 0
            ? tFor(lang, "paymentsPage.kpi.onTheWay", { n: transitCount })
            : tFor(lang, "paymentsPage.kpi.nothingInTransit")}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">
          {tFor(lang, "paymentsPage.kpi.attentionLabel")}
        </div>
        <div class="qkpi__val" data-cy="payments-kpi-attention">
          {attentionCount}
        </div>
        <div class="qkpi__sub">
          {tFor(lang, "paymentsPage.kpi.heldUp", {
            amount: fmtMoney(attentionTotal),
          })}
        </div>
      </div>
      <div class="qkpi__cell" data-cy="payments-kpi-avg">
        <div class="qkpi__lbl">{tFor(lang, "paymentsPage.kpi.avgLabel")}</div>
        <div class="qkpi__val">
          {avgDays !== null
            ? tFor(lang, "paymentsPage.value.days", { n: avgDays })
            : "—"}
        </div>
        <div class="qkpi__sub">
          {avgDays === null
            ? tFor(lang, "paymentsPage.kpi.noHistory")
            : avgDays === 0
            ? tFor(lang, "paymentsPage.kpi.sameDay")
            : tFor(lang, "paymentsPage.kpi.acrossLanded")}
        </div>
      </div>
    </div>
  );
}
