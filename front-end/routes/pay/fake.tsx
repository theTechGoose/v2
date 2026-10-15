import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, langFromCookie, pickLangFromAcceptLanguage } from "../../lib/lang.ts";
import { tFor } from "../../lib/i18n.ts";
import FakePayPage from "../../islands/FakePayPage.tsx";

/**
 * /pay/fake (REQ-057) — the stand-in for the CRM's pay page while the app runs on fakes: the
 * fake link builder mints this url for a paid pick (backend users/domain/data/payments-link).
 * It names the customer and the due the link carries, shows the sandbox test card, and its
 * one Pay button settles the due the way a card on the real page does, then goes back where the
 * link said (REQ-059). Production never mints it (the fake is refused at boot there, REQ-054),
 * so it is unlinked and noindex.
 */
export default define.page(function PayFake(ctx) {
  const lang: Lang = langFromCookie(ctx.req.headers.get("cookie")) ??
    pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
  const customer = ctx.url.searchParams.get("customer") ?? "";
  const due = ctx.url.searchParams.get("due") ?? "";
  // REQ-059 — the way back the link carried (the fake mints it like the CRM does), if any
  const returnUrl = ctx.url.searchParams.get("return") ?? "";
  const returnLabel = ctx.url.searchParams.get("label") ?? "";
  return (
    <>
      <Head>
        <title>
          {tFor(lang, "payFake.title")} · {tFor(lang, "brand.name")}
        </title>
        <meta name="robots" content="noindex" />
        <link key="css-verify" rel="stylesheet" href="/verify.css" />
      </Head>
      <div class="verify-shell">
        <div class="verify-card">
          <a href="/" class="brand" style="margin:0 auto 8px">
            <img src="/logo-monster.png" alt={tFor(lang, "brand.name")} style="width:38px;height:38px;flex-shrink:0" />
            <span>
              {tFor(lang, "brand.namePrefix")}
              <em style="font-style:normal;color:var(--brand-green)">{tFor(lang, "brand.nameSuffix")}</em>
            </span>
          </a>
          <h1 style="font-size:28px;margin-top:6px">{tFor(lang, "payFake.heading")}</h1>
          <p class="muted" style="color:var(--fg-muted);font-size:15px;margin-bottom:16px">
            {tFor(lang, "payFake.lede", { customer: customer.slice(0, 8), due: due.slice(0, 8) })}
          </p>
          <FakePayPage lang={lang} customer={customer} due={due} returnUrl={returnUrl} returnLabel={returnLabel} />
          <SiteFooter lang={lang} />
        </div>
      </div>
    </>
  );
});
