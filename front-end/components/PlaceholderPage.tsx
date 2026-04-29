import { Head } from "fresh/runtime";
import DashSidebar from "../islands/DashSidebar.tsx";
import DashTopbar from "../islands/DashTopbar.tsx";
import type { User } from "../lib/auth.ts";

interface Props {
  user?: User;
  active: string;
  title: string;
  blurb: string;
}

export function PlaceholderPage({ user, active, title, blurb }: Props) {
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  return (
    <>
      <Head>
        <title>{title} · Paperwork Monsters</title>
        <link rel="stylesheet" href="/dashboard.css" />
      </Head>
      <div class="app">
        <DashSidebar
          active={active}
          user={user ? { name: user.name, phoneNumber: user.phoneNumber } : undefined}
        />
        <main class="main">
          <DashTopbar
            greetingDate={`${title} · in progress`}
            greetingName={greetingName}
            greetingOverride={blurb}
          />
          <section style="padding:48px 32px;max-width:720px">
            <div style="border:1px dashed var(--line, #d8e0d4);border-radius:14px;padding:28px;background:#fff">
              <h2 style="margin:0 0 8px;font-size:22px">{title}</h2>
              <p style="margin:0;color:var(--fg-muted, #6b7560);line-height:1.55">
                {blurb}
              </p>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
