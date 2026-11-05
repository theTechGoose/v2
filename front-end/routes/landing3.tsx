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
 * REQ-147 — /landing3, the "Landing v3" Meta ads page (landing-variations/v3, Nov 3): the page
 * opens on the ad the person tapped (`?ad=`, front-end/lib/landing-ads.ts), then the signup, the
 * proof band, the outcomes with a family photo under each, the contact card, the people, the demo,
 * the plans, the FAQ, the closing photo band and the footer — the sections in
 * components/Landing3Sections.tsx, shared with /landing4 (REQ-148). Spanish first like the other
 * websites (REQ-002), English on the one-link toggle; every form is the real one (the OTP signup,
 * the inquiry, the demo booking), as on /landing2 (REQ-081).
 */
const PATH = "/landing3" as const;

export default define.page(function Landing3(ctx) {
  const url = new URL(ctx.req.url);
  const q = url.searchParams.get("lang");
  const lang: Lang = (q === "en" || q === "es")
    ? q
    : (langFromCookie(ctx.req.headers.get("cookie")) ??
      pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language")));
  const t = (k: string, vars?: Vars) => tFor(lang, `landing3.${k}`, vars);
  const ad = adFromUrl(url);
  const l3: L3Ctx = { lang, t, ad, path: PATH };

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
          key="css-landing3"
          rel="stylesheet"
          href={asset("/landing3.css")}
        />
      </Head>

      <div class="l2 l3">
        <Nav {...l3} />
        <div class="l2-bunting" aria-hidden="true" />
        <main>
          <AdHero {...l3} id="top" />
          <Body {...l3} />
        </main>
        <Footer {...l3} />
        <StickyBar {...l3} />
      </div>
    </>
  );
});
