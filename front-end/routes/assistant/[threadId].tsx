import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat from "../../islands/AsstChat.tsx";
import { ChatHeader } from "../../components/AssistantSections.tsx";
import { assistantClient, type Conversation, type ConversationDetail } from "../../clients/assistant.ts";

export default define.page(async function AssistantThread(ctx) {
  const threadId = ctx.params.threadId;
  const user = ctx.state.user;
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];

  const sessionId = getSessionId(ctx.req);

  // Fetch detail + the threads list in parallel. LoadConversation also
  // clears hasUnreadEvent server-side, so by the time the sidebar list
  // resolves the badge is already gone for the active thread.
  const [detail, initialThreads] = await Promise.all([
    assistantClient.conversation(threadId, { sessionId }).catch(() => undefined as ConversationDetail | undefined),
    assistantClient.conversations(50, { sessionId }).catch(() => [] as Conversation[]),
  ]);

  const headerTitle = detail?.conversation?.customerName
    ?? detail?.conversation?.title
    ?? "New conversation";
  const headerStatus = detail?.conversation?.currentPhase
    ? `Phase: ${detail.conversation.currentPhase}`
    : "Tell Bossie about a job — voice or text";

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
                <ChatHeader client={headerTitle} status={headerStatus} />
                <AsstChat
                  conversationId={threadId}
                  initialMessages={detail?.messages ?? []}
                  initialCustomer={detail?.customer}
                  initialContract={detail?.contract}
                />
              </section>
            </div>
          </div>
        </main>
      </div>
    </>
  );
});
