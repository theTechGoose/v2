import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { loadUser } from "../lib/auth.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
  STRINGS,
} from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";
import CodeInput from "../islands/CodeInput.tsx";

function formatPhoneDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return e164;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default define.page(async function Verify(ctx) {
  const url = new URL(ctx.req.url);
  const phone = url.searchParams.get("phone");
  if (!phone) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }

  const user = await loadUser(ctx.req);
  if (user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    });
  }

  // Honor the user's saved choice (cookie) first — the browser's
  // Accept-Language is only the first-visit fallback. Without this the static
  // SSR copy renders in the browser locale while the island re-renders from
  // localStorage, leaving the screen half-English / half-Spanish.
  const lang: Lang = langFromCookie(ctx.req.headers.get("cookie")) ??
    pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
  const s = STRINGS[lang];
  const display = formatPhoneDisplay(phone);

  // P-39: "Wrong number? Edit" returns to the form the user came from.
  // Origin travels as ?from= (set by the /landing trial form) so it
  // survives reload. Allowlisted — never reflect an arbitrary URL.
  // "#trial" jumps straight to the phone-form section on /landing.
  const editHref = url.searchParams.get("from") === "landing"
    ? "/landing#trial"
    : "/";

  return (
    <>
      <Head>
        <title>{s["verify.h1"]} · {tFor(lang, "brand.name")}</title>
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
          <ol class="pm-steps" aria-label={tFor(lang, "verify.steps.aria")}>
            <li class="pm-steps__item pm-steps__item--done">
              <span class="pm-steps__dot">✓</span>
              <span class="pm-steps__label">{s["cta.steps.phone"]}</span>
            </li>
            <span class="pm-steps__bar pm-steps__bar--done" aria-hidden="true">
            </span>
            <li class="pm-steps__item pm-steps__item--active" id="pm-step-code">
              <span class="pm-steps__dot">2</span>
              <span class="pm-steps__label">{s["cta.steps.code"]}</span>
            </li>
            <span class="pm-steps__bar" aria-hidden="true" id="pm-step-bar-2">
            </span>
            <li class="pm-steps__item" id="pm-step-in">
              <span class="pm-steps__dot">3</span>
              <span class="pm-steps__label">{s["cta.steps.in"]}</span>
            </li>
          </ol>
          <h1 style="font-size:32px;margin-top:6px">{s["verify.h1"]}</h1>
          <p class="muted" style="color:var(--fg-muted);font-size:16px">
            {s["verify.lede"]}{" "}
            <strong style="color:var(--fg)">{display}</strong>
          </p>
          <CodeInput
            phoneNumber={phone}
            initialLang={lang}
            editHref={editHref}
          />
        </div>
      </div>
    </>
  );
});
