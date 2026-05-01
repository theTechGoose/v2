import { useEffect, useState } from "preact/hooks";
import { I } from "../lib/dash-icons.tsx";
import { dashboardClient, type Notification } from "../clients/dashboard.ts";

interface Props {
  greetingDate: string;
  greetingName: string;
  /** When set, replaces the default "Hey, {name} 👋" line verbatim. Used by the Assistant route. */
  greetingOverride?: string;
  initialUnread?: number;
  initialNotifications?: Notification[];
}

// No fallback ticker — when the user has zero real notifications we hide
// the ticker entirely. Showing seeded "Cobblestone Cafe paid $1,000" to a
// brand-new account read as fake activity and misled first-run users.
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
    : null;

  return (
    <header class="topbar">
      <button
        class="topbar__menu"
        type="button"
        aria-label="Toggle sidebar"
        onClick={() => globalThis.dispatchEvent(new CustomEvent("pm:sb-toggle"))}
      >
        <I d={<><path d="M3 6h18M3 12h18M3 18h18" /></>} size={18} />
      </button>
      <div class="topbar__greet">
        <div class="topbar__greet-line">{greetingDate}</div>
        <div class="topbar__greet-name">{greetingOverride ?? `Hey, ${greetingName} 👋`}</div>
      </div>
      {/* Search + notifications drawer are not built yet; hide their
          affordances until the underlying features ship rather than
          advertise dead controls (audit #6, #7). */}
      <div style="flex:1" aria-hidden="true" />
      {ticker ? (
        // Anchored to /dashboard#activity so the pill is no longer inert:
        // on the dashboard it scrolls to the on-page activity panel; from
        // any other page it routes to the dashboard and lands on the same
        // anchor (#21 — the click was decorative on day 1).
        <a href="/dashboard#activity" class="topbar__ticker" aria-label="Live activity — open feed">
          <span class="topbar__ticker-dot" />
          <span class="topbar__ticker-track" aria-live="polite">
            <span class="topbar__ticker-item" key={tickerIdx} dangerouslySetInnerHTML={{ __html: ticker.html }} />
          </span>
          <span class="topbar__ticker-time">{ticker.time} ago</span>
        </a>
      ) : null}
    </header>
  );
}
