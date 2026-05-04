import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import { api } from "../../lib/api.ts";
import { ssrBackendGetAuthed } from "../../lib/backend-fetch.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat, { deriveUserInitials } from "../../islands/AsstChat.tsx";
import ChatHeaderLive from "../../islands/ChatHeaderLive.tsx";
import RedirectToast from "../../islands/RedirectToast.tsx";
import { type Conversation } from "../../clients/assistant.ts";
import { profileClient, type ProfileSnapshot } from "../../clients/profile.ts";

export default define.page(async function AssistantHome(ctx) {
  const user = ctx.state.user;
  const greetingName = (user?.name?.trim() || "there").split(" ")[0];

  const sessionId = getSessionId(ctx.req);

  // ?onboard=1 entry: spin up a fresh conversation pre-seeded with
  // Bossie's first ask and bounce the user into it. The first ask is
  // already SSR-rendered (because it lives in the message store) so
  // the user lands on a chat that already has a question waiting.
  const url = new URL(ctx.req.url);
  if (url.searchParams.has("onboard")) {
    if (sessionId) {
      try {
        const r = await api.post<{ conversationId: string; seeded: boolean }>(
          "/agents/conversations/onboarding-start",
          {},
          { sessionId },
        );
        if (r?.conversationId) {
          return new Response(null, {
            status: 302,
            headers: { Location: `/assistant/${r.conversationId}?onboard=1` },
          });
        }
      } catch (err) {
        // Fall through to the regular landing on failure — user can
        // still type something to start a thread manually.
        console.error("[/assistant?onboard=1] start failed:", (err as Error).message);
      }
    }
  }

  // In-process SSR fetch — see [threadId].tsx note. The standard HTTP
  // path 500s on Deno Deploy when BACKEND_URL isn't set.
  const threadsRes = await ssrBackendGetAuthed<Conversation[]>(`/agents/conversations?limit=50`, sessionId)
    .catch(() => ({ ok: false, status: 0 } as { ok: false; status: number }));
  const initialThreads = (threadsRes.ok && Array.isArray(threadsRes.data)) ? threadsRes.data : [];
  const profile = await profileClient.get({ sessionId }).catch(() => null as ProfileSnapshot | null);

  const businessName = profile?.identity?.businessName ?? profile?.identity?.displayName;
  const userInitials = profile?.initials && profile.initials !== "?"
    ? profile.initials
    : deriveUserInitials({ name: user?.name, businessName, phoneNumber: user?.phoneNumber });

  return (
    <>
      <Head>
        <title>Assistant · Paperwork Monsters</title>
        <link rel="stylesheet" href="/assistant-page.css" />
      </Head>

      <RedirectToast />
      <div class="app">
        <DashSidebar active="messages" />
        <main class="main">
          <DashTopbar
            greetingDate="My assistant · always on"
            greetingName={greetingName}
            greetingOverride="What can I take off your plate?"
          />
          <div class="asst">
            <AsstThreads initialThreads={initialThreads} />
            <div class="asst__chat-wrap">
              <section class="chat">
                <ChatHeaderLive
                  initialClient="New conversation"
                  initialStatus="Tell Bossie about a job — voice or text"
                />
                <AsstChat initialMessages={[]} userInitials={userInitials} />
              </section>
            </div>
          </div>
        </main>
      </div>
    </>
  );
});
