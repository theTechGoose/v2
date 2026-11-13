import { asset, Head } from "fresh/runtime";
import { personLanguage } from "../../shared/person-name/mod.ts"; // REQ-631
import { define } from "../utils.ts";
import DocTitle from "../components/DocTitle.tsx";
import SiteFooter from "../components/SiteFooter.tsx";
import { loadUser } from "../lib/auth.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";
import { loadProfileSnapshot } from "../lib/onboarding-gate.ts";
import {
  isStaff,
  onboardingAnswered,
} from "../../shared/quote-flow/onboarding-questions.ts";
import WelcomeWizard from "../islands/WelcomeWizard.tsx";
import { MetaPixelEvent } from "../components/MetaPixel.tsx";
import { subscribeEventFrom } from "../../shared/meta-pixel/pixel.ts";
import { registrationForRequest } from "../lib/pixel-registration.ts";

/**
 * /welcome — the onboarding wizard.
 *
 * REQ-091: onboarding happens until every one of its questions is answered.
 * Entered by every verified code while a question is open (the backend's
 * redirectTo), by the dashboard's gate (routes/dashboard/_middleware.ts) and
 * by voluntary visits. It redirects in one direction only:
 *   - no session              → 302 /           (sign in first)
 *   - every question answered → 302 /dashboard  (nothing left to ask)
 *   - otherwise               → render the wizard: the open questions alone,
 *                               never one already answered (REQ-121)
 *
 * Skip puts a question off for now; the skip stamp (`onboardedAt`) is a
 * record, never a gate — the wizard asks again next time. REQ-227: a step's
 * Skip stamps the question deferred, which opens the dashboard (not this
 * page's rule); staff (super admins) are never sent through this wizard.
 */
export default define.page(async function Welcome(ctx) {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }

  // In-process SSR fetch (lib/onboarding-gate.ts) — the HTTP profile client
  // self-fetches the public URL (508 Loop Detected on Deno Deploy) or falls
  // back to BACKEND_URL=localhost, which fails in prod and left this page
  // stuck on welcome.loadError.
  const snapshot = await loadProfileSnapshot(ctx.req);

  // REQ-091: nothing left to ask → the dashboard. (A profile that cannot load
  // shows the load error below, never a loop.) REQ-227: staff never meet the
  // customer wizard (nor its CompleteRegistration pixel).
  if (snapshot && (onboardingAnswered(snapshot) || isStaff(snapshot))) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    });
  }

  const subscribed = subscribeEventFrom(ctx.url.searchParams.get("px"));
  // REQ-229: the person on their own account — not a staff login, not a
  // staff member impersonating them (the demo stage's frame).
  const registered = await registrationForRequest(ctx.req);

  const lang: Lang = personLanguage(snapshot?.user, snapshot?.actor) ??
    (langFromCookie(ctx.req.headers.get("cookie")) ??
      pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language")));

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) =>
            `${tFor(l, "welcome.docTitle")} · ${tFor(l, "brand.name")}`}
        />
        <link key="css-welcome" rel="stylesheet" href={asset("/welcome.css")} />
        <link
          key="css-plan-cards"
          rel="stylesheet"
          href={asset("/plan-cards.css")}
        />
        {
          /* REQ-080: a new account on the wizard is a CompleteRegistration
            for the ads (once per account on this browser) — REQ-229: only
            the account's own session, never staff or an impersonation; the
            receipt's way back (/plan/return ?px=sub:…) is a Subscribe with
            the plan's price. */
        }
        {registered ? <MetaPixelEvent event={registered} /> : null}
        {subscribed ? <MetaPixelEvent event={subscribed} /> : null}
      </Head>
      <div class="welcome-shell">
        <a
          href="/"
          class="welcome-shell__brand"
          aria-label={tFor(lang, "brand.name")}
        >
          <img
            src="/logo-monster.png"
            alt=""
            width={34}
            height={34}
          />
          <span>
            {tFor(lang, "brand.namePrefix")}
            <em>{tFor(lang, "brand.nameSuffix")}</em>
          </span>
        </a>
        {snapshot
          ? (
            <WelcomeWizard
              snapshot={snapshot}
              suggestedState={snapshot.suggestedState}
              initialLang={lang}
            />
          )
          : (
            <p class="welcome-shell__error">
              {tFor(lang, "welcome.loadError")}
            </p>
          )}
        <SiteFooter lang={lang} />
      </div>
    </>
  );
});
