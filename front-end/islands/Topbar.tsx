import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/ui/Icon.tsx";
import { dashboardClient, type Notification } from "../clients/dashboard.ts";

interface Props {
  greeting: string;
  initialUnread?: number;
  initialNotifications?: Notification[];
}

export default function Topbar({ greeting, initialUnread = 0, initialNotifications = [] }: Props) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Notification[]>(initialNotifications);
  const [tickerIdx, setTickerIdx] = useState(0);

  useEffect(() => {
    let stopped = false;

    async function pollUnread() {
      try {
        const { count } = await dashboardClient.unreadCount();
        if (!stopped) setUnread(count);
      } catch { /* ignore */ }
    }
    async function pollItems() {
      try {
        const next = await dashboardClient.notifications(10);
        if (!stopped) setItems(next);
      } catch { /* ignore */ }
    }

    const idA = setInterval(pollUnread, 30_000);
    const idB = setInterval(pollItems, 10_000);
    return () => { stopped = true; clearInterval(idA); clearInterval(idB); };
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const id = setInterval(() => setTickerIdx((n) => n + 1), 4_000);
    return () => clearInterval(id);
  }, [items.length]);

  const ticker = items.length > 0 ? items[tickerIdx % items.length] : undefined;

  return (
    <header class="topbar">
      <a href="/" class="topbar__brand" aria-label="Paperwork Monster home" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:inherit;margin-right:14px">
        <img src="/logo.png" alt="" height="26" style="height:26px;width:auto;display:block" />
      </a>
      <div class="topbar__greeting">{greeting} <span aria-hidden="true">👋</span></div>
      <input type="search" placeholder="Search jobs, customers, invoices…" class="topbar__search" />
      <div class="topbar__right">
        {ticker ? (
          <span class="micro" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            {ticker.title}
          </span>
        ) : null}
        <button class="bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Icon name="bell" />
          {unread > 0 ? <span class="bell__dot" /> : null}
        </button>
      </div>
    </header>
  );
}
