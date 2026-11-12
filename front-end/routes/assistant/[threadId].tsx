import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { getSessionId } from "../../lib/auth.ts";
import { ssrBackendGetAuthed } from "../../lib/backend-fetch.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat, { deriveUserInitials } from "../../islands/AsstChat.tsx";
import ChatHeaderLive from "../../islands/ChatHeaderLive.tsx";
import { numberedLabel } from "../../../shared/documents/numbering.ts";
import {
  deriveChatHeader,
  draftOwesDetails,
} from "../../../shared/quote-flow/chat-header.ts";
import {
  type Conversation,
  type ConversationDetail,
} from "../../clients/assistant.ts";
import { profileClient, type ProfileSnapshot } from "../../clients/profile.ts";
import OnboardingProgress from "../../islands/OnboardingProgress.tsx";
import { tFor } from "../../lib/i18n.ts";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

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
  const greetingName = greetingFirstName(user?.name);

  const businessName = profile?.identity?.businessName ??
    profile?.identity?.displayName;
  const userInitials = profile?.initials && profile.initials !== "?"
    ? profile.initials
    : deriveUserInitials({
      name: user?.name,
      businessName,
      phoneNumber: user?.phoneNumber,
    });

  // REQ-369 (demo m2): the server-rendered status line is the rule the
  // island dispatches once it hydrates — never "Phase: terms" first.
  // REQ-385 (cycle 2, m6): the title too — the job name, then "· customer"
  // — so the first paint does not say the customer and then flip.
  const ssrHeader = detail
    ? deriveChatHeader({
      customerName: detail.customer?.name,
      // REQ-447 (cycle 3, p8-pair10-d): the list's title fallback too.
      title: detail.conversation?.title,
      quote: detail.quote,
      messages: detail.messages ?? [],
      detailsPending: draftOwesDetails(detail.draft),
      // REQ-700 (cycle 5, m20): the bill as the invoice row says it now.
      invoiceStatus: detail.invoiceStatus,
    })
    : null;
  const headerTitle = ssrHeader?.clientName ??
    tFor(lang, ssrHeader?.clientKey ?? "assistantThread.newConversation");
  // REQ-465 (demo cycle 3, m37): the first paint already names the number.
  const headerStatus = ssrHeader
    ? numberedLabel(ssrHeader.number, tFor(lang, ssrHeader.statusKey))
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
        <DocTitle
          lang={lang}
          title={(l) => tFor(l, "assistantThread.pageTitle")}
        />
        <link rel="stylesheet" href={asset("/assistant-page.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="messages" />
        <main class="main">
          <DashTopbar
            greetingDate={tFor(lang, "assistantThread.greetingDate")}
            greetingName={greetingName}
            greetingOverrideKey="assistantThread.greetingOverride"
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
                  initialTitle={detail?.conversation?.title}
                  initialDraft={detail?.draft}
                  initialInvoiceStatus={detail?.invoiceStatus}
                  userInitials={userInitials}
                  from={{
                    business: businessName,
                    name: user?.name,
                    phone: user?.phoneNumber,
                    email: profile?.user?.email,
                    website: profile?.identity?.websiteUrl,
                  }}
                  sendLanguages={profile?.identity?.commsLanguages ??
                    (profile?.identity?.commsLanguage
                      ? [profile.identity.commsLanguage]
                      : ["en"])}
                  invoiceNetDays={profile?.identity?.invoiceNetDays}
                />
              </section>
            </div>
          </div>
          <SiteFooter lang={lang} compact />
        </main>
      </div>
    </>
  );
});
