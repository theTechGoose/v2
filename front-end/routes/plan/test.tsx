import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, langFromCookie, pickLangFromAcceptLanguage } from "../../lib/lang.ts";
import { tFor } from "../../lib/i18n.ts";
import { PRICING_PLANS } from "../../../shared/quote-flow/pricing-plans.ts";
import { PlanCards } from "../../components/PlanCards.tsx";
import { merchantOf } from "../../lib/plan-return.ts";

/**
 * GET /plan/test (REQ-064) — the one page that offers the hidden test tier: a $1 one-time charge
 * through the real pay page, for testing the card flow (and a merchant account) end to end. No
 * link points here. `?merchant=<name>` names the merchant account the charge goes through; it
 * rides on the card's form, on the pick, and onto the pay page's url (ppwk-crm REQ-084).
 * Without a session: the front page. The pick comes back to settings, which reads it paid once.
 */
export default define.page(async function PlanTest(ctx) {
  const user = await loadUser(ctx.req);
  if (!user) return new Response(null, { status: 302, headers: { Location: "/" } });
  const asked = ctx.url.searchParams.get("lang");
  const lang: Lang = asked === "en" || asked === "es"
    ? asked
    : user.language === "en" || user.language === "es"
    ? user.language
    : langFromCookie(ctx.req.headers.get("cookie")) ?? pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
  const merchant = merchantOf(ctx.url.searchParams.get("merchant") ?? "");
  const plans = PRICING_PLANS.filter((p) => p.id === "test");
  const hasEmail = Boolean(user.email?.trim());
  return (
    <>
      <Head>
        <title>{tFor(lang, "planTest.title")} · {tFor(lang, "brand.name")}</title>
        <meta name="robots" content="noindex" />
        <link key="css-verify" rel="stylesheet" href="/verify.css" />
        <link key="css-plan-cards" rel="stylesheet" href="/plan-cards.css" />
      </Head>
      <div class="verify-shell">
        <div class="verify-card" data-cy="plan-test-page" data-merchant={merchant}>
          <h1 style="font-size:28px;margin-top:6px">{tFor(lang, "planTest.heading")}</h1>
          <p class="muted" style="color:var(--fg-muted);font-size:15px;margin-bottom:12px">{tFor(lang, "planTest.lede")}</p>
          <p style="font-size:13.5px;margin-bottom:16px" data-cy="plan-test-merchant">
            {merchant ? tFor(lang, "planTest.merchant", { merchant }) : tFor(lang, "planTest.merchantDefault")}
          </p>
          <PlanCards plans={plans} lang={lang} disabled={(p) => p.priceCents > 0 && !hasEmail} back="/settings" merchant={merchant} />
          {!hasEmail ? <p style="color:var(--fg-muted);font-size:13.5px;margin-top:10px">{tFor(lang, "plan.emailFirstSettings")}</p> : null}
          <SiteFooter lang={lang} />
        </div>
      </div>
    </>
  );
});
