import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import { ssrBackendGetAuthed } from "../../lib/backend-fetch.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat, { deriveUserInitials } from "../../islands/AsstChat.tsx";
import ChatHeaderLive from "../../islands/ChatHeaderLive.tsx";
import RedirectToast from "../../islands/RedirectToast.tsx";
import { type Conversation } from "../../clients/assistant.ts";
import { profileClient, type ProfileSnapshot } from "../../clients/profile.ts";
import { tFor } from "../../lib/i18n.ts";

export default define.page(async function AssistantHome(ctx) {
  const user = ctx.state.user;

  const sessionId = getSessionId(ctx.req);

  // ?onboard=1 entry: spin up a fresh conversation pre-seeded with
  // Bossie's first ask and bounce the user into it. The first ask is
  // already SSR-rendered (because it lives in the message store) so
  // the user lands on a chat that already has a question waiting.
  //
  // This MUST go through the in-process backend: on Deno Deploy the HTTP
  // api client 500s/508s SSR-side, which used to silently drop the user on
  // an empty /assistant?onboard=1 chat ("0 messages" limbo). On any failure
  // we send them to the dashboard — now reachable without onboarding and
  // carrying the SetupChecklist nudge — rather than stranding them here.
  // New-user onboarding now lives in the first-sign-in wizard at /welcome, not
  // the chat state machine. Anything still arriving here with ?onboard=1 (old
  // links, the assistant `?onboard=1` deep-link) is forwarded to /welcome,
  // which owns the single onboarding redirect (and bounces already-onboarded
  // users to /dashboard). The chat `onboarding-start` flow + handle-chat-message
  // state machine stay in place as a backstop for existing half-onboarded users.
  const url = new URL(ctx.req.url);
  if (url.searchParams.has("onboard")) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/welcome" },
    });
  }

  // In-process SSR fetch — see [threadId].tsx note. The standard HTTP
  // path 500s on Deno Deploy when BACKEND_URL isn't set.
  const threadsRes = await ssrBackendGetAuthed<Conversation[]>(
    `/agents/conversations?limit=50`,
    sessionId,
  )
    .catch(() => ({ ok: false, status: 0 } as { ok: false; status: number }));
  const initialThreads = (threadsRes.ok && Array.isArray(threadsRes.data))
    ? threadsRes.data
    : [];
  const profile = await profileClient.get({ sessionId }).catch(() =>
    null as ProfileSnapshot | null
  );
  const lang = profile?.user?.language === "es" ? "es" : "en";

  const greetingName = user?.name?.trim()
    ? user.name.trim().split(" ")[0]
    : tFor(lang, "common.thereFallback");

  const businessName = profile?.identity?.businessName ??
    profile?.identity?.displayName;
  const userInitials = profile?.initials && profile.initials !== "?"
    ? profile.initials
    : deriveUserInitials({
      name: user?.name,
      businessName,
      phoneNumber: user?.phoneNumber,
    });

  return (
    <>
      <Head>
        <title>{tFor(lang, "assistantPage.docTitle")}</title>
        <link rel="stylesheet" href="/assistant-page.css" />
      </Head>

      <RedirectToast />
      <div class="app">
        <DashSidebar active="messages" />
        <main class="main">
          <DashTopbar
            greetingDate={tFor(lang, "assistantPage.greetingDate")}
            greetingName={greetingName}
            greetingOverride={tFor(lang, "assistantPage.greetingOverride")}
          />
          <div class="asst">
            <AsstThreads initialThreads={initialThreads} />
            <div class="asst__chat-wrap">
              <section class="chat">
                <ChatHeaderLive
                  initialClient={tFor(lang, "assistantPage.newConversation")}
                  initialStatus={tFor(lang, "assistantPage.assistantHelp")}
                />
                <AsstChat
                initialMessages={[]}
                userInitials={userInitials}
                sendLanguages={profile?.identity?.commsLanguages ??
                  (profile?.identity?.commsLanguage
                    ? [profile.identity.commsLanguage]
                    : ["en"])}
              />
              </section>
            </div>
          </div>
        </main>
      </div>
    </>
  );
});
