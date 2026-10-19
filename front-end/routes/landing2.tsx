import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import Landing2Signup, {
  type Landing2SignupLabels,
} from "../islands/Landing2Signup.tsx";
import Landing2Monster from "../islands/Landing2Monster.tsx";
import Landing2Demo, {
  type Landing2DemoLabels,
} from "../islands/Landing2Demo.tsx";
import { tFor } from "../lib/i18n.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "../lib/lang.ts";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans.ts";
import {
  absoluteUrl,
  socialMetaTags,
} from "../../shared/quote-flow/site-meta.ts";
import { DEMO_SLOTS, upcomingDemoDays } from "../../shared/demo-booking/mod.ts";
import {
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_HREF,
} from "../../shared/legal/contact.ts";
import { LEGAL_LINKS, type LegalDocId } from "../../shared/legal/terms.ts";

/**
 * REQ-081 — /landing2, the "conversion-first" website, made real: Spanish first like the other
 * two websites (REQ-002), English on the toggle; the hero's signup is the real OTP flow kept on
 * the page (Landing2Signup); the demo booking posts to the backend (Landing2Demo →
 * POST /demo-request); the plans are the one plan list (shared/quote-flow/pricing-plans.ts); the
 * phone, the address and the four policy links are the shared ones (REQ-044/076); the pixel
 * loads here as on "/" and "/landing" (REQ-080).
 *
 * REQ-088 — the v3 mock (documonster-landing, approved Oct 18): the proof band in ink right after
 * the hero, three headline-only outcome cards, Art and Ben with their photos and the 8 to 8
 * hours, three plan cards with the custom plan as the call-us line, the FAQ's four points, and
 * start / call / demo in the final CTA and the sticky bar — no chat-app link anywhere on the page.
 *
 * REQ-092 — the Llámanos button at the bottom (the sticky bar on a phone, the final CTA on a
 * desktop) scrolls to the call-us section — the team, `#llamanos`: Art and Ben, the 1-855 button
 * and the hours — instead of handing a tel: link to a browser that may have no dialer; the 1-855
 * buttons themselves stay plain tel: links. REQ-093 — the Projects line under the plan cards
 * carries 10px of padding.
 */

/** REQ-076 — the dictionary key for each policy link's label on this page. */
const FOOTER_KEY: Record<LegalDocId, string> = {
  terms: "footer.terms",
  refunds: "footer.refunds",
  privacy: "footer.privacy",
  sms: "footer.sms",
};

const EMAIL_HREF = "mailto:hello@documonster.com";
const MONSTER_IMG = "/monster-paper.png";
/** the support line as the mock spells it on its buttons */
const VANITY = "1-855-DocuMon";
/** the SMS terms the two consent lines link to */
const SMS_TERMS_PATH = LEGAL_LINKS.find((l) => l.id === "sms")?.path ?? "";
/** Art and Ben — the two people of the mock, their photos tracked under static (REQ-075) */
const TEAM = [
  { n: 1, img: "/team-art.jpg" },
  { n: 2, img: "/team-ben.jpg" },
];

/** how each priced plan's card is dressed — the mock's three columns, by plan id */
const PLAN_LOOK: Record<string, { featured?: boolean; btn: string }> = {
  free: { btn: "l2-btn--ghost" },
  monster: { featured: true, btn: "l2-btn--primary" },
  assist: { btn: "l2-btn--ghost" },
};
const DEFAULT_LOOK = { btn: "l2-btn--ghost" };

function Tick({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      stroke-width="3.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

export default define.page(function Landing2(ctx) {
  const url = new URL(ctx.req.url);
  const q = url.searchParams.get("lang");
  const lang: Lang = (q === "en" || q === "es")
    ? q
    : (langFromCookie(ctx.req.headers.get("cookie")) ??
      pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language")));
  const t = (k: string) => tFor(lang, `landing2.${k}`);
  const pick = <K extends string>(keys: readonly K[]): Record<K, string> =>
    Object.fromEntries(keys.map((k) => [k, t(k)])) as Record<K, string>;

  const signupLabels: Landing2SignupLabels = pick(
    [
      "regH",
      "phoneLbl",
      "sendCode",
      "sending",
      "consentA",
      "consentTerms",
      "errConsent",
      "preferTalk",
      "codeSentTo",
      "codeLbl",
      "confirm",
      "confirming",
      "resend",
      "errPhone",
      "errSend",
      "errCooldown",
      "errCode",
      "errExpired",
      "errRate",
    ] as const,
  );
  const demoLabels: Landing2DemoLabels = {
    ...pick(
      [
        "callMe",
        "consentTerms",
        "pickTimeLink",
        "quickLink",
        "pickDay",
        "name",
        "namePh",
        "phone",
        "email",
        "emailPh",
        "submitDemo",
        "submitting",
        "sumDemo",
        "errName",
        "errPhoneReq",
        "errEmailBad",
        "errSubmit",
        "errRateDemo",
        "thanksH",
        "thanksSub",
        "thanksNoText",
      ] as const,
    ),
    consent: t("demoConsent"),
    errConsent: t("errConsentDemo"),
  };
  const days = upcomingDemoDays(lang);

  const outcomes = [1, 2, 3].map((n) => ({
    n,
    title: t(`outcome.${n}.title`),
  }));
  const team = TEAM.map((m) => ({
    img: m.img,
    name: t(`team.${m.n}.name`),
    role: t(`team.${m.n}.role`),
    line: t(`team.${m.n}.line`),
  }));
  const faqPoints = [1, 2, 3, 4].map((n) => t(`faqPoint.${n}`));
  const faqs = [1, 2, 3, 4].map((n) => ({
    q: t(`faq.${n}.q`),
    a: t(`faq.${n}.a`),
  }));
  const cardPlans = PUBLIC_PLANS.filter((p) => !p.custom);
  const linePlans = PUBLIC_PLANS.filter((p) => p.custom);
  const price = (cents: number) => `$${Math.round(cents / 100)}`;

  const brand = (cls: string) => (
    <span class={`l2-h ${cls}`}>
      Docu<em>Monster</em>
    </span>
  );

  return (
    <>
      <Head>
        <title>{t("docTitle")}</title>
        <meta name="description" content={t("metaDescription")} />
        <link rel="canonical" href={absoluteUrl("/landing2")} />
        {socialMetaTags({
          path: "/landing2",
          title: t("docTitle"),
          description: t("metaDescription"),
          lang,
        }).map((m) =>
          m.kind === "property"
            ? <meta key={m.key} property={m.key} content={m.content} />
            : <meta key={m.key} name={m.key} content={m.content} />
        )}
        <link rel="stylesheet" href="/landing2.css" />
      </Head>

      <div class="l2">
        {/* ---------- nav ---------- */}
        <div class="l2-nav" data-cy="l2-nav">
          <div class="l2-nav__in">
            <a href="#top" class="l2-brand">
              <img src={MONSTER_IMG} alt="" />
              {brand("l2-brand__name")}
            </a>
            <div class="l2-row">
              <a
                class="l2-lang"
                href={`/landing2?lang=${lang === "es" ? "en" : "es"}`}
                hreflang={lang === "es" ? "en" : "es"}
                aria-label={t("langAria")}
                data-cy="l2-lang"
              >
                <span class={lang === "es" ? "on" : ""}>ES</span>
                <span class={lang === "en" ? "on" : ""}>EN</span>
              </a>
              <a class="l2-nav__phone l2-hide-m" href={SUPPORT_PHONE_HREF}>
                {VANITY}
              </a>
              <a class="l2-btn l2-btn--primary l2-btn--sm" href="#empezar">
                {t("navCta")}
              </a>
            </div>
          </div>
        </div>
        <div class="l2-bunting" aria-hidden="true" />

        {/* ---------- hero: promise + signup ---------- */}
        <div id="top" class="l2-hero" data-cy="l2-hero">
          <div class="l2-hero__copy">
            <div class="l2-row" style="gap: 8px">
              <span class="l2-badge">
                <img src={MONSTER_IMG} alt="" />
                {t("badge")}
              </span>
            </div>
            <h1 class="l2-h l2-h1 l2-hero__h1">
              <span>{t("h1a")}</span>
              <span class="l2-accent">{t("h1b")}</span>
            </h1>
            <p class="l2-hero__sub">{t("heroSub")}</p>

            <Landing2Signup
              lang={lang}
              labels={signupLabels}
              smsTermsPath={SMS_TERMS_PATH}
              phoneHref={SUPPORT_PHONE_HREF}
              phoneLabel={VANITY}
            />
          </div>

          <div class="l2-hero__art">
            <Landing2Monster src={MONSTER_IMG} alt={t("monsterAlt")} />
            <div class="l2-card l2-note l2-note--said">
              <div class="l2-note__k">{t("youSaid")}</div>
              <div class="l2-note__msg">{t("youSaidMsg")}</div>
            </div>
            <div class="l2-card l2-note l2-note--got">
              <div class="l2-note__k">{t("clientGot")}</div>
              <div class="l2-note__quote">Quote #PM-2641 · $10,990</div>
              <div class="l2-note__signed">Signed ✓ R. Hernández</div>
            </div>
          </div>
        </div>

        {/* ---------- proof: chat → quote, the ink band ---------- */}
        <div class="l2-bunting" aria-hidden="true" />
        <div class="l2-proof" data-cy="l2-proof">
          <div class="l2-wrap l2-two">
            <div class="l2-proof__copy">
              <span class="l2-eyebrow l2-eyebrow--orange">
                {t("proofEyebrow")}
              </span>
              <h2 class="l2-h l2-h2 l2-h2--light">{t("proofH")}</h2>
              <div class="l2-chat">
                <div class="l2-bubble l2-bubble--me">{t("msg1")}</div>
                <div class="l2-bubble l2-bubble--them">{t("msg2")}</div>
                <div class="l2-bubble l2-bubble--me">{t("msg3")}</div>
                <div class="l2-bubble l2-bubble--them">{t("msg4")}</div>
              </div>
            </div>
            <div class="l2-card l2-quote" lang="en">
              <div class="l2-quote__head">
                <div>
                  <div class="l2-quote__title">QUOTE #PM-2641</div>
                  <div class="l2-quote__for">
                    Kitchen remodel · Prepared for R. Hernández
                  </div>
                </div>
                <span class="l2-pill">Signed ✓</span>
              </div>
              <div class="l2-quote__lines">
                <div class="l2-quote__line">
                  <span>Cabinets &amp; installation</span>
                  <strong>$4,200.00</strong>
                </div>
                <div class="l2-quote__line">
                  <span>Quartz countertops</span>
                  <strong>$3,990.00</strong>
                </div>
                <div class="l2-quote__line">
                  <span>Demolition &amp; labor (3 days)</span>
                  <strong>$2,800.00</strong>
                </div>
              </div>
              <div class="l2-quote__foot">
                <span class="l2-quote__sig">R. Hernández</span>
                <span class="l2-quote__total">$10,990.00</span>
              </div>
            </div>
          </div>
        </div>

        {/* ---------- outcomes: headlines only ---------- */}
        <div class="l2-wrap l2-outcomes" data-cy="l2-outcomes">
          <div class="l2-three">
            {outcomes.map((o) => (
              <div
                class={`l2-outcome l2-outcome--${o.n}`}
                key={o.n}
                data-cy="l2-outcome"
              >
                <div class="l2-h l2-outcome__n">0{o.n}</div>
                <div class="l2-outcome__t">{o.title}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ---------- the people ---------- */}
        <div id="llamanos" class="l2-team" data-cy="l2-team">
          <div class="l2-wrap l2-two l2-team__grid">
            <div class="l2-stack">
              <span class="l2-eyebrow l2-eyebrow--forest">
                {t("teamEyebrow")}
              </span>
              <h2 class="l2-h l2-h2">{t("teamH")}</h2>
              <p class="l2-team__sub">{t("teamSub")}</p>
              <a
                class="l2-btn l2-btn--dark l2-btn--lg l2-self-start"
                href={SUPPORT_PHONE_HREF}
              >
                {VANITY}
              </a>
              <span class="l2-team__hours">
                <strong>1-{SUPPORT_PHONE_DISPLAY}</strong> · {t("hours")}
              </span>
            </div>
            <div class="l2-team__cards">
              {team.map((m) => (
                <div class="l2-card l2-member" key={m.name} data-cy="l2-member">
                  <img class="l2-member__photo" src={m.img} alt={m.name} />
                  <div class="l2-member__name">{m.name}</div>
                  <div class="l2-member__role">{m.role}</div>
                  <p class="l2-member__line">{m.line}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ---------- plans: three cards and the Projects line ---------- */}
        <div id="planes" class="l2-wrap l2-plans" data-cy="l2-plans">
          <div class="l2-plans__head">
            <span class="l2-eyebrow l2-eyebrow--forest">
              {t("plansEyebrow")}
            </span>
            <h2 class="l2-h l2-h2">{t("plansH")}</h2>
            <p class="l2-plans__sub">{t("plansSub")}</p>
          </div>
          <div class="l2-three l2-three--plans">
            {cardPlans.map((p) => {
              const look = PLAN_LOOK[p.id] ?? DEFAULT_LOOK;
              const tick = look.featured ? "#F4A125" : "#3EA448";
              return (
                <div
                  class={`l2-card l2-plan ${
                    look.featured ? "l2-plan--featured" : ""
                  }`}
                  key={p.id}
                  data-cy="l2-plan"
                  data-plan={p.id}
                  data-popular={look.featured ? "" : undefined}
                >
                  {look.featured
                    ? <span class="l2-plan__pop">{t("popular")}</span>
                    : null}
                  <div class="l2-plan__name" data-cy="l2-plan-name">
                    {p.name}
                  </div>
                  <div data-cy="l2-plan-price">
                    <span class="l2-h l2-plan__price">
                      {price(p.priceCents)}
                    </span>
                    <span class="l2-plan__per">{t("perMonth")}</span>
                  </div>
                  <p class="l2-plan__sub">{t(`plan.${p.id}.sub`)}</p>
                  <div class="l2-plan__feats">
                    {p.features.map((f) => (
                      <div class="l2-check" key={f.id}>
                        <Tick color={tick} />
                        <span>{lang === "es" ? f.es : f.en}</span>
                      </div>
                    ))}
                  </div>
                  <a
                    class={`l2-btn l2-btn--plan ${look.btn}`}
                    href="#empezar"
                    data-cy="l2-plan-cta"
                  >
                    {t(`plan.${p.id}.cta`)}
                  </a>
                </div>
              );
            })}
          </div>
          {linePlans.map((p) => (
            <p class="l2-plans__note" key={p.id} data-cy="l2-projects">
              {t("projectsA")}
              {p.name}
              {t("projectsB")}
              <a href={SUPPORT_PHONE_HREF}>{VANITY}</a>
            </p>
          ))}
        </div>

        {/* ---------- demo: one card ---------- */}
        <div id="demo" class="l2-wrap l2-demo" data-cy="l2-demo">
          <div class="l2-card l2-demo__card" data-cy="l2-demo-card">
            <div class="l2-stack l2-demo__copy">
              <span class="l2-eyebrow l2-eyebrow--pink">
                {t("demoEyebrow")}
              </span>
              <h2 class="l2-h l2-h2 l2-h2--demo">{t("demoH")}</h2>
              <p class="l2-demo__sub">{t("demoSub")}</p>
            </div>
            <Landing2Demo
              lang={lang}
              labels={demoLabels}
              days={days}
              slots={DEMO_SLOTS}
              smsTermsPath={SMS_TERMS_PATH}
            />
          </div>
        </div>

        {/* ---------- faq ---------- */}
        <div class="l2-faq" data-cy="l2-faq">
          <div class="l2-wrap l2-two l2-faq__grid">
            <div class="l2-faq__head">
              <span class="l2-eyebrow l2-eyebrow--pink">{t("faqEyebrow")}</span>
              <h2 class="l2-h l2-h2 l2-h2--faq">{t("faqH")}</h2>
              <div class="l2-faq__points">
                {faqPoints.map((p) => (
                  <div
                    class="l2-check l2-check--md"
                    key={p}
                    data-cy="l2-faq-point"
                  >
                    <Tick color="#3EA448" size={18} />
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div class="l2-faq__list">
              {faqs.map((f, i) => (
                <details key={i}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>

        {/* ---------- final cta ---------- */}
        <div class="l2-final" data-cy="l2-final">
          <div class="l2-wrap l2-final__in">
            <h2 class="l2-h l2-h2 l2-h2--final">{t("finalH")}</h2>
            <div class="l2-final__ctas">
              <a class="l2-btn l2-btn--primary" href="#empezar">
                {t("navCta")}
              </a>
              <a class="l2-btn l2-btn--dark" href="#llamanos">
                {t("callUs")}
              </a>
              <a class="l2-btn l2-btn--ghost" href="#demo">{t("bookDemo")}</a>
            </div>
          </div>
        </div>

        {/* ---------- footer ---------- */}
        <div class="l2-footer" data-cy="l2-footer">
          <div class="l2-footer__in">
            <div class="l2-footer__top">
              <div class="l2-footer__brand">
                <img src={MONSTER_IMG} alt="" />
                {brand("")}
              </div>
              <div class="l2-footer__contact">
                <a href={SUPPORT_PHONE_HREF} data-site-phone>
                  {SUPPORT_PHONE_DISPLAY}
                </a>
                <a href={EMAIL_HREF}>hello@documonster.com</a>
                <span data-site-address>{BUSINESS_ADDRESS}</span>
              </div>
            </div>
            <nav class="l2-footer__legal" aria-label={t("footerLegalAria")}>
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
              <span class="l2-footer__copy">{t("copyright")}</span>
            </nav>
          </div>
        </div>

        {/* ---------- sticky mobile bar: start, call ---------- */}
        <div class="l2-stickybar" data-cy="l2-stickybar">
          <a class="l2-btn l2-btn--primary l2-btn--bar" href="#empezar">
            {t("navCta")}
          </a>
          <a class="l2-btn l2-btn--dark l2-btn--bar" href="#llamanos">
            {t("callUs")}
          </a>
        </div>
      </div>
    </>
  );
});
