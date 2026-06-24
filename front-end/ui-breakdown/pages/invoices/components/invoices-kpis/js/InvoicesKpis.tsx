/* Extracted verbatim from islands/InvoicesPage.tsx (`InvoicesKpis`). The
 * 4-cell `.qkpi` strip: Overdue (accent when count>0) · Out for payment ·
 * Drafting · Paid this month. Pure presentational — all numbers are props. */
import { fmtMoney } from "../../invoices-page/js/format.ts";
import { type Lang, tFor } from "../../../../../../lib/i18n.ts";

export function InvoicesKpis(
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
