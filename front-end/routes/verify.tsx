import { page } from "fresh";
import { asset, Head } from "fresh/runtime";
import { define } from "../utils.ts";
import DocTitle from "../components/DocTitle.tsx";
import SiteFooter from "../components/SiteFooter.tsx";
import { loadUser } from "../lib/auth.ts";
import { type Lang, STRINGS } from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";
import { resolvePageLang } from "../lib/page-lang.ts";
import { pickedLangHeaders } from "../lib/public-page.ts";
import { langToggleHref } from "../../shared/quote-flow/public-lang.ts";
import PublicLangToggle from "../islands/PublicLangToggle.tsx";
import CodeInput from "../islands/CodeInput.tsx";
import { MetaPixelEvent } from "../components/MetaPixel.tsx";
import { leadEvent } from "../../shared/meta-pixel/pixel.ts";
import { verifyEditHref } from "../lib/verify-edit-href.ts";
import { Icon } from "../components/ui/Icon.tsx";

function formatPhoneDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return e164;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export const handler = define.handlers({
  async GET(ctx) {
    const phone = new URL(ctx.req.url).searchParams.get("phone");
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

    // REQ-414 (demo p4): the public pages' ONE resolver — an explicit ?lang=
    // (the EN | ES toggle, or the language /login's form hands on) wins and is
    // persisted to pm_lang, then the saved choice, then the Spanish-first
    // default. Recorded on ctx.state.lang so the static SSR copy, <html lang>
    // and the CodeInput island all agree — never half-English / half-Spanish.
    const { lang, picked } = resolvePageLang(ctx.req);
    ctx.state.lang = lang;
    return page({ lang, phone }, { headers: pickedLangHeaders(picked) });
  },
});

export default define.page<typeof handler>(function Verify(ctx) {
  const url = new URL(ctx.req.url);
  const { lang, phone } = ctx.data as { lang: Lang; phone: string };
  const s = STRINGS[lang];
  const display = formatPhoneDisplay(phone);

  // P-39 / REQ-351: "Wrong number? Edit" returns to the form the user came
  // from. Every sign-in form sends ?from=<origin> (survives reload); the
  // allow-list in lib/verify-edit-href.ts maps it — never reflect a URL — and
  // a missing/unknown origin goes to /login, not the marketing page.
  const editHref = verifyEditHref(url.searchParams.get("from"));

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => `${STRINGS[l]["verify.h1"]} · ${tFor(l, "brand.name")}`}
        />
        <link key="css-verify" rel="stylesheet" href={asset("/verify.css")} />
        <link
          key="css-public-lang"
          rel="stylesheet"
          href={asset("/public-lang.css")}
        />
        {
          /* REQ-080: reached by sending the code from a landing page (the
            landings add ?px=lead; the login page does not) — a Lead for the
            ads, once per phone on this browser. */
        }
        {url.searchParams.get("px") === "lead"
          ? <MetaPixelEvent event={leadEvent(phone)} />
          : null}
      </Head>
      <div class="verify-shell">
        <div class="verify-card">
          <PublicLangToggle
            lang={lang}
            hrefs={{
              en: langToggleHref(url.href, "en"),
              es: langToggleHref(url.href, "es"),
            }}
          />
          <a href="/" class="brand" style="margin:0 auto 4px">
            <img
              src="/logo-monster.png"
              alt={tFor(lang, "brand.name")}
              style="width:38px;height:38px;flex-shrink:0"
            />
            <span>
              {tFor(lang, "brand.namePrefix")}
              <em style="font-style:normal;color:var(--brand-green)">
                {tFor(lang, "brand.nameSuffix")}
              </em>
            </span>
          </a>
          <ol class="pm-steps" aria-label={tFor(lang, "verify.steps.aria")}>
            <li class="pm-steps__item pm-steps__item--done">
              <span class="pm-steps__dot">
                <Icon name="check" size={12} stroke-width={3} />
              </span>
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
        <SiteFooter lang={lang} />
      </div>
    </>
  );
});
