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
import CodeInput from "../islands/CodeInput.tsx";

/**
 * /verify-internal?email=… (REQ-050) — the 6-digit step of the email login.
 * The same code widget as /verify, checking against /auth/verify-email-otp;
 * "Wrong email? Edit" returns to /login-internal.
 */
export default define.page(async function VerifyInternal(ctx) {
  const url = new URL(ctx.req.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/login-internal" },
    });
  }

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
          {tFor(lang, "verifyInternal.h1")} · {tFor(lang, "brand.name")}
        </title>
        <meta name="robots" content="noindex" />
        <link rel="stylesheet" href="/verify.css" />
      </Head>
      <div class="verify-shell">
        <div class="verify-card">
          <a href="/" class="brand" style="margin:0 auto 4px">
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
            {tFor(lang, "verifyInternal.h1")}
          </h1>
          <p class="muted" style="color:var(--fg-muted);font-size:16px">
            {tFor(lang, "verifyInternal.lede")}{" "}
            <strong style="color:var(--fg)" data-cy="verify-email">
              {email}
            </strong>
          </p>
          <CodeInput
            email={email}
            initialLang={lang}
            editHref="/login-internal"
            editLabel={tFor(lang, "verifyInternal.editEmail")}
          />
          <SiteFooter lang={lang} />
        </div>
      </div>
    </>
  );
});
