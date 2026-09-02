import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import TrialSignup from "../islands/TrialSignup.tsx";
import { tFor } from "../lib/i18n.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "../lib/lang.ts";
import { LANDING_OFFER } from "../../shared/quote-flow/landing-offers.ts";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans.ts";
import {
  absoluteUrl,
  socialMetaTags,
} from "../../shared/quote-flow/site-meta.ts";

/** "$0" / "$99" — the PUBLIC plan prices come from the one plan source
 *  (shared/quote-flow/pricing-plans.ts), so this page and "/" quote the same
 *  numbers (P-08). */
const TIER_PRICE: Record<string, string> = Object.fromEntries(
  PUBLIC_PLANS.map((p) => [p.id, `$${Math.round(p.priceCents / 100)}`]),
);

// Toll-free support line (same number the dashboard "Call support" CTA dials).
const SUPPORT_PHONE = "+18667678399";
const SUPPORT_PHONE_DISPLAY = "(866) 767-8399";

function Check() {
  return (
    <span class="pm-chip__check" aria-hidden="true">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

function DownArrow() {
  return (
    <div class="pm-step__arrow" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </div>
  );
}

/**
 * /landing — a standalone, shareable marketing page (distinct from the main
 * "/" landing). Simple top-to-bottom pitch with a working "Start My Free
 * Trial" phone form that reuses the OTP sign-up flow.
 */
export default define.page(function PromoLanding(ctx) {
  const url = new URL(ctx.req.url);
  const q = url.searchParams.get("lang");
  const lang: Lang = (q === "en" || q === "es") ? q : (langFromCookie(
    ctx.req.headers.get("cookie"),
  ) ?? pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language")));
  // {d} — the free-trial length, from the ONE landing offer both pages sell
  // (P-08). Never re-typed in lang/*.json.
  const t = (k: string) =>
    tFor(lang, `promoLanding.${k}`, { d: LANDING_OFFER.trialDays });
  const h1b = t("h1b");

  return (
    <>
      <Head>
        <title>{t("docTitle")}</title>
        <meta name="description" content={t("metaDescription")} />
        {
          /* Same share plumbing "/" ships, from the ONE tag set
            (shared/quote-flow/site-meta.ts). The canonical is self-referential:
            this page is a distinct offer page, not a copy of "/". */
        }
        <link rel="canonical" href={absoluteUrl("/landing")} />
        {socialMetaTags({
          path: "/landing",
          title: t("docTitle"),
          description: t("metaDescription"),
          lang,
        }).map((m) =>
          m.kind === "property"
            ? <meta key={m.key} property={m.key} content={m.content} />
            : <meta key={m.key} name={m.key} content={m.content} />
        )}
        <link rel="stylesheet" href="/promo.css" />
      </Head>

      <div class="pm">
        <div class="pm-wrap">
          {/* ---------- header ---------- */}
          <header class="pm-header">
            <a href="/landing" class="pm-brand">
              <img src="/logo-monster.png" alt="Paperwork Monster" />
              <span>
                Paperwork <em>Monster</em>
              </span>
            </a>
            <div class="pm-header__right">
              <div class="pm-langtoggle" role="tablist" aria-label="Language">
                <a
                  href="/landing?lang=es"
                  class={lang === "es" ? "on" : ""}
                >
                  {t("langEs")}
                </a>
                <a
                  href="/landing?lang=en"
                  class={lang === "en" ? "on" : ""}
                >
                  {t("langEn")}
                </a>
              </div>
              <a
                href="/login"
                class="pm-header__login"
                data-cy="landing-login"
              >
                {t("navLogin")}
              </a>
            </div>
          </header>

          {/* ---------- hero ---------- */}
          <section class="pm-hero">
            <p class="pm-hero__hook">
              {t("hookLead")} <strong>{t("hookStrong")}</strong>
            </p>
            <h1>
              {t("h1a")} <span class="pm-accent">{t("h1accent")}</span>
              {h1b ? <>{" "}{h1b}</> : null}
            </h1>
            <p class="pm-hero__sub">
              <strong>{t("subStrong1")}</strong> {t("subMid")}{" "}
              <strong>{t("subStrong2")}</strong>
            </p>

            <div class="pm-prepare">
              <div class="pm-prepare__label">{t("prepareLabel")}</div>
              <div class="pm-chips">
                <span class="pm-chip">
                  <Check /> {t("chipQuotes")}
                </span>
                <span class="pm-chip">
                  <Check /> {t("chipInvoices")}
                </span>
                <span class="pm-chip">
                  <Check /> {t("chipContracts")}
                </span>
                <span class="pm-chip">
                  <Check /> {t("chipEmails")}
                </span>
              </div>
            </div>

            <div class="pm-hero__cta">
              <a href="#trial" class="pm-btn pm-btn--primary">
                {t("ctaPrimary")}
              </a>
            </div>
          </section>

          {/* ---------- free trial ---------- */}
          <section class="pm-trial" id="trial">
            <div class="pm-trial__card">
              <span class="pm-trial__badge">{t("trialBadge")}</span>
              <h2>{t("trialH2")}</h2>
              <p class="pm-trial__sub">
                <b>{t("trialSubStrong")}</b> {t("trialSubRest")}
              </p>

              <TrialSignup lang={lang} />

              <div class="pm-call">
                <p class="pm-call__q">{t("callQ")}</p>
                <a class="pm-call__num" href={`tel:${SUPPORT_PHONE}`}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                  </svg>
                  {SUPPORT_PHONE_DISPLAY}
                </a>
              </div>
            </div>
          </section>

          {/* ---------- how it works ---------- */}
          <section class="pm-how">
            <h2>{t("howH2")}</h2>
            <div class="pm-steps">
              <div class="pm-step">
                <div class="pm-step__num">1</div>
                <p>{t("step1")}</p>
              </div>
              <DownArrow />
              <div class="pm-step">
                <div class="pm-step__num">2</div>
                <p>{t("step2")}</p>
              </div>
              <DownArrow />
              <div class="pm-step">
                <div class="pm-step__num">3</div>
                <p>{t("step3")}</p>
              </div>
            </div>
          </section>

          {/* ---------- pricing ---------- */}
          <section class="pm-pricing" id="pricing">
            <h2>{t("pricingH2")}</h2>
            <p class="pm-pricing__sub">{t("pricingSub")}</p>
            {
              /* Only the PUBLIC plans (Monster Free, Monster) render here —
                every Monster Assist tier is a phone/onboarding upsell and is
                never listed. Both cards read shared/quote-flow/pricing-plans.ts,
                the same list "/" renders, so the two pages can no longer
                promise different things at the same price. */
            }
            <div class="pm-plans">
              <div class="pm-plan" data-cy="pricing-plan">
                <h3 class="pm-plan__name" data-cy="pricing-plan-name">
                  {t("pricingFreeName")}
                </h3>
                <div class="pm-plan__price">
                  {TIER_PRICE.free}
                  <span class="pm-plan__cadence">{t("pricingPerMonth")}</span>
                </div>
                <p class="pm-plan__blurb">{t("pricingFreeBlurb")}</p>
                <ul class="pm-plan__feats">
                  {PUBLIC_PLANS[0].features.map((f) => (
                    <li key={f.id}>
                      <Check /> {lang === "es" ? f.es : f.en}
                    </li>
                  ))}
                </ul>
                <a href="#trial" class="pm-btn pm-btn--ghost pm-plan__cta">
                  {t("pricingCta")}
                </a>
              </div>

              <div class="pm-plan pm-plan--featured" data-cy="pricing-plan">
                <span class="pm-plan__badge">{t("pricingBadge")}</span>
                <h3 class="pm-plan__name" data-cy="pricing-plan-name">
                  {t("pricingMonsterName")}
                </h3>
                <div class="pm-plan__price">
                  {TIER_PRICE.monster}
                  <span class="pm-plan__cadence">{t("pricingPerMonth")}</span>
                </div>
                <p class="pm-plan__blurb">{t("pricingMonsterBlurb")}</p>
                <ul class="pm-plan__feats">
                  {PUBLIC_PLANS[1].features.map((f) => (
                    <li key={f.id}>
                      <Check /> {lang === "es" ? f.es : f.en}
                    </li>
                  ))}
                </ul>
                <a href="#trial" class="pm-btn pm-btn--primary pm-plan__cta">
                  {t("pricingCta")}
                </a>
              </div>
            </div>
          </section>
        </div>

        {/* ---------- closing ---------- */}
        <section class="pm-close">
          <div class="pm-wrap">
            <div class="pm-close__band">
              <h2>{t("closeH2")}</h2>
              <p>{t("closeP")}</p>
              <a href="#trial" class="pm-btn pm-btn--primary">
                {t("ctaPrimary")}
              </a>
            </div>
          </div>
        </section>

        {/* ---------- footer ---------- */}
        <div class="pm-wrap">
          <footer class="pm-footer">
            <a href="/landing" class="pm-brand">
              <img src="/logo-monster.png" alt="" />
              <span>
                Paperwork <em>Monster</em>
              </span>
            </a>
            <a class="pm-footer__phone" href={`tel:${SUPPORT_PHONE}`}>
              {SUPPORT_PHONE_DISPLAY}
            </a>
            <div class="pm-footer__copy">{t("footerCopy")}</div>
          </footer>
        </div>
      </div>
    </>
  );
});
