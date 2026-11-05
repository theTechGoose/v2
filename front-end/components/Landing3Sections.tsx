import Landing2Signup, {
  type Landing2SignupLabels,
} from "../islands/Landing2Signup.tsx";
import Landing2Demo, {
  type Landing2DemoLabels,
} from "../islands/Landing2Demo.tsx";
import Landing3Contact, {
  type Landing3ContactLabels,
} from "../islands/Landing3Contact.tsx";
import type { Lang } from "../lib/lang.ts";
import type { Vars } from "../lib/i18n.ts";
import { type AdId, adPhoto, otherAds } from "../lib/landing-ads.ts";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans.ts";
import { DEMO_TIMES, upcomingDemoDays } from "../../shared/demo-booking/mod.ts";
import {
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_HREF,
} from "../../shared/legal/contact.ts";
import { LEGAL_LINKS, type LegalDocId } from "../../shared/legal/terms.ts";

/**
 * REQ-147/148 — the sections /landing3 and /landing4 share: the "Landing v3" mock
 * (landing-variations/v3, Nov 3) made real the way /landing2 was (REQ-081), on the l2 design
 * system (landing2.css) with landing3.css for the mock's own layouts. Every string is the
 * dictionary's (`landing3.*`, the route's `t`); the plans are the one list; the phone, the address
 * and the policy links are the shared ones; the photos are tracked files; the forms are the real
 * ones — Landing2Signup (the OTP flow, REQ-089/097/120), Landing3Contact (POST /contact) and
 * Landing2Demo (POST /demo-request, REQ-108/117). The bottom Llámanos buttons scroll to the
 * people (`#llamanos`, REQ-092); the 1-855 buttons are plain tel: links.
 */
export type T = (k: string, vars?: Vars) => string;

export interface L3Ctx {
  lang: Lang;
  t: T;
  ad: AdId;
  /** the page's own path, for the toggle and the brand link */
  path: "/landing3" | "/landing4";
}

const EMAIL = "hello@documonster.com";
const EMAIL_HREF = `mailto:${EMAIL}`;
export const MONSTER_IMG = "/monster-paper.png";
/** the support line as the mock spells it on its buttons */
export const VANITY = "1-855-DocuMon";
/** the SMS terms the consent lines link to */
export const SMS_TERMS_PATH = LEGAL_LINKS.find((l) => l.id === "sms")?.path ??
  "";
/** Art, Ben, Sergio and Keren — the mock's order, their photos tracked under static (REQ-075) */
const TEAM = [
  { n: 1, img: "/team-art.jpg" },
  { n: 2, img: "/team-ben.jpg" },
  { n: 3, img: "/team-sergio.jpg" },
  { n: 4, img: "/team-keren.jpg" },
];
const FOOTER_KEY: Record<LegalDocId, string> = {
  terms: "footer.terms",
  refunds: "footer.refunds",
  privacy: "footer.privacy",
  sms: "footer.sms",
};
/** how each priced plan's card is dressed — the mock's three columns, by plan id */
const PLAN_LOOK: Record<string, { featured?: boolean; btn: string }> = {
  free: { btn: "l2-btn--ghost" },
  monster: { featured: true, btn: "l2-btn--primary" },
  assist: { btn: "l2-btn--ghost" },
};
const DEFAULT_LOOK = { btn: "l2-btn--ghost" };
const DOCS = ["quote", "contract", "invoice"] as const;

export function Tick({ color, size = 16 }: { color: string; size?: number }) {
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

export function Brand({ cls }: { cls: string }) {
  return (
    <span class={`l2-h ${cls}`}>
      Docu<em>Monster</em>
    </span>
  );
}

/** the toggle's target: the other language, the ad kept */
export function langHref(path: string, lang: Lang, ad: AdId): string {
  const q = new URLSearchParams({ lang: lang === "es" ? "en" : "es" });
  if (ad !== "cumple") q.set("ad", ad);
  return `${path}?${q.toString()}`;
}

export function pick<K extends string>(
  t: T,
  keys: readonly K[],
): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, t(k)])) as Record<K, string>;
}

export function Nav({ lang, t, ad, path }: L3Ctx) {
  return (
    <header class="l2-nav" data-cy="l3-nav">
      <div class="l2-nav__in">
        <a href="#top" class="l2-brand">
          <img src={MONSTER_IMG} alt="" />
          <Brand cls="l2-brand__name" />
        </a>
        <div class="l2-row">
          <a
            class="l2-lang"
            href={langHref(path, lang, ad)}
            hreflang={lang === "es" ? "en" : "es"}
            aria-label={t("langAria")}
            data-cy="l3-lang"
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
    </header>
  );
}

/** THE AD — the photo and the headline of the ad the person tapped */
export function AdHero({ t, ad, id }: L3Ctx & { id: "top" | "anuncio" }) {
  return (
    <div id={id} class="l3-ad" data-cy="l3-ad">
      <div class="l3-ad__photo">
        <img src={adPhoto(ad)} alt={t(`adAlt.${ad}`)} data-ad={ad} />
      </div>
      <div class="l3-ad__text">
        <h1 class="l2-h l2-h1 l3-ad__h1">{t(`ad.${ad}`)}</h1>
        <p class="l3-ad__tag">{t("heroTag")}</p>
        <p class="l3-ad__sub">{t("heroSub")}</p>
      </div>
    </div>
  );
}

/** SIGN UP — the copy column beside /landing2's signup card, inline */
export function Signup({ lang, t }: L3Ctx) {
  const labels: Landing2SignupLabels = pick(
    t,
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
  return (
    <div class="l3-signup" data-cy="l3-signup">
      <div class="l2-card l3-signup__card">
        <div class="l3-signup__copy">
          <h2 class="l3-signup__h">{t("regH")}</h2>
          <p class="l3-signup__sub">{t("regSub")}</p>
          <div class="l3-signup__talk">
            <span>{t("preferTalk")}</span>
            <a href={SUPPORT_PHONE_HREF}>{VANITY}</a>
          </div>
        </div>
        <Landing2Signup
          lang={lang}
          labels={labels}
          smsTermsPath={SMS_TERMS_PATH}
          phoneHref={SUPPORT_PHONE_HREF}
          phoneLabel={VANITY}
          variant="inline"
        />
      </div>
    </div>
  );
}

/** PROOF — the ink band: the chat, then the three document rows */
export function Proof({ t }: L3Ctx) {
  return (
    <>
      <div class="l2-bunting" aria-hidden="true" />
      <div id="documentos" class="l3-proof" data-cy="l3-proof">
        <div class="l3-proof__in">
          <div class="l2-proof__copy">
            <span class="l2-eyebrow l2-eyebrow--orange">
              {t("proofEyebrow")}
            </span>
            <h2 class="l2-h l2-h2 l2-h2--light">{t("proofH")}</h2>
            <p class="l3-proof__sub">{t("proofSub")}</p>
            <div class="l2-chat">
              <div class="l2-bubble l2-bubble--me">{t("msg1")}</div>
              <div class="l2-bubble l2-bubble--them">{t("msg2")}</div>
              <div class="l2-bubble l2-bubble--me">{t("msg3")}</div>
              <div class="l2-bubble l2-bubble--them">{t("msg4")}</div>
            </div>
          </div>
          <div class="l3-docs">
            {DOCS.map((d) => (
              <div class="l2-card l3-doc" key={d} data-cy="l3-doc" data-doc={d}>
                <div>
                  <div class="l3-doc__t">{t(`doc.${d}.title`)}</div>
                  <div class="l3-doc__s">{t(`doc.${d}.sub`)}</div>
                </div>
                <div class="l3-doc__r">
                  <span
                    class={`l2-pill ${d === "invoice" ? "l3-pill--paid" : ""}`}
                  >
                    {t(`doc.${d}.pill`)}
                  </span>
                  <span class="l3-doc__amt">{t(`doc.${d}.amt`)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** OUTCOMES — three cards, under each the photo and headline of one of the other three ads */
export function Outcomes({ t, ad }: L3Ctx) {
  const others = otherAds(ad);
  return (
    <div class="l3-outcomes" data-cy="l3-outcomes">
      <div class="l2-three l3-outcomes__grid">
        {[1, 2, 3].map((n) => {
          const other = others[n - 1];
          return (
            <div class="l3-outcome" key={n} data-cy="l3-outcome">
              <div class={`l2-outcome l2-outcome--${n}`}>
                <div class="l2-h l2-outcome__n">0{n}</div>
                <div class="l2-outcome__t">{t(`outcome.${n}.title`)}</div>
              </div>
              <div class="l3-moment">
                <div class="l3-moment__pic">
                  <img
                    src={adPhoto(other)}
                    alt={t(`adAlt.${other}`)}
                    data-ad={other}
                    loading="lazy"
                  />
                </div>
                <div class="l3-moment__h" data-cy="l3-outcome-h">
                  {t(`ad.${other}`)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** the Llámanos / Escríbenos lines the contact and demo cards share */
function ContactLines({ t, hours }: { t: T; hours?: boolean }) {
  return (
    <div class="l3-lines">
      <span>
        <strong>{t("callUsLbl")}</strong>{" "}
        <a href={SUPPORT_PHONE_HREF}>{VANITY}</a>
      </span>
      <span>
        <strong>{t("emailUsLbl")}</strong> <a href={EMAIL_HREF}>{EMAIL}</a>
      </span>
      {hours ? <span class="l3-lines__hours">{t("hours")}</span> : null}
    </div>
  );
}

/** CONTACT — the inquiry card */
export function Contact({ t }: L3Ctx) {
  const labels: Landing3ContactLabels = {
    ...pick(
      t,
      [
        "name",
        "namePh",
        "phone",
        "phonePh",
        "email",
        "emailPh",
        "errName",
        "consentTerms",
      ] as const,
    ),
    msg: t("c.msg"),
    optional: t("c.optional"),
    msgPh: t("c.msgPh"),
    consent: t("c.consent"),
    send: t("c.send"),
    sending: t("c.sending"),
    errEmail: t("c.errEmail"),
    errSend: t("c.errSend"),
    errRate: t("c.errRate"),
    doneH: t("c.doneH"),
    doneSub: t("c.doneSub"),
    subject: t("c.subject"),
    noMsg: t("c.noMsg"),
  };
  return (
    <div id="contacto" class="l3-contact" data-cy="l3-contact">
      <div class="l2-card l3-contact__card">
        <div class="l3-contact__copy">
          <span class="l2-eyebrow l2-eyebrow--pink">{t("contactEyebrow")}</span>
          <h2 class="l2-h l2-h2 l2-h2--demo">{t("contactH")}</h2>
          <p class="l3-contact__sub">{t("contactSub")}</p>
          <ContactLines t={t} />
        </div>
        <Landing3Contact labels={labels} smsTermsPath={SMS_TERMS_PATH} />
      </div>
    </div>
  );
}

/** THE PEOPLE — #llamanos: the four, the 1-855 button, the hours */
export function Team({ t }: L3Ctx) {
  return (
    <div id="llamanos" class="l2-team" data-cy="l3-team">
      <div class="l2-wrap l2-two l2-team__grid">
        <div class="l2-stack">
          <span class="l2-eyebrow l2-eyebrow--forest">{t("teamEyebrow")}</span>
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
          {TEAM.map((m) => (
            <div class="l2-card l2-member" key={m.n} data-cy="l3-member">
              <img
                class="l2-member__photo"
                src={m.img}
                alt={t(`team.${m.n}.name`)}
                loading="lazy"
              />
              <div class="l2-member__name">{t(`team.${m.n}.name`)}</div>
              <div class="l2-member__role" lang="en">
                {t(`team.${m.n}.role`)}
              </div>
              <p class="l2-member__line">{t(`team.${m.n}.line`)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** DEMO — /landing2's card: Llámenme, or a day and a time */
export function Demo({ lang, t }: L3Ctx) {
  const labels: Landing2DemoLabels = {
    ...pick(
      t,
      [
        "callMe",
        "pickTimeLink",
        "quickLink",
        "consentTerms",
        "pickDay",
        "prevDays",
        "nextDays",
        "pickTime",
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
        "errEmailReq",
        "errEmailBad",
        "errSubmit",
        "errRateDemo",
        "thanksH",
        "thanksSub",
        "thanksNoText",
        "thanksBack",
      ] as const,
    ),
    consent: t("demoConsent"),
    errConsent: t("errConsentDemo"),
  };
  return (
    <div id="demo" class="l2-wrap l2-demo" data-cy="l3-demo">
      <div class="l2-card l2-demo__card" data-cy="l3-demo-card">
        <div class="l2-stack l2-demo__copy">
          <span class="l2-eyebrow l2-eyebrow--pink">{t("demoEyebrow")}</span>
          <h2 class="l2-h l2-h2 l2-h2--demo">{t("demoH")}</h2>
          <p class="l2-demo__sub">{t("demoSub")}</p>
          <ContactLines t={t} hours />
        </div>
        <Landing2Demo
          lang={lang}
          labels={labels}
          days={upcomingDemoDays(lang)}
          times={DEMO_TIMES}
          smsTermsPath={SMS_TERMS_PATH}
        />
      </div>
    </div>
  );
}

/** PLANS — the one list: three cards and the Projects line (REQ-119) */
export function Plans({ lang, t }: L3Ctx) {
  const cardPlans = PUBLIC_PLANS.filter((p) => !p.custom);
  const linePlans = PUBLIC_PLANS.filter((p) => p.custom);
  const price = (cents: number) => `$${Math.round(cents / 100)}`;
  return (
    <div id="planes" class="l2-wrap l2-plans" data-cy="l3-plans">
      <div class="l2-plans__head">
        <span class="l2-eyebrow l2-eyebrow--forest">{t("plansEyebrow")}</span>
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
              data-cy="l3-plan"
              data-plan={p.id}
              data-popular={look.featured ? "" : undefined}
            >
              {look.featured
                ? <span class="l2-plan__pop">{t("popular")}</span>
                : null}
              <div class="l2-plan__name" data-cy="l3-plan-name">{p.name}</div>
              <div data-cy="l3-plan-price">
                <span class="l2-h l2-plan__price">{price(p.priceCents)}</span>
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
                data-cy="l3-plan-cta"
              >
                {t(`plan.${p.id}.cta`)}
              </a>
            </div>
          );
        })}
      </div>
      {linePlans.map((p) => (
        <p class="l2-plans__note" key={p.id} data-cy="l3-projects">
          {t("projectsA")}
          {p.name}
          {t("projectsB")}
          <a href={SUPPORT_PHONE_HREF}>{VANITY}</a>
        </p>
      ))}
    </div>
  );
}

/** FAQ — four points, four questions */
export function Faq({ t }: L3Ctx) {
  return (
    <div class="l2-faq" data-cy="l3-faq">
      <div class="l2-wrap l2-two l2-faq__grid">
        <div class="l2-faq__head">
          <span class="l2-eyebrow l2-eyebrow--pink">{t("faqEyebrow")}</span>
          <h2 class="l2-h l2-h2 l2-h2--faq">{t("faqH")}</h2>
          <div class="l2-faq__points">
            {[1, 2, 3, 4].map((n) => (
              <div class="l2-check l2-check--md" key={n} data-cy="l3-faq-point">
                <Tick color="#3EA448" size={18} />
                <span>{t(`faqPoint.${n}`)}</span>
              </div>
            ))}
          </div>
        </div>
        <div class="l2-faq__list">
          {[1, 2, 3, 4].map((n) => (
            <details key={n}>
              <summary>{t(`faq.${n}.q`)}</summary>
              <p>{t(`faq.${n}.a`)}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

/** CLOSING — the Sunday photo band: start, call (→ the people, REQ-092), demo */
export function Closing({ t }: L3Ctx) {
  return (
    <div class="l3-close" data-cy="l3-final">
      <img
        class="l3-close__bg"
        src={adPhoto("domingo")}
        alt=""
        loading="lazy"
      />
      <div class="l3-close__in">
        <h2 class="l2-h l2-h2 l3-close__h">{t("closeH")}</h2>
        <p class="l3-close__sub">{t("closeSub")}</p>
        <div class="l3-close__ctas">
          <a class="l2-btn l2-btn--primary" href="#empezar">{t("navCta")}</a>
          <a class="l2-btn l2-btn--ghost" href="#llamanos">{t("callUs")}</a>
          <a class="l2-btn l2-btn--ghost" href="#demo">{t("bookDemo")}</a>
        </div>
      </div>
    </div>
  );
}

/** FOOTER — the brand, the phone, the email, the address, the four policy links, the year */
export function Footer({ t }: L3Ctx) {
  const year = new Date().getFullYear();
  return (
    <footer class="l2-footer" data-cy="l3-footer">
      <div class="l2-footer__in">
        <div class="l2-footer__top">
          <div class="l2-footer__brand">
            <img src={MONSTER_IMG} alt="" />
            <Brand cls="" />
          </div>
          <div class="l2-footer__contact">
            <a href={SUPPORT_PHONE_HREF} data-site-phone>
              {SUPPORT_PHONE_DISPLAY}
            </a>
            <a href={EMAIL_HREF}>{EMAIL}</a>
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
          <span class="l2-footer__copy">{t("copyright", { year })}</span>
        </nav>
      </div>
    </footer>
  );
}

/** the sticky bar on a phone: start, call (→ the people, REQ-092) */
export function StickyBar({ t }: L3Ctx) {
  return (
    <div class="l2-stickybar" data-cy="l3-stickybar">
      <a class="l2-btn l2-btn--primary l2-btn--bar" href="#empezar">
        {t("navCta")}
      </a>
      <a class="l2-btn l2-btn--dark l2-btn--bar" href="#llamanos">
        {t("callUs")}
      </a>
    </div>
  );
}

/** everything from the signup down — the part /landing3 and /landing4 share verbatim */
export function Body(ctx: L3Ctx) {
  return (
    <>
      <Signup {...ctx} />
      <Proof {...ctx} />
      <Outcomes {...ctx} />
      <Contact {...ctx} />
      <Team {...ctx} />
      <Demo {...ctx} />
      <Plans {...ctx} />
      <Faq {...ctx} />
      <Closing {...ctx} />
    </>
  );
}
