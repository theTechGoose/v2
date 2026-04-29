import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat from "../../islands/AsstChat.tsx";
import { ChatHeader } from "../../components/AssistantSections.tsx";
import { assistantClient, type Conversation } from "../../clients/assistant.ts";

export default define.page(async function AssistantHome(ctx) {
  const user = ctx.state.user;
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];

  const sessionId = getSessionId(ctx.req);
  let initialThreads: Conversation[] = [];
  try {
    initialThreads = await assistantClient.conversations(50, { sessionId });
  } catch {
    // Backend down / unauthenticated — render the shell with an empty
    // sidebar; the polling island will retry once the user is online.
  }

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
            <AsstThreads initialThreads={initialThreads} />
            <div class="asst__chat-wrap">
              <section class="chat">
                <ChatHeader client="New conversation" status="Tell Bossie about a job — voice or text" />
                <AsstChat initialMessages={[]} />
              </section>
            </div>
          </div>
        </main>
      </div>
    </>
  );
});
