import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import SiteFooter from "../components/SiteFooter.tsx";
import { getSessionId, loadUser } from "../lib/auth.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";
import { type ProfileSnapshot } from "../clients/profile.ts";
import { ssrBackendGetAuthed } from "../lib/backend-fetch.ts";
import WelcomeWizard from "../islands/WelcomeWizard.tsx";
import { MetaPixelEvent } from "../components/MetaPixel.tsx";
import {
  registrationEvent,
  subscribeEventFrom,
} from "../../shared/meta-pixel/pixel.ts";

/**
 * /welcome — the first-sign-in onboarding wizard.
 *
 * Entered by exactly ONE redirect at first sign-in (verify → /welcome) and by
 * voluntary visits. It is the ONLY place that redirects on onboarding state,
 * and it does so in one direction only:
 *   - no session          → 302 /            (sign in first)
 *   - already onboarded    → 302 /dashboard   (skip is permanent, no re-trap)
 *   - otherwise            → render the wizard
 *
 * No middleware anywhere else gates navigation on profile completeness — a
 * brand-new user who skips everything can still reach every page.
 */
export default define.page(async function Welcome(ctx) {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }

  // In-process SSR fetch — the HTTP profile client self-fetches the public URL
  // (508 Loop Detected on Deno Deploy) or falls back to BACKEND_URL=localhost,
  // which fails in prod and left this page stuck on welcome.loadError. Go
  // through the in-process backend handler like the assistant routes do.
  const sessionId = getSessionId(ctx.req);
  const snapRes = await ssrBackendGetAuthed<ProfileSnapshot>(
    "/profile",
    sessionId,
  ).catch(() => ({ ok: false as const, status: 0 }));
  const snapshot: ProfileSnapshot | null = snapRes.ok && snapRes.data
    ? snapRes.data
    : null;

  // Already finished (or skipped) onboarding → never trap them here again.
  if (snapshot?.user?.onboardedAt) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    });
  }

  const subscribed = subscribeEventFrom(ctx.url.searchParams.get("px"));

  const lang: Lang = (snapshot?.user?.language === "es" ||
      snapshot?.user?.language === "en")
    ? snapshot.user.language
    : (langFromCookie(ctx.req.headers.get("cookie")) ??
      pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language")));

  return (
    <>
      <Head>
        <title>
          {tFor(lang, "welcome.docTitle")} · {tFor(lang, "brand.name")}
        </title>
        <link key="css-welcome" rel="stylesheet" href="/welcome.css" />
        <link key="css-plan-cards" rel="stylesheet" href="/plan-cards.css" />
        {
          /* REQ-080: a new account on the wizard is a CompleteRegistration
            for the ads (once per account on this browser); the receipt's way
            back (/plan/return ?px=sub:…) is a Subscribe with the plan's price. */
        }
        <MetaPixelEvent event={registrationEvent(user.id)} />
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
