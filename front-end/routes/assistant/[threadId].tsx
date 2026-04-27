import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstComposer from "../../islands/AsstComposer.tsx";
import AsstDocPane from "../../islands/AsstDocPane.tsx";
import { ChatHeader, ChatScroll, Suggestions } from "../../components/AssistantSections.tsx";
import { SEED_THREADS, seedTotal } from "../../lib/asst-seed.ts";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default define.page(function AssistantThread(ctx) {
  const threadId = ctx.params.threadId;
  const user = ctx.state.user;
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

  // Mark active thread; if not in the seed, fall back to first
  const groups = SEED_THREADS.map((g) => ({
    ...g,
    items: g.items.map((t) => ({ ...t, active: t.id === threadId })),
  }));
  const activeThread = SEED_THREADS.flatMap((g) => g.items).find((t) => t.id === threadId);
  const headerTitle = activeThread ? `${activeThread.client} · Garage epoxy` : "New conversation";

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
                <ChatHeader client={headerTitle} status="Quote locked · finishing terms with Bossie" />
                <ChatScroll />
                <Suggestions />
                <AsstComposer conversationId={threadId} />
              </section>
            </div>
            <AsstDocPane />
          </div>
        </main>
      </div>
    </>
  );
});
