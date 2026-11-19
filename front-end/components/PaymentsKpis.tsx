/**
 * The /payments KPI strip (`.qkpi`, styled by static/quotes.css): landed this
 * month, charged back (REQ-926; was In transit), needs attention, average
 * days to land. Rendered by
 * islands/PaymentsPage.tsx; a plain component so it can be rendered on its own.
 */
import { fmtMoneyTotal } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";

/** Plural helper bound to an explicit language. */
const tnFor = (lang: Lang, key: string, n: number): string =>
  tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n });

export default function PaymentsKpis(
  {
    lang,
    landedCount,
    monthTotal,
    reversedCount,
    reversedTotal,
    attentionCount,
    attentionTotal,
    avgDays,
  }: {
    lang: Lang;
    landedCount: number;
    monthTotal: number;
    /** REQ-926: charged-back payments — kept, outside every total */
    reversedCount: number;
    reversedTotal: number;
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
        <div class="qkpi__val">{fmtMoneyTotal(monthTotal)}</div>
        <div class="qkpi__sub">
          {tnFor(lang, "paymentsPage.kpi.payments", landedCount)}
        </div>
      </div>
      {/* REQ-926: In transit is gone; charged back, a plain cell (REQ-408) */}
      <div class="qkpi__cell" data-cy="payments-kpi-reversed">
        <div class="qkpi__lbl">
          {tFor(lang, "paymentsPage.kpi.reversedLabel")}
        </div>
        <div class="qkpi__val">
          {reversedCount > 0 ? fmtMoneyTotal(reversedTotal) : "—"}
        </div>
        <div class="qkpi__sub">
          {reversedCount > 0
            ? tnFor(lang, "paymentsPage.kpi.reversedSub", reversedCount)
            : tFor(lang, "paymentsPage.kpi.nothingReversed")}
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
            amount: fmtMoneyTotal(attentionTotal),
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
