import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { loadUser } from "../lib/auth.ts";
import { pickLangFromAcceptLanguage, STRINGS, type Lang } from "../lib/lang.ts";
import CodeInput from "../islands/CodeInput.tsx";

function formatPhoneDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return e164;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default define.page(async function Verify(ctx) {
  const url = new URL(ctx.req.url);
  const phone = url.searchParams.get("phone");
  if (!phone) return new Response(null, { status: 302, headers: { Location: "/" } });

  const user = await loadUser(ctx.req);
  if (user) return new Response(null, { status: 302, headers: { Location: "/dashboard" } });

  const lang: Lang = pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
  const s = STRINGS[lang];
  const display = formatPhoneDisplay(phone);

  return (
    <>
      <Head>
        <title>{s["verify.h1"]} · Paperwork Monsters</title>
        <link rel="stylesheet" href="/verify.css" />
      </Head>
      <div class="verify-shell">
        <div class="verify-card">
          <a href="/" class="brand" style="margin:0 auto 4px">
            <img src="/logo-monster.png" alt="Paperwork Monsters" style="width:38px;height:38px;flex-shrink:0" />
            <span>Paperwork</span>
            <em style="font-style:normal;color:var(--brand-green)">Monsters</em>
          </a>
          <ol class="pm-steps" aria-label="Sign-in steps">
            <li class="pm-steps__item pm-steps__item--done">
              <span class="pm-steps__dot">✓</span>
              <span class="pm-steps__label">{s["cta.steps.phone"]}</span>
            </li>
            <span class="pm-steps__bar pm-steps__bar--done" aria-hidden="true"></span>
            <li class="pm-steps__item pm-steps__item--active" id="pm-step-code">
              <span class="pm-steps__dot">2</span>
              <span class="pm-steps__label">{s["cta.steps.code"]}</span>
            </li>
            <span class="pm-steps__bar" aria-hidden="true" id="pm-step-bar-2"></span>
            <li class="pm-steps__item" id="pm-step-in">
              <span class="pm-steps__dot">3</span>
              <span class="pm-steps__label">{s["cta.steps.in"]}</span>
            </li>
          </ol>
          <h1 style="font-size:32px;margin-top:6px">{s["verify.h1"]}</h1>
          <p class="muted" style="color:var(--fg-muted);font-size:16px">
            {s["verify.lede"]} <strong style="color:var(--fg)">{display}</strong>
          </p>
          <CodeInput phoneNumber={phone} initialLang={lang} />
        </div>
      </div>
    </>
  );
});
