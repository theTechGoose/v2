import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { assistantClient, type Conversation } from "../clients/assistant.ts";

interface Props {
  initialThreads: Conversation[];
  activeId?: string;
}

type Chip = "sent" | "draft" | "needs" | "paid";

const POLL_MS = 8_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export default function AsstThreads({ initialThreads, activeId }: Props) {
  const [threads, setThreads] = useState<Conversation[]>(initialThreads);

  // Live-refresh: poll on an interval so a customer accept (which flips
  // hasUnreadEvent + bumps updatedAt server-side) shows up here without
  // a hard reload, and re-fetch on tab focus so coming back from another
  // tab is snappy.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const next = await assistantClient.conversations(50);
        if (!cancelled) setThreads(next);
      } catch {
        // Stay on the last good list rather than blanking the sidebar
        // on a transient network blip.
      }
    }
    const interval = setInterval(refresh, POLL_MS);
    function onVis() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVis);
    // Sync once on mount in case SSR's snapshot is already stale.
    refresh();
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const sorted = [...threads].sort((a, b) => tsOf(b.updatedAt) - tsOf(a.updatedAt));
  const groups = groupByRecency(sorted);
  const total = threads.length;

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
        {groups.length === 0
          ? <div class="threads__empty">No conversations yet — start one below.</div>
          : groups.map((group) => (
            <div key={group.label}>
              <div class="threads__group-label">{group.label}</div>
              {group.items.map((c) => {
                const chip = deriveChip(c);
                return (
                  <a
                    key={c.id}
                    href={`/assistant/${c.id}`}
                    class={`thread ${c.id === activeId ? "thread--active" : ""} ${c.hasUnreadEvent ? "thread--unread" : ""}`}
                    style="text-decoration:none;text-align:left;width:100%;display:block"
                  >
                    <div class="thread__head">
                      {c.hasUnreadEvent ? <span class="thread__unread-dot" aria-label="new event" /> : null}
                      <span class="thread__client">{titleFor(c)}</span>
                      <span class="thread__time">{fmtTime(c.updatedAt)}</span>
                    </div>
                    <div class="thread__preview">{c.preview ?? "—"}</div>
                    <div class="thread__chips">
                      <span class={`thread__chip thread__chip--${chip.kind}`}>{chip.label}</span>
                    </div>
                  </a>
                );
              })}
            </div>
          ))}
      </div>
    </aside>
  );
}

function titleFor(c: Conversation): string {
  return c.customerName?.trim() || c.title?.trim() || "New conversation";
}

/**
 * Map the most-advanced known status to one of the four chip CSS
 * variants (draft / sent / paid / needs). Walks the chain backwards —
 * invoice → contract → quote — so the chip reflects the latest stage
 * the conversation has reached, not the earliest.
 */
function deriveChip(c: Conversation): { kind: Chip; label: string } {
  // Walk the chain backwards (latest stage wins). Customer acceptance
  // is a single event on the contract — quoteStatus only ever reaches
  // "sent" in this flow, so no quote-accepted branch is needed.
  if (c.invoiceStatus === "paid")      return { kind: "paid",  label: "Paid" };
  if (c.invoiceStatus === "sent")      return { kind: "sent",  label: "Invoiced" };
  if (c.contractStatus === "accepted") return { kind: "paid",  label: "Signed" };
  if (c.contractStatus === "sent")     return { kind: "sent",  label: "Contract sent" };
  if (c.contractStatus === "draft")    return { kind: "needs", label: "Contract" };
  if (c.quoteStatus === "sent")        return { kind: "sent",  label: "Quote sent" };
  if (c.currentPhase === "terms")      return { kind: "needs", label: "Terms" };
  return { kind: "draft", label: "Drafting" };
}

function tsOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtTime(iso: string): string {
  const t = tsOf(iso);
  if (!t) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "now";
  if (diff < HOUR)   return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY)    return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return WEEKDAY_SHORT[new Date(t).getDay()];
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function groupByRecency(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart.getTime() - DAY;
  const weekStart = todayStart.getTime() - 7 * DAY;

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const week: Conversation[] = [];
  const older: Conversation[] = [];
  for (const c of convs) {
    const t = tsOf(c.updatedAt);
    if (t >= todayStart.getTime())   today.push(c);
    else if (t >= yesterdayStart)    yesterday.push(c);
    else if (t >= weekStart)         week.push(c);
    else                             older.push(c);
  }

  return [
    { label: "Today",     items: today },
    { label: "Yesterday", items: yesterday },
    { label: "This week", items: week },
    { label: "Earlier",   items: older },
  ].filter((g) => g.items.length > 0);
}
