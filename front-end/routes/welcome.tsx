import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
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
        <link rel="stylesheet" href="/welcome.css" />
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
          <span>{tFor(lang, "brand.namePrefix")}</span>
          <em>{tFor(lang, "brand.nameSuffix")}</em>
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
      </div>
    </>
  );
});
