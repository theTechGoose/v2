import { asset, Head } from "fresh/runtime";
import { define } from "../utils.ts";
import Landing5CallMe, {
  type Landing5CallMeLabels,
} from "../islands/Landing5CallMe.tsx";
import { tFor, type Vars } from "../lib/i18n.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "../lib/lang.ts";
import { adFromUrl, adPhoto } from "../lib/landing-ads.ts";
import {
  absoluteUrl,
  socialMetaTags,
} from "../../shared/quote-flow/site-meta.ts";
import {
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_HREF,
} from "../../shared/legal/contact.ts";
import { LEGAL_LINKS, type LegalDocId } from "../../shared/legal/terms.ts";
import {
  Brand,
  langHref,
  MONSTER_IMG,
  pick,
  SMS_TERMS_PATH,
  Tick,
  VANITY,
} from "../components/Landing3Sections.tsx";

/**
 * REQ-149 — /landing5, the "Landing v5" Meta ads page (landing-variations/v5, Nov 3): the simple
 * one. The ad photo and the ad's line (`?ad=`, the same matching as /landing3), "Pruébalo gratis
 * hoy.", the 30-day line, Regístrate ahora → /login (the app's own sign-in, where the mock's
 * absolute login URL points on /landing2 too), the Need-help-we-call-you card (Landing5CallMe →
 * POST /demo-request, a call as soon as possible with the name), the ¿Prefieres hablar? row
 * (`#llamanos`, where the bottom Llámanos buttons scroll — REQ-092), the ink trust band with the
 * four faces and the four inclusions, the closing and the footer; the sticky bar on a phone.
 * Spanish first (REQ-002), English on the one-link toggle, on the l2 design system with
 * landing5.css for the mock's own layouts.
 */
const PATH = "/landing5" as const;
const EMAIL = "hello@documonster.com";
const EMAIL_HREF = `mailto:${EMAIL}`;
/** Art, Ben, Keren, Sergio — the mock's order */
const FACES = [
  { n: 1, img: "/team-art.jpg" },
  { n: 2, img: "/team-ben.jpg" },
  { n: 3, img: "/team-keren.jpg" },
  { n: 4, img: "/team-sergio.jpg" },
];
const FOOTER_KEY: Record<LegalDocId, string> = {
  terms: "footer.terms",
  refunds: "footer.refunds",
  privacy: "footer.privacy",
  sms: "footer.sms",
};

export default define.page(function Landing5(ctx) {
  const url = new URL(ctx.req.url);
  const q = url.searchParams.get("lang");
  const lang: Lang = (q === "en" || q === "es")
    ? q
    : (langFromCookie(ctx.req.headers.get("cookie")) ??
      pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language")));
  const t = (k: string, vars?: Vars) => tFor(lang, `landing5.${k}`, vars);
  const t3 = (k: string, vars?: Vars) => tFor(lang, `landing3.${k}`, vars);
  const ad = adFromUrl(url);
  const year = new Date().getFullYear();
  const callLabels: Landing5CallMeLabels = pick(
    t,
    [
      "helpH",
      "name",
      "namePh",
      "phone",
      "phonePh",
      "callMe",
      "sending",
      "consent",
      "consentTerms",
      "errName",
      "errPhone",
      "errConsent",
      "errSend",
      "errRate",
      "doneH",
      "doneSub",
    ] as const,
  );

  return (
    <>
      <Head>
        <title>{t("docTitle")}</title>
        <meta name="description" content={t("metaDescription")} />
        <link rel="canonical" href={absoluteUrl(PATH)} />
        <link
          rel="alternate"
          hreflang="es"
          href={absoluteUrl(`${PATH}?lang=es`)}
        />
        <link
          rel="alternate"
          hreflang="en"
          href={absoluteUrl(`${PATH}?lang=en`)}
        />
        <link rel="alternate" hreflang="x-default" href={absoluteUrl(PATH)} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossorigin="anonymous"
        />
        {socialMetaTags({
          path: PATH,
          title: t("docTitle"),
          description: t("metaDescription"),
          lang,
        }).map((m) =>
          m.kind === "property"
            ? <meta key={m.key} property={m.key} content={m.content} />
            : <meta key={m.key} name={m.key} content={m.content} />
        )}
        <link
          key="css-landing2"
          rel="stylesheet"
          href={asset("/landing2.css")}
        />
        <link
          key="css-landing5"
          rel="stylesheet"
          href={asset("/landing5.css")}
        />
      </Head>

      <div class="l2 l5" id="top">
        {/* ---------- nav ---------- */}
        <header class="l2-nav" data-cy="l5-nav">
          <div class="l2-nav__in">
            <a href="#top" class="l2-brand">
              <img src={MONSTER_IMG} alt="" />
              <Brand cls="l2-brand__name" />
            </a>
            <div class="l2-row">
              <a
                class="l2-lang"
                href={langHref(PATH, lang, ad)}
                hreflang={lang === "es" ? "en" : "es"}
                aria-label={t("langAria")}
                data-cy="l5-lang"
              >
                <span class={lang === "es" ? "on" : ""}>ES</span>
                <span class={lang === "en" ? "on" : ""}>EN</span>
              </a>
              <a class="l5-nav__phone" href={SUPPORT_PHONE_HREF}>{VANITY}</a>
            </div>
          </div>
        </header>
        <div class="l2-bunting" aria-hidden="true" />

        <main>
          {/* ---------- hero: the ad, try it free, sign up, the help card ---------- */}
          <div class="l5-hero" data-cy="l5-hero">
            <div class="l5-hero__photo">
              <img src={adPhoto(ad)} alt={t3(`adAlt.${ad}`)} data-ad={ad} />
            </div>
            <div class="l5-hero__text">
              <p class="l5-hero__lead">
                <span>{t3(`ad.${ad}`)}</span> {t("adLead")}
              </p>
              <h1 class="l2-h l2-h1 l5-hero__h1">{t("h1")}</h1>
              <p class="l5-hero__sub">{t("sub")}</p>
              <a
                class="l2-btn l2-btn--primary l5-hero__signup"
                href="/login"
                data-cy="l5-signup"
              >
                {t("signup")}
              </a>
              <div id="empezar" class="l2-card l5-help" data-cy="l5-callme">
                <Landing5CallMe
                  lang={lang}
                  labels={callLabels}
                  smsTermsPath={SMS_TERMS_PATH}
                />
              </div>
              <div id="llamanos" class="l5-talk">
                <span class="l5-talk__q">{t("preferTalk")}</span>
                <a class="l5-talk__num" href={SUPPORT_PHONE_HREF}>{VANITY}</a>
                <span class="l5-talk__hours">{t("hours")}</span>
              </div>
            </div>
          </div>

          {/* ---------- trust: the people, what's included ---------- */}
          <div class="l2-bunting" aria-hidden="true" />
          <div class="l5-trust" data-cy="l5-trust">
            <div class="l5-trust__in">
              <div class="l5-trust__copy">
                <h2 class="l2-h l2-h2 l5-trust__h">{t("trustH")}</h2>
                <p class="l5-trust__sub">{t("trustSub")}</p>
                <span class="l5-trust__meet">{t("meetTeam")}</span>
                <div class="l5-faces">
                  {FACES.map((f) => (
                    <div class="l5-face" key={f.n} data-cy="l5-face">
                      <img src={f.img} alt={t(`team.${f.n}`)} loading="lazy" />
                      <span>{t(`team.${f.n}`)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div class="l5-inc">
                {[1, 2, 3, 4].map((n) => (
                  <div class="l2-check" key={n} data-cy="l5-inc">
                    <Tick color="#F4A125" size={20} />
                    <span>{t(`inc.${n}`)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ---------- close ---------- */}
          <div class="l5-close" data-cy="l5-final">
            <h2 class="l2-h l2-h2 l5-close__h">{t("closeH")}</h2>
            <div class="l5-close__ctas">
              <a class="l2-btn l2-btn--primary" href="/login">
                {t("startFree")}
              </a>
              <a class="l2-btn l2-btn--dark" href="#llamanos">{t("callUs")}</a>
              <a class="l2-btn l2-btn--ghost" href={EMAIL_HREF}>
                {t("emailUs")}
              </a>
            </div>
          </div>
        </main>

        {/* ---------- footer ---------- */}
        <footer class="l5-footer" data-cy="l5-footer">
          <div class="l5-footer__in">
            <span>
              {t("copyright", { year })} ·{" "}
              <span data-site-address>{BUSINESS_ADDRESS}</span>
            </span>
            <nav class="l5-footer__links" aria-label={t("footerLegalAria")}>
              <a href={EMAIL_HREF}>{EMAIL}</a>
              {LEGAL_LINKS.map((l) => (
                <a
                  key={l.id}
                  href={l.path}
                  data-legal-link={l.id}
                  data-terms-link={l.id === "terms" ? "" : undefined}
                >
                  {t(FOOTER_KEY[l.id])}
                </a>
              ))}
            </nav>
          </div>
        </footer>

        {/* ---------- sticky mobile bar: sign up, call ---------- */}
        <div class="l2-stickybar" data-cy="l5-stickybar">
          <a class="l2-btn l2-btn--primary l2-btn--bar" href="/login">
            {t("signup")}
          </a>
          <a class="l2-btn l2-btn--dark l2-btn--bar" href="#llamanos">
            {t("callUs")}
          </a>
        </div>
      </div>
    </>
  );
});
