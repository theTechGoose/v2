/**
 * REQ-054/055 — the plan cards: the /welcome wizard's plan step and the Plan card on /settings
 * render these same cards (name, price, the first three features), styled by /plan-cards.css.
 * A card is the pick: clicking it chooses the plan — and for a paid one opens the pay page.
 */
import type { PricingPlan } from "../../shared/quote-flow/pricing-plans.ts";
import { type Lang, tFor } from "../lib/i18n.ts";

export function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

export function PlanCards({ plans, lang, featuredId, disabled, onPick }: {
  plans: readonly PricingPlan[];
  lang: Lang;
  /** the card drawn as the recommended one */
  featuredId?: string;
  disabled: (plan: PricingPlan) => boolean;
  onPick: (planId: string) => void;
}) {
  return (
    <div class="plan-cards">
      {plans.map((p) => (
        <button
          key={p.id}
          type="button"
          class={`plan-card${p.id === featuredId ? " plan-card--featured" : ""}`}
          data-cy={`plan-pick-${p.id}`}
          onClick={() => onPick(p.id)}
          disabled={disabled(p)}
        >
          <span class="plan-card__name">{p.name}</span>
          <span class="plan-card__price">
            {p.priceCents === 0 ? tFor(lang, "welcome.plan.free") : dollars(p.priceCents)}
            {p.priceCents > 0 ? <small>{tFor(lang, "welcome.plan.perMonth")}</small> : null}
          </span>
          <ul class="plan-card__features">
            {p.features.slice(0, 3).map((f) => <li key={f.id}>{lang === "es" ? f.es : f.en}</li>)}
          </ul>
        </button>
      ))}
    </div>
  );
}
