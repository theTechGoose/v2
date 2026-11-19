import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { isPlaceholderName } from "../../../shared/quote-flow/outbound-identity.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import type { Lang } from "../../lib/lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { appTitle } from "../../lib/doc-title.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { tFor } from "../../lib/i18n.ts";
import { greetingDate as greetingDateIn } from "../../lib/greeting-date.ts"; // REQ-944
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import DashboardPage from "../../islands/DashboardPage.tsx";
import AssistantCoachmark from "../../islands/AssistantCoachmark.tsx";
import WelcomeBackToast from "../../islands/WelcomeBackToast.tsx";
import StaffNamePrompt from "../../islands/StaffNamePrompt.tsx";

export default define.page(function Dashboard(ctx) {
  const user = ctx.state.user;
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  // UX-27: the seeded placeholder ("Nuevo usuario"/"New user") is not a real
  // name — never greet the user as "Nuevo"; greet namelessly instead.
  // REQ-624: the signed-in person (the editor while acting); never the placeholder
  const realName = greetingFirstName(user);
  // REQ-423 — no server-translated fallback baked in as a name ("Hola, hola")
  const greetingName = realName?.split(/\s+/)[0];
  // Passed as a dict KEY so the topbar re-localizes it live when the
  // language toggle flips (an SSR string would stay frozen).
  const greetingOverrideKey = realName
    ? undefined
    : "dashTopbar.greetingNoName";
  // REQ-355 — staff skip the customer wizard (REQ-227), its name question too: ask here
  const askName = user?.superAdmin === true && isPlaceholderName(user?.name);
  // REQ-944: today in the business's zone, not the server's
  const greetingDate = greetingDateIn(lang, user?.businessTimezone);

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => appTitle(l, tFor(l, "nav.home"))}
        />
        <link rel="stylesheet" href={asset("/dashboard.css")} />
      </Head>

      <div class="app">
        {
          /* Main precedes the sidebar in the DOM (CSS `.sb { order: -1 }`
            keeps it visually left) so on phones the first "My Assistant"
            link in document order is the visible in-page CTA, not the
            same-named pill inside the off-canvas drawer (PDF p8). */
        }
        <main class="main">
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
            greetingOverrideKey={greetingOverrideKey}
          />
          <div class="content">
            {askName && <StaffNamePrompt />}
            <DashboardPage />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
        <DashSidebar active="home" />
      </div>
      {
        /* One-shot coachmark — self-gates on localStorage so SSR is
          unaffected and the overlay only appears on a user's first
          visit after onboarding. */
      }
      <AssistantCoachmark />
      {
        /* Welcome-back pill — self-gates on ?welcome=back; renders
          nothing for fresh users or already-on-page navigation. */
      }
      <WelcomeBackToast />
    </>
  );
});
