import { useEffect, useState } from "preact/hooks";
import { I } from "../lib/dash-icons.tsx";
import { dashboardClient, type Notification } from "../clients/dashboard.ts";
import { langSignal, tFor } from "../lib/i18n.ts";
import { capitalizeDateLine } from "../../shared/quote-flow/format-helpers.ts";

interface Props {
  /** @deprecated Ignored — the date is now computed reactively in-component
   *  so it re-localizes live on a language change instead of arriving frozen. */
  greetingDate?: string;
  greetingName: string;
  /** When set, replaces the default "Hey, {name} 👋" line verbatim. Used by the Assistant route. */
  greetingOverride?: string;
  initialUnread?: number;
  initialNotifications?: Notification[];
  lang?: "en" | "es";
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

// Full weekday / month name keys (same set the dashboard route uses). The
// greeting date is built here so it re-localizes live when langSignal flips,
// rather than arriving as a frozen pre-formatted string from the route.
const WEEKDAY_KEYS = [
  "dashboardPage.weekday.sunday",
  "dashboardPage.weekday.monday",
  "dashboardPage.weekday.tuesday",
  "dashboardPage.weekday.wednesday",
  "dashboardPage.weekday.thursday",
  "dashboardPage.weekday.friday",
  "dashboardPage.weekday.saturday",
];
const MONTH_KEYS = [
  "dashboardPage.month.january",
  "dashboardPage.month.february",
  "dashboardPage.month.march",
  "dashboardPage.month.april",
  "dashboardPage.month.may",
  "dashboardPage.month.june",
  "dashboardPage.month.july",
  "dashboardPage.month.august",
  "dashboardPage.month.september",
  "dashboardPage.month.october",
  "dashboardPage.month.november",
  "dashboardPage.month.december",
];

export default function DashTopbar(
  {
    greetingName,
    greetingOverride,
    initialUnread = 0,
    initialNotifications = [],
  }: Props,
) {
  // Reactive app language (seeded from user.language, flipped live by Settings).
  const lang = langSignal.value;
  const now = new Date();
  // ES weekday/month names are lowercase in the dict ("viernes · agosto"), but
  // this is the first line of the greeting — sentence-initial capital (P-65).
  const greetingDate = capitalizeDateLine(
    `${tFor(lang, WEEKDAY_KEYS[now.getDay()])} · ${
      tFor(lang, MONTH_KEYS[now.getMonth()])
    } ${now.getDate()}`,
    lang,
  );
  const [, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Notification[]>(initialNotifications);
  const [tickerIdx, setTickerIdx] = useState(0);
  // The data-cy hook appears only after hydration so a test can never click
  // the hamburger before the pm:sb-toggle listener (DashSidebar) is live —
  // pre-hydration clicks were the "hamburger does not work" bug (PDF p8).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let stopped = false;
    const idA = setInterval(async () => {
      try {
        const { count } = await dashboardClient.unreadCount();
        if (!stopped) setUnread(count);
      } catch { /* ignore */ }
    }, 30_000);
    const idB = setInterval(async () => {
      try {
        const next = await dashboardClient.notifications(10);
        if (!stopped) setItems(next);
      } catch { /* ignore */ }
    }, 10_000);
    return () => {
      stopped = true;
      clearInterval(idA);
      clearInterval(idB);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTickerIdx((n) => n + 1), 3_800);
    return () => clearInterval(id);
  }, []);

  const liveItems = items.length > 0 ? items : null;
  const ticker = liveItems
    ? {
      html: liveItems[tickerIdx % liveItems.length].title,
      time: fmtAgo(liveItems[tickerIdx % liveItems.length].createdAt),
    }
    : null;

  return (
    <header class="topbar">
      <button
        class="topbar__menu"
        type="button"
        data-cy={mounted ? "mobile-menu" : undefined}
        aria-label={tFor(lang, "dashTopbar.toggleSidebar")}
        onClick={() =>
          globalThis.dispatchEvent(new CustomEvent("pm:sb-toggle"))}
      >
        <I d={<path d="M3 6h18M3 12h18M3 18h18" />} size={18} />
      </button>
      <div class="topbar__greet">
        <div class="topbar__greet-line">{greetingDate}</div>
        <div class="topbar__greet-name">
          {greetingOverride ??
            tFor(lang, "dashTopbar.greeting", { name: greetingName })}
        </div>
      </div>
      {
        /* Search + notifications drawer are not built yet; hide their
          affordances until the underlying features ship rather than
          advertise dead controls (audit #6, #7). */
      }
      <div style="flex:1" aria-hidden="true" />
      {ticker
        ? (
          // Anchored to /dashboard#activity so the pill is no longer inert:
          // on the dashboard it scrolls to the on-page activity panel; from
          // any other page it routes to the dashboard and lands on the same
          // anchor (#21 — the click was decorative on day 1).
          <a
            href="/dashboard#activity"
            class="topbar__ticker"
            aria-label={tFor(lang, "dashTopbar.liveActivity")}
          >
            <span class="topbar__ticker-dot" />
            <span class="topbar__ticker-track" aria-live="polite">
              <span
                class="topbar__ticker-item"
                key={tickerIdx}
                // Trusted server-derived activity markup (no user input).
                // deno-lint-ignore react-no-danger
                dangerouslySetInnerHTML={{ __html: ticker.html }}
              />
            </span>
            <span class="topbar__ticker-time">
              {tFor(lang, "dashTopbar.timeAgo", { time: ticker.time })}
            </span>
          </a>
        )
        : null}
    </header>
  );
}
