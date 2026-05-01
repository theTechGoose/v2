import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat, { deriveUserInitials } from "../../islands/AsstChat.tsx";
import ChatHeaderLive from "../../islands/ChatHeaderLive.tsx";
import { assistantClient, type Conversation, type ConversationDetail } from "../../clients/assistant.ts";
import { profileClient, type ProfileSnapshot } from "../../clients/profile.ts";
import OnboardingProgress from "../../islands/OnboardingProgress.tsx";

export default define.page(async function AssistantThread(ctx) {
  const threadId = ctx.params.threadId;
  const user = ctx.state.user;
  const greetingName = (user?.name?.trim() || "there").split(" ")[0];

  const sessionId = getSessionId(ctx.req);

  // Fetch detail + the threads list + profile in parallel. LoadConversation
  // also clears hasUnreadEvent server-side, so by the time the sidebar list
  // resolves the badge is already gone for the active thread. Profile gives
  // us the canonical initials (matches the sidebar disc).
  const [detail, initialThreads, profile] = await Promise.all([
    assistantClient.conversation(threadId, { sessionId }).catch(() => undefined as ConversationDetail | undefined),
    assistantClient.conversations(50, { sessionId }).catch(() => [] as Conversation[]),
    profileClient.get({ sessionId }).catch(() => null as ProfileSnapshot | null),
  ]);

  const businessName = profile?.identity?.businessName ?? profile?.identity?.displayName;
  const userInitials = profile?.initials && profile.initials !== "?"
    ? profile.initials
    : deriveUserInitials({ name: user?.name, businessName, phoneNumber: user?.phoneNumber });

  const headerTitle = detail?.conversation?.customerName
    ?? detail?.conversation?.title
    ?? "New conversation";
  const headerStatus = detail?.conversation?.currentPhase
    ? `Phase: ${detail.conversation.currentPhase}`
    : "Tell Bossie about a job — voice or text";

  // Surface a soft "we're getting you set up" banner when the user
  // arrived via /assistant?onboard=1. Shown only while the conversation
  // is still onboarding-shaped (≤2 user messages and the existing turns
  // are all assistant text). Drops out automatically once the user
  // answers both questions and Bossie hands off to the first quote.
  const isOnboard = new URL(ctx.req.url).searchParams.has("onboard");
  // Compute the initial onboarding step server-side from the profile so
  // the progress strip never flashes empty on first paint. Backend uses
  // `postal` on the wire; the FE's type definition has a stale name —
  // cast to a permissive shape so the gate works.
  const addr = (profile?.address as { state?: string; postal?: string; postalCode?: string } | undefined);
  const profileFilled = {
    name:    !!profile?.user?.name?.trim(),
    biz:     !!(profile?.identity?.businessName?.trim() ?? profile?.identity?.legalName?.trim()),
    state:   !!addr?.state?.trim(),
    address: !!(addr?.postal?.trim() ?? addr?.postalCode?.trim()),
  };
  const initialStep = (Number(profileFilled.name) + Number(profileFilled.biz) + Number(profileFilled.state) + Number(profileFilled.address)) as 0 | 1 | 2 | 3 | 4;
  // Hide the progress strip once the user has any real activity in this
  // thread (quote drafted, customer attached, contract sent). The
  // address question is the only step likely to remain "incomplete"
  // after the user has moved on to real work — showing "One left." on
  // a thread with a sent contract is just confusing (audit2 N8).
  const conversationPhase = detail?.conversation?.currentPhase;
  const hasActivity = !!detail?.customer || !!detail?.contract ||
    conversationPhase === "terms" || conversationPhase === "contract" ||
    conversationPhase === "invoice" || conversationPhase === "complete";
  const showOnboardBanner = isOnboard && initialStep < 4 && !hasActivity;

  return (
    <>
      <Head>
        <title>Assistant · Paperwork Monsters</title>
        <link rel="stylesheet" href="/assistant-page.css" />
      </Head>
      <div class="app">
        <DashSidebar active="messages" />
        <main class="main">
          <DashTopbar
            greetingDate="My assistant · always on"
            greetingName={greetingName}
            greetingOverride="What can I take off your plate?"
          />
          <div class="asst">
            <AsstThreads initialThreads={initialThreads} activeId={threadId} />
            <div class="asst__chat-wrap">
              <section class="chat">
                {showOnboardBanner && <OnboardingProgress initialStep={initialStep} />}
                <ChatHeaderLive initialClient={headerTitle} initialStatus={headerStatus} />
                <AsstChat
                  conversationId={threadId}
                  initialMessages={detail?.messages ?? []}
                  initialCustomer={detail?.customer}
                  initialContract={detail?.contract}
                  userInitials={userInitials}
                />
              </section>
            </div>
          </div>
        </main>
      </div>
    </>
  );
});
