/**
 * REQ-054/055 — the plan cards: the /welcome wizard's plan step and the Plan card on /settings
 * render these same cards (name, price, the first three features), styled by /plan-cards.css.
 * A card is the pick: each one is a form posting to /plan/pick (REQ-059), whose answer is a
 * redirect — the CRM's pay page in this tab for a paid plan, back to the page for free — so the
 * cards work before any island hydrates and no script has to open anything.
 */
import type { PricingPlan } from "../../shared/quote-flow/pricing-plans.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import type { PickBack } from "../lib/plan-return.ts";

export function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

export function PlanCards(
  { plans, lang, featuredId, disabled, back, merchant }: {
    plans: readonly PricingPlan[];
    lang: Lang;
    /** the card drawn as the recommended one */
    featuredId?: string;
    disabled: (plan: PricingPlan) => boolean;
    /** the page showing the cards — where a free pick (or a refused one) comes back to */
    back: PickBack;
    /** REQ-064 — the merchant account the pick names (the test page's query param); "" = none */
    merchant?: string;
  },
) {
  return (
    <div class="plan-cards">
      {plans.map((p) => (
        <form
          key={p.id}
          method="post"
          action="/plan/pick"
          class="plan-card-form"
        >
          <input type="hidden" name="planId" value={p.id} />
          <input type="hidden" name="back" value={back} />
          {merchant
            ? <input type="hidden" name="merchant" value={merchant} />
            : null}
          <button
            type="submit"
            class={`plan-card${
              p.id === featuredId ? " plan-card--featured" : ""
            }`}
            data-cy={`plan-pick-${p.id}`}
            disabled={disabled(p)}
          >
            <span class="plan-card__name">{p.name}</span>
            <span class="plan-card__price">
              {p.priceCents === 0
                ? tFor(lang, "welcome.plan.free")
                : dollars(p.priceCents)}
              {p.priceCents > 0
                ? (
                  <small>
                    {tFor(
                      lang,
                      p.period === "one-time"
                        ? "welcome.plan.oneTime"
                        : "welcome.plan.perMonth",
                    )}
                  </small>
                )
                : null}
            </span>
            <ul class="plan-card__features">
              {p.features.slice(0, 3).map((f) => (
                <li key={f.id}>{lang === "es" ? f.es : f.en}</li>
              ))}
            </ul>
          </button>
        </form>
      ))}
    </div>
  );
}
