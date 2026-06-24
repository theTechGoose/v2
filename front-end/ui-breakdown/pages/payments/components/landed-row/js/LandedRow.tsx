/* Extracted verbatim from islands/PaymentsPage.tsx (`LandedRow`). Compact
 * "tail of month" row in the `.qdone` grid for older-than-1-day landed
 * payments — a won-style check badge, client name, method·when·invoiceRef
 * sub, and the amount. Pure presentational; no state, no actions. */
import { I, ICN } from "../../payments-page/js/dash-icons.tsx";
import { fmtMoney } from "../../payments-page/js/format.ts";
import { type Lang, tFor } from "../../../../../../lib/i18n.ts";

// deno-lint-ignore no-explicit-any
export function LandedRow(
  { lang, p, methodLabel }: {
    lang: Lang;
    p: any; // EnrichedPayment — see PaymentsPage.tsx line 148
    methodLabel: (lang: Lang, m: string) => string;
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
          {methodLabel(lang, p.method)} · {p.whenLabel} · {p.invoiceRef}
        </div>
      </div>
      <div class="qdone__amt">{fmtMoney(p.amount)}</div>
    </div>
  );
}
