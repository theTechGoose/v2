import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat from "../../islands/AsstChat.tsx";
import AsstDocPane from "../../islands/AsstDocPane.tsx";
import { ChatHeader } from "../../components/AssistantSections.tsx";
import { SEED_THREADS, seedTotal } from "../../lib/asst-seed.ts";
import { assistantClient, type ConversationDetail } from "../../clients/assistant.ts";

export default define.page(async function AssistantThread(ctx) {
  const threadId = ctx.params.threadId;
  const user = ctx.state.user;
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];

  const sessionId = getSessionId(ctx.req);
  let detail: ConversationDetail | undefined;
  try {
    detail = await assistantClient.conversation(threadId, { sessionId });
  } catch {
    // Conversation missing or backend down — fall through to empty AsstChat with this id.
  }

  const groups = SEED_THREADS.map((g) => ({
    ...g,
    items: g.items.map((t) => ({ ...t, active: t.id === threadId })),
  }));
  const headerTitle = detail?.conversation?.customerName
    ?? detail?.conversation?.title
    ?? "New conversation";
  const headerStatus = detail?.conversation?.phase
    ? `Phase: ${detail.conversation.phase}`
    : "Tell Bossie about a job — voice or text";

  return (
    <>
      <Head>
        <title>Assistant · Paperwork Monsters</title>
        <link rel="stylesheet" href="/assistant-page.css" />
      </Head>
      <div class="app">
        <DashSidebar
          active="messages"
          user={user ? { name: user.name, phoneNumber: user.phoneNumber } : undefined}
        />
        <main class="main">
          <DashTopbar
            greetingDate="My assistant · always on"
            greetingName={greetingName}
            greetingOverride="What can I take off your plate?"
          />
          <div class="asst">
            <AsstThreads threads={groups} total={seedTotal()} />
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
            <AsstDocPane />
          </div>
        </main>
      </div>
    </>
  );
});
