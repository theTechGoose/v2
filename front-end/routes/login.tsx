import { page } from "fresh";
import { asset, Head } from "fresh/runtime";
import { define } from "../utils.ts";
import DocTitle from "../components/DocTitle.tsx";
import SiteFooter from "../components/SiteFooter.tsx";
import { loadUser } from "../lib/auth.ts";
import type { Lang } from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";
import { resolvePageLang } from "../lib/page-lang.ts";
import { pickedLangHeaders } from "../lib/public-page.ts";
import { langToggleHref } from "../../shared/quote-flow/public-lang.ts";
import LoginForm from "../islands/LoginForm.tsx";
import PublicLangToggle from "../islands/PublicLangToggle.tsx";

/**
 * /login — a clean, dedicated login screen (roadmap p.13). Reuses the
 * existing phone → OTP → /verify flow; already-authenticated visitors are
 * bounced to the dashboard.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const user = await loadUser(ctx.req);
    if (user) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/dashboard" },
      });
    }

    // REQ-414 (demo p4): the public pages' ONE resolver — the EN | ES
    // toggle's ?lang= link wins and is persisted to pm_lang, then the saved
    // choice (picked on the landing or here), then the Spanish-first default.
    // Recorded on ctx.state.lang so <html lang> and the LoginForm island
    // render in the language the page paints.
    const { lang, picked } = resolvePageLang(ctx.req);
    ctx.state.lang = lang;
    return page({ lang }, { headers: pickedLangHeaders(picked) });
  },
});

export default define.page<typeof handler>(function Login(ctx) {
  const lang: Lang = ctx.data.lang;
  return (
    <>
      <Head>
        <link key="css-public-lang" rel="stylesheet" href={asset("/public-lang.css")} />
        <DocTitle
          lang={lang}
          title={(l) => `${tFor(l, "loginPage.title")} · ${tFor(l, "brand.name")}`}
        />
        <link key="css-verify" rel="stylesheet" href={asset("/verify.css")} />
      </Head>
      <div class="verify-shell">
        <div class="verify-card">
          <PublicLangToggle
            lang={lang}
            hrefs={{
              en: langToggleHref(ctx.req.url, "en"),
              es: langToggleHref(ctx.req.url, "es"),
            }}
          />
          <a href="/" class="brand" style="margin:0 auto 8px">
            <img
              src="/logo-monster.png"
              alt={tFor(lang, "brand.name")}
              style="width:38px;height:38px;flex-shrink:0"
            />
            <span>
              {tFor(lang, "brand.namePrefix")}
              <em style="font-style:normal;color:var(--brand-green)">{tFor(lang, "brand.nameSuffix")}</em>
            </span>
          </a>
          <h1 style="font-size:32px;margin-top:6px">
            {tFor(lang, "loginPage.heading")}
          </h1>
          <p
            class="muted"
            style="color:var(--fg-muted);font-size:16px;margin-bottom:20px"
          >
            {tFor(lang, "loginPage.subtitle")}
          </p>
          <LoginForm />
        </div>
        <SiteFooter lang={lang} />
      </div>
    </>
  );
});
