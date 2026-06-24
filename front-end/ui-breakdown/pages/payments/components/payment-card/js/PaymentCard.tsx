/* Extracted verbatim from islands/PaymentsPage.tsx (STATUS_MOOD + PaymentCard).
 * A `.qcard` flip card for a single recorded payment. Front shows method
 * glyph, client·invoiceRef, amount, a human note, a no-op CTA, and a
 * method/ETA value cell. Back shows the trail + three no-op action buttons
 * (Receipt / Match invoice / Text client). The only client state is `flipped`;
 * NONE of the buttons mutate — see payment-card.md §1. Depends on
 * METHOD_ICON / methodLabel from PaymentsPage.tsx (lines 65–144). */
import { useState } from "preact/hooks";
import { I, ICN } from "../../payments-page/js/dash-icons.tsx";
import { fmtMoney } from "../../payments-page/js/format.ts";
import { type Lang, tFor } from "../../../../../../lib/i18n.ts";
// NOTE: EnrichedPayment, PaymentStatus, PaymentMethod, METHOD_ICON and
// methodLabel are defined in ../../payments-page/js/PaymentsPage.tsx
// (lines 65–260). Imported here as types/values in the real island; reproduced
// inline below only as the structural reference for this folder.

type PaymentStatus = "landed" | "transit" | "attention";

const STATUS_MOOD: Record<
  PaymentStatus,
  { from: string; to: string; shadow: string; statusFg: string }
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

// deno-lint-ignore no-explicit-any
export function PaymentCard(
  { lang, p, idx, METHOD_ICON, methodLabel }: {
    lang: Lang;
    p: any; // EnrichedPayment — see PaymentsPage.tsx line 148
    idx: number;
    // deno-lint-ignore no-explicit-any
    METHOD_ICON: Record<string, any>;
    methodLabel: (lang: Lang, m: string) => string;
  },
) {
  const [flipped, setFlipped] = useState(false);
  const mood = STATUS_MOOD[p.status as PaymentStatus];
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
