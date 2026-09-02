import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { loadUser } from "../lib/auth.ts";
import { tFor } from "../lib/i18n.ts";
import { langFromCookie, pickLangFromAcceptLanguage } from "../lib/lang.ts";
import {
  formatSocialProof,
  LANDING_OFFER,
} from "../../shared/quote-flow/landing-offers.ts";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans.ts";
import { LANDING_DICT } from "../lib/landing-dict.ts";
import {
  absoluteUrl,
  socialMetaTags,
} from "../../shared/quote-flow/site-meta.ts";
import {
  buildRotorPhrase,
  ES_ROTOR,
} from "../../shared/quote-flow/landing-rotor.ts";
import PhoneChat, {
  type Bubble,
  type QuoteCopy,
} from "../islands/PhoneChat.tsx";

/** ES rotor phrase per word ("cotizaciones" → "las cotizaciones."), so each
 *  rotating word carries its OWN agreeing article (P-16) instead of the hero
 *  prefix baking in a one-size-fits-none "las". */
const ES_ROTOR_BY_WORD = new Map(
  ES_ROTOR.map((e) => [e.word, buildRotorPhrase(e)]),
);
const esRotor = (word: string) => ES_ROTOR_BY_WORD.get(word) ?? `${word}.`;

/** "$0" / "$99" / "$199" — the PUBLIC tier prices come from the one plan source
 *  (shared/quote-flow/pricing-plans.ts), never re-typed in the markup (P-08).
 *  Custom-priced plans (Monster Projects) have no entry: their card shows a
 *  label instead of a figure. */
const TIER_PRICE: Record<string, string> = Object.fromEntries(
  PUBLIC_PLANS.filter((p) => !p.custom).map((
    p,
  ) => [p.id, `$${Math.round(p.priceCents / 100)}`]),
);

/** The from-price the "{p}" placeholder resolves to, in whole dollars. */
const PRICE_FROM = String(Math.round(LANDING_OFFER.priceFromCents / 100));

/** Offer numbers the client script needs, SSR-injected so neither the counter
 *  targets nor the price/trial claims are ever re-typed in the static script
 *  (P-08). `__PM_DOCS_SENT` drives the animated documents counter; `__PM_OFFER`
 *  fills the dictionary's {n}/{p}/{d} placeholders on a language switch. */
const OFFER_BOOT =
  `window.__PM_DOCS_SENT=${LANDING_OFFER.socialProof.docsSent};` +
  `window.__PM_OFFER=${
    JSON.stringify({
      trialDays: LANDING_OFFER.trialDays,
      priceFrom: PRICE_FROM,
      counts: {
        contractors: {
          en: formatSocialProof(LANDING_OFFER.socialProof.contractors, "en"),
          es: formatSocialProof(LANDING_OFFER.socialProof.contractors, "es"),
        },
      },
    })
  };`;

const DEMO_SCRIPT_EN: Bubble[] = [
  {
    side: "right",
    kind: "bubble",
    cls: "me",
    text:
      "Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor.",
  },
  { side: "right", kind: "meta", text: "9:38 AM" },
  { side: "left", kind: "typing" },
  {
    side: "left",
    kind: "bubble",
    cls: "them",
    text: "Got it 👍 What zip code is the job in?",
  },
  {
    side: "left",
    kind: "bubble",
    cls: "them",
    text: "And rough square footage of countertop?",
  },
  {
    side: "right",
    kind: "bubble",
    cls: "me",
    text: "78704. About 42 sq ft of counter.",
  },
  { side: "left", kind: "typing" },
  {
    side: "left",
    kind: "bubble",
    cls: "them",
    text:
      "Perfect. Quote coming up — typical range for this is $10,800–$12,400.",
  },
  {
    side: "left",
    kind: "bubble",
    cls: "them",
    text: "Here's your quote, ready to send:",
    style: "background:var(--mint-200)",
  },
  { side: "right", kind: "quote" },
  {
    side: "right",
    kind: "bubble",
    cls: "me",
    text: "Looks good. Send it to them.",
  },
  { side: "right", kind: "meta", text: "9:41 AM ✓ Sent to client" },
];

const DEMO_SCRIPT_ES: Bubble[] = [
  {
    side: "right",
    kind: "bubble",
    cls: "me",
    text:
      "Remodelación cocina para los Hernández. Gabinetes, cubierta de cuarzo, 3 días de mano de obra.",
  },
  { side: "right", kind: "meta", text: "9:38" },
  { side: "left", kind: "typing" },
  {
    side: "left",
    kind: "bubble",
    cls: "them",
    text: "Listo 👍 ¿Cuál es el código postal del trabajo?",
  },
  {
    side: "left",
    kind: "bubble",
    cls: "them",
    text: "¿Y aproximadamente cuántos pies² de cubierta?",
  },
  {
    side: "right",
    kind: "bubble",
    cls: "me",
    text: "78704. Como 42 pies² de cubierta.",
  },
  { side: "left", kind: "typing" },
  {
    side: "left",
    kind: "bubble",
    cls: "them",
    text: "Perfecto. Va la cotización — rango típico $10.800–$12.400.",
  },
  {
    side: "left",
    kind: "bubble",
    cls: "them",
    text: "Aquí está tu cotización, lista para enviar:",
    style: "background:var(--mint-200)",
  },
  { side: "right", kind: "quote" },
  { side: "right", kind: "bubble", cls: "me", text: "Se ve bien. Mándasela." },
  { side: "right", kind: "meta", text: "9:41 ✓ Enviado al cliente" },
];

const DEMO_QUOTE_EN: QuoteCopy = {
  hd: "Quote · #PM-2641",
  l1: "Cabinets & install",
  l2: "Quartz countertops",
  l3: "Demo & labor",
  total: "Total",
};
const DEMO_QUOTE_ES: QuoteCopy = {
  hd: "Cotización · #PM-2641",
  l1: "Gabinetes e instalación",
  l2: "Cubiertas de cuarzo",
  l3: "Demolición y mano de obra",
  total: "Total",
};

/**
 * Landing route — server-renders the prototype's HTML structure (verbatim from
 * Paperwork Monster Landing.html) with `data-i18n` attributes the
 * <LandingScripts> island substitutes on hydration. Styling lives in
 * /static/landing.css.
 */
export default define.page(async function Landing(ctx) {
  const user = await loadUser(ctx.req);
  if (user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    });
  }

  // A paid Spanish ad set points at "/?lang=es" — an explicit ?lang= in the
  // URL is the strongest signal there is and outranks a stale pm_lang cookie
  // from an unrelated visit (routes/landing.tsx already worked this way; the
  // two landings used to disagree).
  const qLang = new URL(ctx.req.url).searchParams.get("lang");
  const lang = (qLang === "en" || qLang === "es")
    ? qLang
    : langFromCookie(ctx.req.headers.get("cookie")) ??
      pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
  // SSR-render every data-i18n node from the ONE landing dictionary
  // (lib/landing-dict.ts) so a pm_lang=es request paints Spanish on the first
  // byte (P-19: no EN-first flash). The browser gets the same dict from
  // /landing-dict.js and re-applies it on a language switch — no drift.
  const dict = LANDING_DICT[lang] ?? LANDING_DICT.en;
  const contractors = formatSocialProof(
    LANDING_OFFER.socialProof.contractors,
    lang,
  );
  /** First-paint text for one rotor word — the client keeps swapping it from
   *  the data-en/data-es attributes on a language toggle. */
  const rotorWord = (en: string, esWord: string) =>
    lang === "es" ? esRotor(esWord) : en;
  /** Dictionary lookup + offer-placeholder fill: {n} social-proof counter,
   *  {p} from-price, {d} free-trial days — all from LANDING_OFFER. */
  const t = (key: string, n?: string) =>
    (dict[key] ?? LANDING_DICT.en[key] ?? "")
      .replace(/\{p\}/g, PRICE_FROM)
      .replace(/\{d\}/g, String(LANDING_OFFER.trialDays))
      .replace(/\{n\}/g, n ?? "");

  return (
    <>
      <Head>
        <title>{tFor(lang, "landing.head.title")}</title>
        <meta
          name="description"
          content={tFor(lang, "landing.head.metaDescription")}
        />
        {
          /* Share plumbing. Without it every share of an ad link — including
            the comment thread under the ad itself — rendered as a bare URL:
            no title, no blurb, no image. Built from the ONE tag set both
            marketing pages use (shared/quote-flow/site-meta.ts). */
        }
        <link rel="canonical" href={absoluteUrl("/")} />
        {socialMetaTags({
          path: "/",
          title: tFor(lang, "landing.head.title"),
          description: tFor(lang, "landing.head.metaDescription"),
          lang,
        }).map((m) =>
          m.kind === "property"
            ? <meta key={m.key} property={m.key} content={m.content} />
            : <meta key={m.key} name={m.key} content={m.content} />
        )}
        <link rel="stylesheet" href="/landing.css" />
        {
          /* Single-source the offer numbers (P-08): counters, from-price and
            trial length are SSR-injected from LANDING_OFFER instead of being
            magic numbers in the static script. Runs before the deferred ones. */
        }
        <script
          // deno-lint-ignore react-no-danger
          dangerouslySetInnerHTML={{ __html: OFFER_BOOT }}
        />
        {
          /* The same dictionary this page server-rendered, for the client-side
            language toggle. Served from its own URL (never inlined) so the
            Spanish page ships no English copy and vice versa. Deferred scripts
            run in document order, so the dict lands before its consumer. */
        }
        <script src="/landing-dict.js" defer></script>
        <script src="/landing-scripts.js" defer></script>
      </Head>

      {/* ========== NAV ========== */}
      <div class="nav-wrap">
        <div class="container nav">
          <a href="#" class="brand">
            <img src="/logo-monster.png" alt="Paperwork Monster" />
            <span data-i18n="brand1">{t("brand1")}</span>
            <em
              data-i18n="brand2"
              style="font-style:normal;color:var(--brand-green)"
            >
              {t("brand2")}
            </em>
          </a>

          {
            /* P-17: the full sentences are what blew the 390px header up to
              three wrapped rows. Both labels ship, and CSS swaps to the
              EN/ES abbreviation below 720px; the aria-label keeps the full
              sentence for assistive tech at every width. */
          }
          <div class="lang-toggle" role="tablist" aria-label="Language">
            <button
              class={lang === "en" ? "on" : ""}
              type="button"
              data-lang="en"
              aria-label="I speak English"
            >
              <span class="lang-toggle__full">I speak English</span>
              <span class="lang-toggle__abbr" aria-hidden="true">EN</span>
            </button>
            <button
              class={lang === "es" ? "on" : ""}
              type="button"
              data-lang="es"
              aria-label="Yo hablo Español"
            >
              <span class="lang-toggle__full">Yo hablo Español</span>
              <span class="lang-toggle__abbr" aria-hidden="true">ES</span>
            </button>
          </div>

          <nav class="nav-links">
            <a href="#features" data-i18n="nav.features">{t("nav.features")}</a>
            <a href="#how-it-works" data-i18n="nav.how">{t("nav.how")}</a>
            <a href="#pricing" data-i18n="nav.pricing">{t("nav.pricing")}</a>
          </nav>

          {/* Roadmap p.13: top-of-view Login → clean /login component. */}
          <a href="/login" class="btn btn-outline" data-i18n="nav.login">
            {t("nav.login")}
          </a>
          <a
            href="#contact"
            class="btn btn-primary cta-scroll"
            data-i18n="nav.cta"
          >
            {t("nav.cta")}
          </a>
        </div>
      </div>

      {/* ========== HERO ========== */}
      <section class="hero">
        <div class="hero-dots"></div>
        <div class="container hero-grid">
          <div class="hero-copy">
            <div class="kicker">
              <span class="kicker-pill" data-i18n="hero.kickerPill">
                {t("hero.kickerPill")}
              </span>
              <span data-i18n="hero.kicker">{t("hero.kicker")}</span>
            </div>

            <h1>
              <span data-i18n="hero.h1a">{t("hero.h1a")}</span>
              <br />
              <span data-i18n="hero.h1b">{t("hero.h1b")}</span>
              <span class="rotor">
                <span class="rotor-track" id="rotor-track">
                  <span
                    class="word in"
                    data-en="quotes."
                    data-es={esRotor("cotizaciones")}
                  >
                    {rotorWord("quotes.", "cotizaciones")}
                  </span>
                  <span
                    class="word"
                    data-en="contracts."
                    data-es={esRotor("contratos")}
                  >
                    {rotorWord("contracts.", "contratos")}
                  </span>
                  <span
                    class="word"
                    data-en="invoices."
                    data-es={esRotor("facturas")}
                  >
                    {rotorWord("invoices.", "facturas")}
                  </span>
                  <span
                    class="word"
                    data-en="paperwork."
                    data-es={esRotor("papeleo")}
                  >
                    {rotorWord("paperwork.", "papeleo")}
                  </span>
                </span>
              </span>
            </h1>

            <p class="lead" data-i18n="hero.lead">{t("hero.lead")}</p>

            <div class="hero-ctas">
              <a
                href="#contact"
                class="btn btn-primary btn-lg"
                data-cta="primary"
                data-i18n="hero.cta1"
              >
                {t("hero.cta1")}
              </a>
              <a
                href="#how-it-works"
                class="btn btn-outline"
                data-cta="secondary"
                data-i18n="hero.cta2"
              >
                {t("hero.cta2")}
              </a>
            </div>

            <div class="hero-trust">
              <div class="avatars">
                <div class="av" style="background:var(--brand-pink)">MR</div>
                <div class="av" style="background:var(--brand-green)">JG</div>
                <div class="av" style="background:var(--brand-teal)">CL</div>
                <div class="av" style="background:var(--coffee-500)">TS</div>
              </div>
              <span>
                <strong data-i18n="hero.trustStrong" data-count="contractors">
                  {t("hero.trustStrong", contractors)}
                </strong>{" "}
                <span data-i18n="hero.trustRest">{t("hero.trustRest")}</span>
              </span>
            </div>
          </div>

          <div class="hero-visual" aria-hidden="true">
            <div class="hero-stage">
              <div class="hs-blob hs-blob--mint"></div>
              <div class="hs-blob hs-blob--pink"></div>

              <div class="hs-badge hs-badge--top">
                <span class="hs-badge__icon green">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span class="hs-badge__body">
                  <strong data-i18n="hero.chip1">{t("hero.chip1")}</strong>
                  <em>9:42 AM</em>
                </span>
              </div>

              <div class="hs-badge hs-badge--bottom">
                <span
                  class="hs-badge__avatar"
                  style="background:var(--brand-pink)"
                >
                  RH
                </span>
                <span class="hs-badge__body">
                  <strong>R. Hernández</strong>
                  <em data-i18n="hero.chip2">{t("hero.chip2")}</em>
                </span>
                <span class="hs-badge__icon pink" style="margin-left:auto">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              </div>

              <div class="hs-doc">
                <div class="hs-doc__head">
                  <span class="hs-doc__tag" data-i18n="doc.q.tag">
                    {t("doc.q.tag")}
                  </span>
                  <span class="hs-doc__num">#PM-2641</span>
                </div>
                <h4 class="hs-doc__title" data-i18n="doc.q.title">
                  {t("doc.q.title")}
                </h4>
                <div class="hs-doc__client">R. Hernández · Apr 26</div>
                <div class="hs-doc__rows">
                  <div class="hs-doc__row">
                    <span data-i18n="doc.q.l1">{t("doc.q.l1")}</span>
                    <strong>$4,200.00</strong>
                  </div>
                  <div class="hs-doc__row">
                    <span data-i18n="doc.q.l2">{t("doc.q.l2")}</span>
                    <strong>$3,990.00</strong>
                  </div>
                  <div class="hs-doc__row">
                    <span data-i18n="doc.q.l3">{t("doc.q.l3")}</span>
                    <strong>$1,950.00</strong>
                  </div>
                  <div class="hs-doc__row hs-doc__row--total">
                    <span data-i18n="doc.total">{t("doc.total")}</span>
                    <strong>$10,990.00</strong>
                  </div>
                </div>
                <div class="hs-doc__sign">
                  <div class="hs-doc__sign-line"></div>
                  <span class="hs-doc__sign-label" data-i18n="doc.q.signed">
                    {t("doc.q.signed")}
                  </span>
                </div>
              </div>

              <div class="hs-phone">
                <div class="hs-phone__notch"></div>
                <div class="hs-phone__screen">
                  <div class="hs-chat__hdr">
                    <span class="hs-chat__avatar">PM</span>
                    <span class="hs-chat__name">
                      <strong>Paperwork Monster</strong>
                      <em data-i18n="hero.chatStatus">
                        {t("hero.chatStatus")}
                      </em>
                    </span>
                  </div>
                  <div class="hs-chat__body">
                    <div class="hs-bubble hs-bubble--me">
                      Kitchen remodel for the Hernández family. Cabinets, quartz
                      counters, 3 days labor.
                    </div>
                    <div class="hs-bubble hs-bubble--them">
                      Got it. Pulling comps now…
                    </div>
                    <div class="hs-bubble hs-bubble--them hs-bubble--rich">
                      <div class="hs-rich__row">
                        <span>Cabinets</span>
                        <strong>$4,200</strong>
                      </div>
                      <div class="hs-rich__row">
                        <span>Counters</span>
                        <strong>$3,990</strong>
                      </div>
                      <div class="hs-rich__row">
                        <span>Labor</span>
                        <strong>$1,950</strong>
                      </div>
                      <div class="hs-rich__total">
                        <span>Total</span>
                        <strong>$10,990</strong>
                      </div>
                      <div class="hs-rich__cta">Send to client →</div>
                    </div>
                    <div class="hs-bubble hs-bubble--me hs-bubble--short">
                      Send it 👍
                    </div>
                  </div>
                  <div class="hs-chat__input">
                    <span class="hs-chat__input-text">Type a message…</span>
                    <span class="hs-chat__input-send">↑</span>
                  </div>
                </div>
              </div>

              <svg class="spark s1" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0l2.5 9.5L24 12l-9.5 2.5L12 24l-2.5-9.5L0 12l9.5-2.5z" />
              </svg>
              <svg class="spark s2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0l2.5 9.5L24 12l-9.5 2.5L12 24l-2.5-9.5L0 12l9.5-2.5z" />
              </svg>
              <svg class="spark s3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0l2.5 9.5L24 12l-9.5 2.5L12 24l-2.5-9.5L0 12l9.5-2.5z" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* ========== MARQUEE ========== */}
      <div class="marquee" aria-hidden="true">
        <div class="marquee-track" id="marquee-track">
          <span
            data-en="30% average revenue increase|Professional quotes in minutes|Contracts with one tap|Invoices that track payments|No apps to download|Just chat with us"
            data-es="30% más ingresos en promedio|Cotizaciones pro en minutos|Contratos con un toque|Facturas que rastrean pagos|Sin apps que descargar|Solo chatea con nosotros"
          >
          </span>
        </div>
      </div>

      {/* ========== PROBLEM ========== */}
      <section class="problem">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="problem.eyebrow">
              {t("problem.eyebrow")}
            </span>
            <h2
              data-i18n="problem.h2html"
              data-html="1"
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{ __html: t("problem.h2html") }}
            />
            <p data-i18n="problem.lead">{t("problem.lead")}</p>
          </div>

          <div class="problem-grid">
            <div class="problem-card">
              <span class="num">01</span>
              <h3 data-i18n="problem.c1.h">{t("problem.c1.h")}</h3>
              <p data-i18n="problem.c1.p">{t("problem.c1.p")}</p>
            </div>
            <div class="problem-card">
              <span class="num">02</span>
              <h3 data-i18n="problem.c2.h">{t("problem.c2.h")}</h3>
              <p data-i18n="problem.c2.p">{t("problem.c2.p")}</p>
            </div>
            <div class="problem-card">
              <span class="num">03</span>
              <h3 data-i18n="problem.c3.h">{t("problem.c3.h")}</h3>
              <p data-i18n="problem.c3.p">{t("problem.c3.p")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ========== DOCUMENTS / TABS ========== */}
      <section class="docs">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="docs.eyebrow">
              {t("docs.eyebrow")}
            </span>
            <h2
              data-i18n="docs.h2html"
              data-html="1"
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{ __html: t("docs.h2html") }}
            />
            <p data-i18n="docs.lead">{t("docs.lead")}</p>
          </div>

          <div class="doc-tabs" role="tablist">
            <button type="button" class="doc-tab on" data-doc="quote">
              <span class="step">01</span>{" "}
              <span data-i18n="docs.tab.quote">{t("docs.tab.quote")}</span>
            </button>
            <button type="button" class="doc-tab" data-doc="contract">
              <span class="step">02</span>{" "}
              <span data-i18n="docs.tab.contract">
                {t("docs.tab.contract")}
              </span>
            </button>
            <button type="button" class="doc-tab" data-doc="invoice">
              <span class="step">03</span>{" "}
              <span data-i18n="docs.tab.invoice">{t("docs.tab.invoice")}</span>
            </button>
          </div>

          <div class="doc-stage">
            <div class="doc-mockup">
              <div class="doc-mockup-header">
                <h5 id="doc-title">Quote</h5>
                <div class="num">
                  <strong id="doc-num">#PM-2641</strong>
                  <span id="doc-date">April 26, 2026</span>
                </div>
              </div>
              <div id="doc-lines"></div>
              <div class="doc-totals" id="doc-totals"></div>
            </div>

            <div class="doc-info" id="doc-info">
              <h3 id="doc-info-title"></h3>
              <p id="doc-info-body"></p>
              <ul id="doc-info-list"></ul>
            </div>
          </div>

          <div class="doc-counter">
            <div>
              <div class="label" data-i18n="docs.counter.label">
                {t("docs.counter.label")}
              </div>
              <div class="big" id="doc-counter-num">0</div>
            </div>
            <div class="types">
              <span data-i18n="docs.counter.t1">{t("docs.counter.t1")}</span>
              <span data-i18n="docs.counter.t2">{t("docs.counter.t2")}</span>
              <span data-i18n="docs.counter.t3">{t("docs.counter.t3")}</span>
              <span data-i18n="docs.counter.t4">{t("docs.counter.t4")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section class="features" id="features">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="feat.eyebrow">
              {t("feat.eyebrow")}
            </span>
            <h2
              data-i18n="feat.h2html"
              data-html="1"
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{ __html: t("feat.h2html") }}
            />
            <p data-i18n="feat.lead">{t("feat.lead")}</p>
          </div>

          <div class="features-grid">
            <div class="feature">
              <div class="feature-icon pink">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 2v4" />
                  <path d="M12 18v4" />
                  <path d="M4.93 4.93l2.83 2.83" />
                  <path d="M16.24 16.24l2.83 2.83" />
                  <path d="M2 12h4" />
                  <path d="M18 12h4" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </div>
              <div>
                <h3 data-i18n="feat.f1.h">{t("feat.f1.h")}</h3>
                <p data-i18n="feat.f1.p">{t("feat.f1.p")}</p>
              </div>
            </div>

            <div class="feature">
              <div class="feature-icon green">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              </div>
              <div>
                <h3 data-i18n="feat.f2.h">{t("feat.f2.h")}</h3>
                <p data-i18n="feat.f2.p">{t("feat.f2.p")}</p>
              </div>
            </div>

            <div class="feature">
              <div class="feature-icon teal">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                  <line x1="9" y1="11" x2="15" y2="11" />
                </svg>
              </div>
              <div>
                <h3 data-i18n="feat.f3.h">{t("feat.f3.h")}</h3>
                <p data-i18n="feat.f3.p">{t("feat.f3.p")}</p>
              </div>
            </div>

            <div class="feature">
              <div class="feature-icon coffee">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </div>
              <div>
                <h3 data-i18n="feat.f4.h">{t("feat.f4.h")}</h3>
                <p data-i18n="feat.f4.p">{t("feat.f4.p")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section class="how" id="how-it-works">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="how.eyebrow">
              {t("how.eyebrow")}
            </span>
            <h2 data-i18n="how.h2">{t("how.h2")}</h2>
            <p data-i18n="how.lead">{t("how.lead")}</p>
          </div>

          <div class="how-grid">
            <div class="how-step">
              <div class="num-circle">1</div>
              <h3 data-i18n="how.s1.h">{t("how.s1.h")}</h3>
              <p data-i18n="how.s1.p">{t("how.s1.p")}</p>
            </div>
            <div class="how-step">
              <div class="num-circle">2</div>
              <h3 data-i18n="how.s2.h">{t("how.s2.h")}</h3>
              <p data-i18n="how.s2.p">{t("how.s2.p")}</p>
            </div>
            <div class="how-step">
              <div class="num-circle">3</div>
              <h3 data-i18n="how.s3.h">{t("how.s3.h")}</h3>
              <p data-i18n="how.s3.p">{t("how.s3.p")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ========== DEMO ========== */}
      <section class="demo">
        <div class="container demo-grid">
          <div class="demo-info">
            <span class="eyebrow-pill" data-i18n="demo.eyebrow">
              {t("demo.eyebrow")}
            </span>
            <h2 data-i18n="demo.h2">{t("demo.h2")}</h2>
            <p data-i18n="demo.lead">{t("demo.lead")}</p>

            <div class="testimonial">
              <span class="quote-mark">"</span>
              <p data-i18n="demo.quote">{t("demo.quote")}</p>
              <div class="who">
                <div class="av">AR</div>
                <div>
                  <strong>Alex R.</strong>
                  <span data-i18n="demo.role">{t("demo.role")}</span>
                </div>
              </div>
            </div>
          </div>

          <PhoneChat
            script={DEMO_SCRIPT_EN}
            scriptEs={DEMO_SCRIPT_ES}
            quote={DEMO_QUOTE_EN}
            quoteEs={DEMO_QUOTE_ES}
            messageCopy="Message"
            messageCopyEs="Mensaje"
            autoPlayOnView
          />
        </div>
      </section>

      {/* ========== PRICING ========== */}
      <section class="pricing" id="pricing">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="price.eyebrow">
              {t("price.eyebrow")}
            </span>
            <h2
              data-i18n="price.plans.h2html"
              data-html="1"
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{ __html: t("price.plans.h2html") }}
            />
            <p data-i18n="price.plans.lead">{t("price.plans.lead")}</p>
            {/* The one free-trial claim, same length /landing advertises. */}
            <p data-i18n="price.plans.trial">{t("price.plans.trial")}</p>
          </div>

          {
            /* Only the PUBLIC plans (Monster Free, Monster, Monster Assist,
              Monster Projects) render here — Monster Assist Plus is a
              phone/onboarding upsell and is never listed. Projects is priced
              per engagement, so its card says Custom and carries no figure. Both cards read shared/quote-flow/pricing-plans.ts,
              the same list /landing renders. The data-i18n keys stay so the
              client-side language toggle keeps working. */
          }
          <div class="pricing-tiers">
            <div class="tier" data-cy="pricing-plan">
              <div
                class="tier-name"
                data-i18n="price.t1.name"
                data-cy="pricing-plan-name"
              >
                {t("price.t1.name")}
              </div>
              <div class="tier-price">
                {TIER_PRICE.free}
                <span class="permo" data-i18n="price.permo">
                  {t("price.permo")}
                </span>
              </div>
              <p class="tier-blurb" data-i18n="price.t1.blurb">
                {t("price.t1.blurb")}
              </p>
              <ul class="tier-list">
                {PUBLIC_PLANS[0].features.map((f, i) => (
                  <li key={f.id} data-i18n={`price.t1.f${i + 1}`}>
                    {t(`price.t1.f${i + 1}`)}
                  </li>
                ))}
              </ul>
              <a
                href="#contact"
                class="btn btn-outline tier-cta cta-scroll"
                data-i18n="price.plans.cta"
              >
                {t("price.plans.cta")}
              </a>
            </div>

            <div class="tier featured" data-cy="pricing-plan">
              <span class="tier-badge" data-i18n="price.t2.badge">
                {t("price.t2.badge")}
              </span>
              <div
                class="tier-name"
                data-i18n="price.t2.name"
                data-cy="pricing-plan-name"
              >
                {t("price.t2.name")}
              </div>
              <div class="tier-price">
                {TIER_PRICE.monster}
                <span class="permo" data-i18n="price.permo">
                  {t("price.permo")}
                </span>
              </div>
              <p class="tier-blurb" data-i18n="price.t2.blurb">
                {t("price.t2.blurb")}
              </p>
              <ul class="tier-list">
                {PUBLIC_PLANS[1].features.map((f, i) => (
                  <li key={f.id} data-i18n={`price.t2.f${i + 1}`}>
                    {t(`price.t2.f${i + 1}`)}
                  </li>
                ))}
              </ul>
              <a
                href="#contact"
                class="btn btn-primary tier-cta cta-scroll"
                data-i18n="price.plans.cta"
              >
                {t("price.plans.cta")}
              </a>
            </div>

            <div class="tier" data-cy="pricing-plan">
              <div
                class="tier-name"
                data-i18n="price.t3.name"
                data-cy="pricing-plan-name"
              >
                {t("price.t3.name")}
              </div>
              <div class="tier-price">
                {TIER_PRICE.assist}
                <span class="permo" data-i18n="price.permo">
                  {t("price.permo")}
                </span>
              </div>
              <p class="tier-blurb" data-i18n="price.t3.blurb">
                {t("price.t3.blurb")}
              </p>
              <ul class="tier-list">
                {PUBLIC_PLANS[2].features.map((f, i) => (
                  <li key={f.id} data-i18n={`price.t3.f${i + 1}`}>
                    {t(`price.t3.f${i + 1}`)}
                  </li>
                ))}
              </ul>
              <a
                href="#contact"
                class="btn btn-outline tier-cta cta-scroll"
                data-i18n="price.plans.cta"
              >
                {t("price.plans.cta")}
              </a>
            </div>

            <div class="tier tier--custom" data-cy="pricing-plan">
              <div
                class="tier-name"
                data-i18n="price.t4.name"
                data-cy="pricing-plan-name"
              >
                {t("price.t4.name")}
              </div>
              <div class="tier-price" data-i18n="price.t4.price">
                {t("price.t4.price")}
              </div>
              <p class="tier-blurb" data-i18n="price.t4.blurb">
                {t("price.t4.blurb")}
              </p>
              <ul class="tier-list">
                {PUBLIC_PLANS[3].features.map((f, i) => (
                  <li key={f.id} data-i18n={`price.t4.f${i + 1}`}>
                    {t(`price.t4.f${i + 1}`)}
                  </li>
                ))}
              </ul>
              <a
                href="#contact"
                class="btn btn-outline tier-cta cta-scroll"
                data-i18n="price.plans.ctaCustom"
              >
                {t("price.plans.ctaCustom")}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ========== CONTACT ========== */}
      <section class="contact" id="contact">
        <div class="container">
          <div class="contact-card">
            <div class="contact-info">
              <span class="eyebrow-pill" data-i18n="cta.eyebrow">
                {t("cta.eyebrow")}
              </span>
              <ol class="pm-steps" aria-label="Sign-in steps">
                <li class="pm-steps__item pm-steps__item--active">
                  <span class="pm-steps__dot">1</span>
                  <span class="pm-steps__label" data-i18n="cta.steps.phone">
                    {t("cta.steps.phone")}
                  </span>
                </li>
                <span class="pm-steps__bar" aria-hidden="true"></span>
                <li class="pm-steps__item">
                  <span class="pm-steps__dot">2</span>
                  <span class="pm-steps__label" data-i18n="cta.steps.code">
                    {t("cta.steps.code")}
                  </span>
                </li>
                <span class="pm-steps__bar" aria-hidden="true"></span>
                <li class="pm-steps__item">
                  <span class="pm-steps__dot">3</span>
                  <span class="pm-steps__label" data-i18n="cta.steps.in">
                    {t("cta.steps.in")}
                  </span>
                </li>
              </ol>
              <h2 data-i18n="cta.h2">{t("cta.h2")}</h2>
              <p data-i18n="cta.lead">{t("cta.lead")}</p>
              <ul class="checks">
                <li>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>{" "}
                  <span data-i18n="cta.b1">{t("cta.b1")}</span>
                </li>
                <li>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>{" "}
                  <span data-i18n="cta.fromPrice">{t("cta.fromPrice")}</span>
                </li>
                <li>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>{" "}
                  <span data-i18n="cta.b3">{t("cta.b3")}</span>
                </li>
              </ul>
            </div>

            <form class="contact-form" id="contact-form">
              {/* Saved-phone chip — populated by LandingScripts when localStorage.pm:last-phone is present. */}
              <div class="cf-saved" id="cf-saved" hidden>
                <span class="cf-saved__hint" data-i18n="cta.useSaved">
                  {t("cta.useSaved")}
                </span>
                <button type="button" class="cf-saved__btn" id="cf-saved-btn">
                  <span id="cf-saved-phone">(xxx) xxx-xxxx</span>
                </button>
                <button
                  type="button"
                  class="cf-saved__dismiss"
                  id="cf-saved-dismiss"
                  data-i18n="cta.notYou"
                >
                  {t("cta.notYou")}
                </button>
              </div>

              {
                /* Dead-simple phone entry — one obvious field. The input
                  pulses to draw the eye until it's focused. */
              }
              <label class="signup-field" for="f-phone">
                <span class="signup-field__label" data-i18n="cta.label">
                  {t("cta.label")}
                </span>
                <input
                  id="f-phone"
                  name="phone"
                  type="tel"
                  class="signup-input signup-input--pulse"
                  placeholder="(555) 123-4567"
                  required
                  autocomplete="tel"
                  inputmode="tel"
                />
              </label>
              <p class="signup-error" id="cf-meta" role="alert"></p>

              <button class="cf-cta submit" type="submit">
                <span data-i18n="cta.btn">{t("cta.btn")}</span>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>

              <div class="cf-trust">
                <div class="cf-trust__avatars">
                  <span
                    class="cf-trust__av"
                    style="background:var(--brand-pink)"
                  >
                    JG
                  </span>
                  <span
                    class="cf-trust__av"
                    style="background:var(--brand-teal)"
                  >
                    CL
                  </span>
                  <span
                    class="cf-trust__av"
                    style="background:var(--coffee-500)"
                  >
                    TS
                  </span>
                </div>
                <div class="cf-trust__text">
                  <strong data-i18n="hero.trustStrong" data-count="contractors">
                    {t("hero.trustStrong", contractors)}
                  </strong>{" "}
                  <span data-i18n="cta.trustRest">{t("cta.trustRest")}</span>
                </div>
              </div>

              <div class="fine" data-i18n="cta.fine">{t("cta.fine")}</div>
            </form>
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer class="footer">
        <div class="container footer-row">
          <a href="#" class="brand">
            <img src="/logo-monster.png" alt="" />
            <span>Paperwork</span>
            <em style="font-style:normal;color:var(--brand-green)">Monster</em>
          </a>
          <div class="links">
            <a href="#features" data-i18n="nav.features">{t("nav.features")}</a>
            <a href="#how-it-works" data-i18n="nav.how">{t("nav.how")}</a>
            <a href="#pricing" data-i18n="nav.pricing">{t("nav.pricing")}</a>
            <a href="/contact" data-i18n="footer.contact">
              {t("footer.contact")}
            </a>
          </div>
          <a class="footer-phone" href="tel:+18667678399">(866) 767-8399</a>
          <div class="copy" data-i18n="footer.copy">{t("footer.copy")}</div>
        </div>
      </footer>
    </>
  );
});
