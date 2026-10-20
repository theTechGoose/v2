import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId, loadUser } from "../../lib/auth.ts";
import { ssrBackendGetAuthed } from "../../lib/backend-fetch.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, langFromCookie, pickLangFromAcceptLanguage } from "../../lib/lang.ts";
import { tFor } from "../../lib/i18n.ts";
import type { UserPlan } from "../../clients/profile.ts";
import { backOf, handoffNext } from "../../lib/plan-return.ts";
import { PRICING_PLANS } from "../../../shared/quote-flow/pricing-plans.ts";
import { dollars } from "../../components/PlanCards.tsx";
import PayHandoff from "../../islands/PayHandoff.tsx";

/**
 * /plan/pay (REQ-106) — the hand-off between a paid pick and the CRM's pay page. Raphael,
 * 2026-10-20: "when i click a plan in the onboarding flow the payment link takes FOREVER to load
 * … what i care about is that the user experience is good." The pick answers at once (pending,
 * no page yet) and /plan/pick sends the browser here. The page reads the plan first: a page
 * already on the record (the link builder was quick) is a redirect straight to it and this page
 * is never seen; otherwise the island asks for the plan every second and moves to the pay page
 * the moment the sweep has minted it — the same page the pick used to wait for. `back` is the
 * page the pick came from: where a refusal returns to, saying why, and the way out. Without a
 * session: the front page. Unlinked and noindex: a pick is the only way in.
 */
export default define.page(async function PlanPay(ctx) {
  const user = await loadUser(ctx.req);
  if (!user) return redirect("/");
  const back = backOf(ctx.url.searchParams.get("back") ?? "");
  // the plan as it stands: a page already there, a refusal, or nothing pending goes on at once
  const read = await ssrBackendGetAuthed<UserPlan | null>("/me/plan", getSessionId(ctx.req)).catch(() => null);
  const plan = read?.ok ? read.data ?? null : null;
  const next = read?.ok ? handoffNext(plan, back) : null;
  if (next) return redirect(next);
  const lang: Lang = user.language === "en" || user.language === "es"
    ? user.language
    : langFromCookie(ctx.req.headers.get("cookie")) ?? pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
  const pricing = plan ? PRICING_PLANS.find((p) => p.id === plan.planId) : undefined;
  const planLabel = pricing ? `${pricing.name} · ${dollars(pricing.priceCents)}` : "";
  return (
    <>
      <Head>
        <title>{tFor(lang, "planHandoff.title")} · {tFor(lang, "brand.name")}</title>
        <meta name="robots" content="noindex" />
        <link key="css-verify" rel="stylesheet" href="/verify.css" />
        {/* no script: the page asks again by itself every few seconds (the island does it every second) */}
        <noscript>
          <meta http-equiv="refresh" content="3" />
        </noscript>
      </Head>
      <div class="verify-shell">
        <div class="verify-card" data-cy="plan-handoff-page">
          <a href="/" class="brand" style="margin:0 auto 8px">
            <img src="/logo-monster.png" alt={tFor(lang, "brand.name")} style="width:38px;height:38px;flex-shrink:0" />
            <span>
              {tFor(lang, "brand.namePrefix")}
              <em style="font-style:normal;color:var(--brand-green)">{tFor(lang, "brand.nameSuffix")}</em>
            </span>
          </a>
          <PayHandoff
            back={back}
            planLabel={planLabel}
            text={{
              heading: tFor(lang, "planHandoff.heading"),
              lede: tFor(lang, "planHandoff.lede"),
              slow: tFor(lang, "planHandoff.slow"),
              back: tFor(lang, "planHandoff.back"),
            }}
          />
        </div>
        <SiteFooter lang={lang} />
      </div>
    </>
  );
});

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
