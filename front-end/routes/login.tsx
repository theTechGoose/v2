import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { loadUser } from "../lib/auth.ts";
import { type Lang, pickLangFromAcceptLanguage } from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";
import LoginForm from "../islands/LoginForm.tsx";

/**
 * /login — a clean, dedicated login screen (roadmap p.13). Reuses the
 * existing phone → OTP → /verify flow; already-authenticated visitors are
 * bounced to the dashboard.
 */
export default define.page(async function Login(ctx) {
  const user = await loadUser(ctx.req);
  if (user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    });
  }

  const lang: Lang = pickLangFromAcceptLanguage(
    ctx.req.headers.get("accept-language"),
  );
  return (
    <>
      <Head>
        <title>
          {tFor(lang, "loginPage.title")} · {tFor(lang, "brand.name")}
        </title>
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
      </div>
    </>
  );
});
