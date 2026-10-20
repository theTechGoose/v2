import { useEffect, useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { planClient, type UserPlan } from "../clients/profile.ts";
import { handoffNext, handoffOf, type PickBack } from "../lib/plan-return.ts";
import { PRICING_PLANS } from "../../shared/quote-flow/pricing-plans.ts";
import { dollars } from "../components/PlanCards.tsx";

/** how often the plan is asked for while its page is being prepared */
const POLL_MS = 1000;
/** after this long the page says it is taking longer than usual (the link builder's cold start
 *  and its Quickbase writes take a few seconds; more means something is being retried) */
const SLOW_AFTER_MS = 15_000;

/**
 * PayHandoff (REQ-106) — the one thing the hand-off page does: ask for the plan every second and
 * go to the pay page the moment the sweep has put it on the record. A refusal by name goes back to
 * the page the pick came from saying why; a plan no longer pending (free picked elsewhere, or
 * already active) goes on to the page after a pick. Meanwhile it says what is happening, names
 * the plan once it has read it, and offers the way back. Nothing to click.
 */
export default function PayHandoff({ lang, back }: { lang: Lang; back: PickBack }) {
  const [plan, setPlan] = useState<UserPlan | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const t0 = Date.now();
    async function poll() {
      if (stopped) return;
      try {
        const read = await planClient.get();
        if (stopped) return;
        setPlan(read);
        const next = handoffNext(read, back);
        if (next) {
          stopped = true;
          location.replace(next);
          return;
        }
      } catch {
        // a blip on the way: ask again
      }
      if (Date.now() - t0 > SLOW_AFTER_MS) setSlow(true);
      timer = setTimeout(poll, POLL_MS) as unknown as number;
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const state = handoffOf(plan);
  const pricing = plan ? PRICING_PLANS.find((p) => p.id === plan.planId) : undefined;
  const waiting = state === "unavailable" || slow;
  return (
    <div data-cy="plan-handoff" data-state={state} style="display:grid;gap:12px;justify-items:center;text-align:center">
      <style>{`@keyframes plan-handoff-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        aria-hidden="true"
        style="width:44px;height:44px;border-radius:50%;border:4px solid var(--border, #e5e7eb);border-top-color:var(--brand-green, #16a34a);animation:plan-handoff-spin 0.9s linear infinite"
      />
      <h1 style="font-size:26px;margin:0">{tFor(lang, "planHandoff.heading")}</h1>
      {pricing
        ? (
          <p data-cy="plan-handoff-plan" style="font-weight:700;margin:0">
            {pricing.name} · {dollars(pricing.priceCents)}
          </p>
        )
        : null}
      <p role="status" aria-live="polite" style="color:var(--fg-muted);font-size:15px;margin:0">
        {tFor(lang, waiting ? "planHandoff.slow" : "planHandoff.lede")}
      </p>
      <p style="margin:0">
        <a href={back} data-cy="plan-handoff-back">{tFor(lang, "planHandoff.back")}</a>
      </p>
    </div>
  );
}
