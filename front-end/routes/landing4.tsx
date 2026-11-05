import { asset, Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { tFor, type Vars } from "../lib/i18n.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "../lib/lang.ts";
import { adFromUrl } from "../lib/landing-ads.ts";
import {
  absoluteUrl,
  socialMetaTags,
} from "../../shared/quote-flow/site-meta.ts";
import {
  AdHero,
  Body,
  Footer,
  type L3Ctx,
  Nav,
  StickyBar,
} from "../components/Landing3Sections.tsx";

/**
 * REQ-148 — /landing4, the "Landing v4" Meta ads page (landing-variations/v4, Nov 3): /landing3
 * (REQ-147) opening on "Tú haces el trabajo. Nosotros el papeleo." — the audience pill, the
 * free-plan pill, Crear mi cotización gratis → the signup, Ver un ejemplo primero → the documents,
 * the message-to-quote sample — and the three steps, then the ad (`#anuncio`) and the rest of
 * /landing3 unchanged. The sample's message is the mock's Spanish line and its document the
 * English one the customer gets, on both language pages (lang-marked), so neither is a dictionary
 * string.
 */
const PATH = "/landing4" as const;
/** the sample: the contractor's message, and the quote it became — the mock's, on both pages */
const SAMPLE_MSG = "Pintar 3 habitaciones. Materiales y mano de obra: $1,800.";
const SAMPLE_DOC = {
  title: "QUOTE",
  line1: "Interior painting, 3 rooms",
  line2: "Materials & labor",
  total: "Total",
  amount: "$1,800",
};

export default define.page(function Landing4(ctx) {
  const url = new URL(ctx.req.url);
  const q = url.searchParams.get("lang");
  const lang: Lang = (q === "en" || q === "es")
    ? q
    : (langFromCookie(ctx.req.headers.get("cookie")) ??
      pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language")));
  const t = (k: string, vars?: Vars) => tFor(lang, `landing3.${k}`, vars);
  const t4 = (k: string, vars?: Vars) => tFor(lang, `landing4.${k}`, vars);
  const ad = adFromUrl(url);
  const l3: L3Ctx = { lang, t, ad, path: PATH };

  return (
    <>
      <Head>
        <title>{t4("docTitle")}</title>
        <meta name="description" content={t4("metaDescription")} />
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
          title: t4("docTitle"),
          description: t4("metaDescription"),
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
          key="css-landing3"
          rel="stylesheet"
          href={asset("/landing3.css")}
        />
      </Head>

      <div class="l2 l3" id="top">
        <Nav {...l3} />
        <div class="l2-bunting" aria-hidden="true" />
        <main>
          {/* ---------- TOP: what we do + message-to-quote ---------- */}
          <div class="l3-top" data-cy="l3-top">
            <div class="l3-top__copy">
              <span class="l3-pill">{t4("tag")}</span>
              <h1 class="l2-h l2-h1 l3-top__h1">
                <span>{t4("h1a")}</span>
                <span class="l2-accent">{t4("h1b")}</span>
              </h1>
              <p class="l3-top__sub">{t4("sub")}</p>
              <span class="l3-pill l3-pill--free">{t4("freePill")}</span>
              <div class="l3-top__ctas">
                <a class="l2-btn l2-btn--primary l3-top__cta" href="#empezar">
                  {t4("cta")}
                </a>
                <a class="l3-top__see" href="#documentos">{t4("seeExample")}</a>
                <span class="l3-top__note">{t4("note")}</span>
              </div>
            </div>
            <div class="l2-card l3-sample">
              <span class="l2-eyebrow">{t4("fromMsg")}</span>
              <div class="l3-sample__msg" lang="es">{SAMPLE_MSG}</div>
              <div class="l3-sample__arrow" aria-hidden="true">↓</div>
              <span class="l2-eyebrow">{t4("toQuote")}</span>
              <div class="l3-sample__doc">
                <span class="l3-sample__tag">{t4("sample")}</span>
                <div class="l3-sample__biz">{t4("yourBiz")}</div>
                <div class="l2-h l3-sample__title" lang="en">
                  {SAMPLE_DOC.title}
                </div>
                <div class="l3-sample__lines" lang="en">
                  <div class="l3-sample__line l3-sample__line--head">
                    {SAMPLE_DOC.line1}
                  </div>
                  <div class="l3-sample__line">{SAMPLE_DOC.line2}</div>
                  <div class="l3-sample__line l3-sample__line--total">
                    <span>{SAMPLE_DOC.total}</span>
                    <span>{SAMPLE_DOC.amount}</span>
                  </div>
                </div>
                <div class="l3-sample__ready">{t4("ready")}</div>
              </div>
            </div>
          </div>

          {/* ---------- STEPS ---------- */}
          <div class="l3-steps" data-cy="l3-steps">
            <h2 class="l2-h l2-h2 l3-steps__h">{t4("stepsH")}</h2>
            <div class="l3-steps__grid">
              {[1, 2, 3].map((n) => (
                <div class="l3-step" key={n} data-cy="l3-step">
                  <span class="l3-step__n">{n}</span>
                  <span class="l3-step__t">{t4(`step.${n}`)}</span>
                </div>
              ))}
            </div>
          </div>
          <div class="l2-bunting" aria-hidden="true" />

          <AdHero {...l3} id="anuncio" />
          <Body {...l3} />
        </main>
        <Footer {...l3} />
        <StickyBar {...l3} />
      </div>
    </>
  );
});
