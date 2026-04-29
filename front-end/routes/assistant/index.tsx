import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AsstThreads from "../../islands/AsstThreads.tsx";
import AsstChat from "../../islands/AsstChat.tsx";
import AsstDocPane from "../../islands/AsstDocPane.tsx";
import { ChatHeader } from "../../components/AssistantSections.tsx";
import { SEED_THREADS, seedTotal } from "../../lib/asst-seed.ts";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default define.page(function AssistantHome(ctx) {
  const user = ctx.state.user;
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

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
            <AsstThreads threads={SEED_THREADS} total={seedTotal()} />
            <div class="asst__chat-wrap">
              <section class="chat">
                <ChatHeader client="New conversation" status="Tell Bossie about a job — voice or text" />
                <AsstChat initialMessages={[]} />
              </section>
            </div>
            <AsstDocPane />
          </div>
        </main>
      </div>
    </>
  );
});
