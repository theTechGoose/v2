import type { Conversation } from "../clients/assistant.ts";

interface Props {
  groups: { label: string; items: Conversation[] }[];
  activeId?: string;
}

function fmtTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function Threads({ groups, activeId }: Props) {
  return (
    <aside class="threads" aria-label="Conversations">
      <header class="threads__head">
        <h3>Conversations</h3>
        <button class="btn btn-ghost" type="button" aria-label="New conversation">＋</button>
      </header>
      <div class="threads__list">
        {groups.map((g) => (
          <div key={g.label}>
            <div class="thread__group-label">{g.label}</div>
            {g.items.map((c) => (
              <a
                key={c.id}
                class={`thread ${activeId === c.id ? "active" : ""}`}
                href={`/assistant/${c.id}`}
              >
                <div class="thread__head">
                  <span class="thread__client">{c.customerName ?? c.title ?? "Untitled"}</span>
                  <span class="thread__time">{fmtTime(c.updatedAt)}</span>
                </div>
                {c.preview ? <div class="thread__preview">{c.preview}</div> : null}
              </a>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
