import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, langFromCookie, pickLangFromAcceptLanguage } from "../../lib/lang.ts";
import { tFor } from "../../lib/i18n.ts";
import { backOf } from "../../lib/plan-return.ts";
import PayHandoff from "../../islands/PayHandoff.tsx";

/**
 * /plan/pay (REQ-106) — the hand-off between a paid pick and the CRM's pay page. Raphael,
 * 2026-10-20: "when i click a plan in the onboarding flow the payment link takes FOREVER to load
 * … what i care about is that the user experience is good." The pick answers at once (pending,
 * no page yet) and /plan/pick sends the browser here; the island polls the plan and moves to the
 * pay page the moment the sweep has minted it — the same page the pick used to wait for. `back`
 * is the page the pick came from: where a refusal returns to, saying why, and the way out.
 * Without a session: the front page. Unlinked and noindex: a pick is the only way in.
 */
export default define.page(async function PlanPay(ctx) {
  const user = await loadUser(ctx.req);
  if (!user) return new Response(null, { status: 302, headers: { Location: "/" } });
  const lang: Lang = user.language === "en" || user.language === "es"
    ? user.language
    : langFromCookie(ctx.req.headers.get("cookie")) ?? pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
  const back = backOf(ctx.url.searchParams.get("back") ?? "");
  return (
    <>
      <Head>
        <title>{tFor(lang, "planHandoff.title")} · {tFor(lang, "brand.name")}</title>
        <meta name="robots" content="noindex" />
        <link key="css-verify" rel="stylesheet" href="/verify.css" />
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
          <PayHandoff lang={lang} back={back} />
        </div>
        <SiteFooter lang={lang} />
      </div>
    </>
  );
});
