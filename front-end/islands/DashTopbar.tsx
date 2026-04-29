import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { dashboardClient, type Notification } from "../clients/dashboard.ts";

interface Props {
  greetingDate: string;
  greetingName: string;
  /** When set, replaces the default "Hey, {name} 👋" line verbatim. Used by the Assistant route. */
  greetingOverride?: string;
  initialUnread?: number;
  initialNotifications?: Notification[];
}

const FALLBACK_TICKER: { html: string; time: string }[] = [
  { html: "<strong>Tom &amp; Linda</strong> opened your quote", time: "2m" },
  { html: "<strong>Cobblestone Cafe</strong> paid $1,000",     time: "18m" },
  { html: "<strong>Sarah Chen</strong> sent a photo",            time: "41m" },
  { html: "<strong>Marcus Lin</strong> signed the quote",        time: "1h" },
];

function fmtAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(1, Math.floor((Date.now() - t) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function DashTopbar({ greetingDate, greetingName, greetingOverride, initialUnread = 0, initialNotifications = [] }: Props) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Notification[]>(initialNotifications);
  const [tickerIdx, setTickerIdx] = useState(0);

  useEffect(() => {
    let stopped = false;
    const idA = setInterval(async () => {
      try { const { count } = await dashboardClient.unreadCount(); if (!stopped) setUnread(count); } catch { /* ignore */ }
    }, 30_000);
    const idB = setInterval(async () => {
      try { const next = await dashboardClient.notifications(10); if (!stopped) setItems(next); } catch { /* ignore */ }
    }, 10_000);
    return () => { stopped = true; clearInterval(idA); clearInterval(idB); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTickerIdx((n) => n + 1), 3_800);
    return () => clearInterval(id);
  }, []);

  const liveItems = items.length > 0 ? items : null;
  const ticker = liveItems
    ? { html: liveItems[tickerIdx % liveItems.length].title, time: fmtAgo(liveItems[tickerIdx % liveItems.length].createdAt) }
    : FALLBACK_TICKER[tickerIdx % FALLBACK_TICKER.length];

  return (
    <header class="topbar">
      <button class="topbar__menu" type="button" aria-label="Toggle sidebar">
        <I d={<><path d="M3 6h18M3 12h18M3 18h18" /></>} size={18} />
      </button>
      <div class="topbar__greet">
        <div class="topbar__greet-line">{greetingDate}</div>
        <div class="topbar__greet-name">{greetingOverride ?? `Hey, ${greetingName} 👋`}</div>
      </div>
      <div class="topbar__search">
        <I d={ICN.search} size={16} />
        <input placeholder="Search jobs, clients, invoices..." />
        <span class="topbar__kbd">⌘K</span>
      </div>
      <button type="button" class="topbar__ticker" aria-label="Live activity">
        <span class="topbar__ticker-dot" />
        <span class="topbar__ticker-track" aria-live="polite">
          <span class="topbar__ticker-item" key={tickerIdx} dangerouslySetInnerHTML={{ __html: ticker.html }} />
        </span>
        <span class="topbar__ticker-time">{ticker.time} ago</span>
      </button>
      <button type="button" class="topbar__btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <I d={ICN.bell} size={18} />
        {unread > 0 ? <span class="topbar__btn-dot" /> : null}
      </button>
    </header>
  );
}
