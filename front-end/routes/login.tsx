import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { loadUser } from "../lib/auth.ts";
import { type Lang, pickLangFromAcceptLanguage } from "../lib/lang.ts";
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
  const es = lang === "es";

  return (
    <>
      <Head>
        <title>{es ? "Iniciar sesión" : "Log in"} · Paperwork Monster</title>
        <link rel="stylesheet" href="/verify.css" />
      </Head>
      <div class="verify-shell">
        <div class="verify-card">
          <a href="/" class="brand" style="margin:0 auto 8px">
            <img
              src="/logo-monster.png"
              alt="Paperwork Monster"
              style="width:38px;height:38px;flex-shrink:0"
            />
            <span>Paperwork</span>
            <em style="font-style:normal;color:var(--brand-green)">Monster</em>
          </a>
          <h1 style="font-size:32px;margin-top:6px">
            {es ? "Iniciar sesión" : "Welcome back"}
          </h1>
          <p
            class="muted"
            style="color:var(--fg-muted);font-size:16px;margin-bottom:20px"
          >
            {es
              ? "Entra con tu número de celular."
              : "Sign in with your phone number."}
          </p>
          <LoginForm />
        </div>
      </div>
    </>
  );
});
