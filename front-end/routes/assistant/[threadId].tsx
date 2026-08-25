import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import { ssrBackendGetAuthed } from "../../lib/backend-fetch.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat, { deriveUserInitials } from "../../islands/AsstChat.tsx";
import ChatHeaderLive from "../../islands/ChatHeaderLive.tsx";
import {
  type Conversation,
  type ConversationDetail,
} from "../../clients/assistant.ts";
import { profileClient, type ProfileSnapshot } from "../../clients/profile.ts";
import OnboardingProgress from "../../islands/OnboardingProgress.tsx";
import { tFor } from "../../lib/i18n.ts";

export default define.page(async function AssistantThread(ctx) {
  const threadId = ctx.params.threadId;
  const user = ctx.state.user;

  const sessionId = getSessionId(ctx.req);

  // Fetch detail + the threads list + profile in parallel. LoadConversation
  // also clears hasUnreadEvent server-side, so by the time the sidebar list
  // resolves the badge is already gone for the active thread. Profile gives
  // us the canonical initials (matches the sidebar disc).
  // Conversation detail uses the in-process backend (when available) so
  // SSR works on Deno Deploy without a reachable BACKEND_URL — the
  // localhost:3000 default 500s in prod and the public-URL self-fetch
  // would 508 (Loop Detected). The list + profile still go through the
  // regular HTTP client (the existing path is fine in dev; on prod they
  // go through their own callers / are tolerant of empty fallbacks).
  const detailRes = await ssrBackendGetAuthed<ConversationDetail>(
    `/agents/conversations/${threadId}`,
    sessionId,
  ).catch(() => ({ ok: false, status: 0 } as { ok: false; status: number }));
  const detail = detailRes.ok ? detailRes.data : undefined;
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

  const lang = profile?.user?.language ?? "en";
  const greetingName =
    (user?.name?.trim() || tFor(lang, "assistantThread.greetingFallback"))
      .split(" ")[0];

  const businessName = profile?.identity?.businessName ??
    profile?.identity?.displayName;
  const userInitials = profile?.initials && profile.initials !== "?"
    ? profile.initials
    : deriveUserInitials({
      name: user?.name,
      businessName,
      phoneNumber: user?.phoneNumber,
    });

  const headerTitle = detail?.conversation?.customerName ??
    detail?.conversation?.title ??
    tFor(lang, "assistantThread.newConversation");
  const headerStatus = detail?.conversation?.currentPhase
    ? tFor(lang, "assistantThread.phasePrefix", {
      phase: detail.conversation.currentPhase,
    })
    : tFor(lang, "assistantThread.statusFallback");

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
  const addr = profile?.address as {
    state?: string;
    postal?: string;
    postalCode?: string;
  } | undefined;
  const profileFilled = {
    name: !!profile?.user?.name?.trim(),
    biz: !!(profile?.identity?.businessName?.trim() ??
      profile?.identity?.legalName?.trim()),
    state: !!addr?.state?.trim(),
    address: !!(addr?.postal?.trim() ?? addr?.postalCode?.trim()),
  };
  const initialStep = (Number(profileFilled.name) + Number(profileFilled.biz) +
    Number(profileFilled.state) + Number(profileFilled.address)) as
      | 0
      | 1
      | 2
      | 3
      | 4;
  // Hide the progress strip once the user has any real activity in this
  // thread (quote drafted, customer attached, quote sent). The
  // address question is the only step likely to remain "incomplete"
  // after the user has moved on to real work — showing "One left." on
  // a thread with a sent quote is just confusing (audit2 N8).
  const conversationPhase = detail?.conversation?.currentPhase;
  // Real activity = a bound customer, a bound quote, or the thread has
  // advanced to the terms phase. ("quote" and "terms" are the only phases —
  // see AgentPhase in the backend.)
  const hasActivity = !!detail?.customer || !!detail?.quote ||
    conversationPhase === "terms";
  const showOnboardBanner = isOnboard && initialStep < 4 && !hasActivity;

  return (
    <>
      <Head>
        <title>{tFor(lang, "assistantThread.pageTitle")}</title>
        <link rel="stylesheet" href="/assistant-page.css" />
      </Head>
      <div class="app">
        <DashSidebar active="messages" />
        <main class="main">
          <DashTopbar
            greetingDate={tFor(lang, "assistantThread.greetingDate")}
            greetingName={greetingName}
            greetingOverride={tFor(lang, "assistantThread.greetingOverride")}
          />
          <div class="asst">
            <AsstThreads initialThreads={initialThreads} activeId={threadId} />
            <div class="asst__chat-wrap">
              <section class="chat">
                {showOnboardBanner && (
                  <OnboardingProgress initialStep={initialStep} />
                )}
                <ChatHeaderLive
                  initialClient={headerTitle}
                  initialStatus={headerStatus}
                />
                <AsstChat
                  conversationId={threadId}
                  initialMessages={detail?.messages ?? []}
                  initialCustomer={detail?.customer}
                  initialQuote={detail?.quote}
                  userInitials={userInitials}
                  from={{
                    business: businessName,
                    name: user?.name,
                    phone: user?.phoneNumber,
                    email: profile?.user?.email,
                  }}
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
