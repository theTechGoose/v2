import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import SiteFooter from "../components/SiteFooter.tsx";
import { loadUser } from "../lib/auth.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";
import LoginInternalForm from "../islands/LoginInternalForm.tsx";

/**
 * /login-internal (REQ-050) — sign in with an email instead of a phone; an
 * email no account has yet just creates one. Unlinked on purpose (an internal entry); the same card as
 * /login with an email field, then /verify-internal for the code.
 * Already-authenticated visitors are bounced to the dashboard.
 */
export default define.page(async function LoginInternal(ctx) {
  const user = await loadUser(ctx.req);
  if (user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    });
  }

  const lang: Lang = langFromCookie(ctx.req.headers.get("cookie")) ??
    pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
  return (
    <>
      <Head>
        <title>
          {tFor(lang, "loginInternal.title")} · {tFor(lang, "brand.name")}
        </title>
        <meta name="robots" content="noindex" />
        <link rel="stylesheet" href="/verify.css" />
      </Head>
      <div class="verify-shell">
        <div class="verify-card">
          <a href="/" class="brand" style="margin:0 auto 8px">
            <img
              src="/logo-monster.png"
              alt={tFor(lang, "brand.name")}
              style="width:38px;height:38px;flex-shrink:0"
            />
            <span>{tFor(lang, "brand.namePrefix")}</span>
            <em style="font-style:normal;color:var(--brand-green)">
              {tFor(lang, "brand.nameSuffix")}
            </em>
          </a>
          <h1 style="font-size:32px;margin-top:6px">
            {tFor(lang, "loginInternal.heading")}
          </h1>
          <p
            class="muted"
            style="color:var(--fg-muted);font-size:16px;margin-bottom:20px"
          >
            {tFor(lang, "loginInternal.subtitle")}
          </p>
          <LoginInternalForm />
          <SiteFooter lang={lang} />
        </div>
      </div>
    </>
  );
});
