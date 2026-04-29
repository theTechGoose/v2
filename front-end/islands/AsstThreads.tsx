import { I, ICN } from "../lib/dash-icons.tsx";

interface ThreadEntry { id: string; client: string; preview: string; time: string; chip: "sent" | "draft" | "needs" | "paid"; chipLabel: string; active?: boolean }
interface ThreadGroup { group: string; items: ThreadEntry[] }

interface Props { threads: ThreadGroup[]; total: number }

export default function AsstThreads({ threads, total }: Props) {
  return (
    <aside class="threads">
      <div class="threads__head">
        <h3 class="threads__title">Conversations</h3>
        <span class="threads__count">{total}</span>
      </div>
      <a href="/assistant" class="threads__new" style="text-decoration:none">
        <I d={ICN.plus} size={14} sw={2.5} />
        New conversation
        <span class="threads__new-kbd">⌘N</span>
      </a>
      <div class="threads__list">
        {threads.map((group) => (
          <div key={group.group}>
            <div class="threads__group-label">{group.group}</div>
            {group.items.map((t) => (
              <a
                key={t.id}
                href={`/assistant/${t.id}`}
                class={`thread ${t.active ? "thread--active" : ""}`}
                style="text-decoration:none;text-align:left;width:100%;display:block"
              >
                <div class="thread__head">
                  <span class="thread__client">{t.client}</span>
                  <span class="thread__time">{t.time}</span>
                </div>
                <div class="thread__preview">{t.preview}</div>
                <div class="thread__chips">
                  <span class={`thread__chip thread__chip--${t.chip}`}>{t.chipLabel}</span>
                </div>
              </a>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
