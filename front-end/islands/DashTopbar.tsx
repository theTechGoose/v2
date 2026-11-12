import { useEffect, useState } from "preact/hooks";
import { I } from "../lib/dash-icons.tsx";
import { dashboardClient, type Notification } from "../clients/dashboard.ts";
import { langSignal, setLang, tFor } from "../lib/i18n.ts";
import { profileClient } from "../clients/profile.ts";
import { formatGreetingDate } from "../../shared/quote-flow/locale-format.ts";
import { tickerAge } from "../lib/ticker-age.ts";
import GlobalSearch from "./GlobalSearch.tsx";
import { TOPBAR_CSS } from "../lib/topbar-css.ts";
import { startPoll } from "../lib/poll.ts";
import {
  PROFILE_UPDATED,
  type ProfileUpdatedDetail,
} from "../lib/profile-events.ts";
import { greetingFirstName } from "../../shared/quote-flow/outbound-identity.ts";
import {
  readNotifications,
  refreshNotifications,
  subscribeNotifications,
} from "../lib/notifications-feed.ts";
import {
  MUTATION_EVENT,
  newestNotification,
  tickerPlainText,
} from "../lib/ticker-pick.ts";

interface Props {
  /** @deprecated Ignored — the date is now computed reactively in-component
   *  so it re-localizes live on a language change instead of arriving frozen. */
  greetingDate?: string;
  greetingName: string;
  /** @deprecated SSR-frozen string — it can't re-localize when the topbar
   *  language toggle flips. Pass `greetingOverrideKey` instead. */
  greetingOverride?: string;
  /** Dict key that replaces the default "Hey, {name} 👋" line. Resolved
   *  reactively against the live language so the toggle re-localizes it. */
  greetingOverrideKey?: string;
  initialUnread?: number;
  initialNotifications?: Notification[];
  lang?: "en" | "es";
}

// No fallback ticker — when the user has zero real notifications we hide
// the ticker entirely. Showing seeded "Cobblestone Cafe paid $1,000" to a
// brand-new account read as fake activity and misled first-run users.
// The pill's age ("just now" / "4m ago") comes from tickerAge (REQ-273).
// REQ-319 (demo m12): the pill shows the NEWEST event only — it used to
// rotate through the last ten by position every 3.8 s, so a fresh "accepted
// · just now" was followed by "Quote sent … 3m ago" and read as going
// backwards. The interval below only re-renders so the age counts up.

export default function DashTopbar(
  {
    greetingName,
    greetingOverride,
    greetingOverrideKey,
    initialUnread = 0,
    initialNotifications = [],
  }: Props,
) {
  // Reactive app language (seeded from user.language, flipped live by Settings).
  const lang = langSignal.value;
  const now = new Date();
  // Built here so it re-localizes live when langSignal flips. REQ-276: in
  // the language's own order — es "Miércoles · 11 de noviembre", capitalised
  // as the line opens the greeting (P-65); en "Wednesday · November 11".
  const greetingDate = formatGreetingDate(now, lang);
  const [, setUnread] = useState(initialUnread);
  // REQ-299: the list is the shared feed's (DashboardPage reads the same one)
  const [items, setItems] = useState<Notification[]>(() => {
    const live = readNotifications();
    return live.length > 0 ? live : initialNotifications;
  });
  const [, setAgeTick] = useState(0);
  // The data-cy hook appears only after hydration so a test can never click
  // the hamburger before the pm:sb-toggle listener (DashSidebar) is live —
  // pre-hydration clicks were the "hamburger does not work" bug (PDF p8).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // REQ-355 — the name saved on this page (Settings, the staff name prompt);
  // undefined until one is. The SSR greeting would otherwise stay stale.
  const [savedName, setSavedName] = useState<string | undefined>(undefined);
  useEffect(() => {
    const onProfile = (e: Event) => {
      const name = (e as CustomEvent<ProfileUpdatedDetail>).detail?.name;
      if (name !== undefined) setSavedName(name);
    };
    globalThis.addEventListener(PROFILE_UPDATED, onProfile);
    return () => globalThis.removeEventListener(PROFILE_UPDATED, onProfile);
  }, []);

  useEffect(() => {
    let stopped = false;
    // REQ-221: the shared scheduler skips hidden
    // tabs (one catch-up when shown again); a failed fetch keeps the last list.
    const stopA = startPoll(async () => {
      const { count } = await dashboardClient.unreadCount();
      if (!stopped) setUnread(count);
    }, 30_000);
    // REQ-299: the poll refreshes the shared feed; the ticker follows it
    const stopB = startPoll(refreshNotifications, 10_000);
    const unsub = subscribeNotifications((next) => {
      if (!stopped) setItems(next);
    });
    // REQ-319: a mutation that went through lib/api (quote sent, invoice
    // claimed…) refreshes the feed at once instead of waiting for the poll.
    const onMutated = () => {
      refreshNotifications().catch(() => {/* the poll retries */});
    };
    globalThis.addEventListener(MUTATION_EVENT, onMutated);
    const teardown = () => {
      stopped = true;
      stopA();
      stopB();
      unsub();
      globalThis.removeEventListener(MUTATION_EVENT, onMutated);
    };
    // P-67: stop both polls the moment logout starts ("pm:logout", fired by
    // DashSidebar before it kills the session) or the page starts navigating
    // away (pagehide). Without this a poll could fire into the logout
    // transition window and surface a refused/5xx request.
    globalThis.addEventListener("pm:logout", teardown);
    globalThis.addEventListener("pagehide", teardown);
    return () => {
      teardown();
      globalThis.removeEventListener("pm:logout", teardown);
      globalThis.removeEventListener("pagehide", teardown);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setAgeTick((n) => n + 1), 3_800);
    return () => clearInterval(id);
  }, []);

  const tickerItem = newestNotification(items);
  // Recomputed on every age tick (3.8 s), so the shown event's age counts up.
  const age = tickerItem ? tickerAge(tickerItem.createdAt) : null;
  const ticker = tickerItem
    ? {
      html: tickerItem.title,
      time: !age
        ? ""
        : age.key === "dashTopbar.justNow"
        ? tFor(lang, age.key)
        : tFor(lang, age.key, { time: age.time }),
    }
    : null;

  return (
    // REQ-207: the bar is its own stacking context (backdrop-filter); lifted
    // above the content so the search panel is not painted under the cards.
    // REQ-406 (demo m47): that position:relative + z-index lives in
    // TOPBAR_CSS, not inline — an inline position beat the phone's sticky.
    <header class="topbar">
      {/* REQ-223: the toggle's and the phone bar's rules ride with the island, so /assistant (no dashboard.css) gets them too */}
      <style>{TOPBAR_CSS}</style>
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
          {savedName !== undefined
            // REQ-355 — re-greet the saved name; a placeholder or blank greets namelessly
            ? (greetingFirstName(savedName)
              ? tFor(lang, "dashTopbar.greeting", {
                name: greetingFirstName(savedName)!,
              })
              : tFor(lang, "dashTopbar.greetingNoName"))
            : (greetingOverrideKey
              ? tFor(lang, greetingOverrideKey)
              : greetingOverride) ??
              tFor(lang, "dashTopbar.greeting", { name: greetingName })}
        </div>
      </div>
      {
        /* REQ-207: the account search — numbers, customers, addresses,
          dates — with `/` to focus. It takes the flexible middle of the bar.
          The notifications drawer is still not built; its affordance stays
          hidden rather than advertise a dead control (audit #7). */
      }
      <GlobalSearch />
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
            // UX-21: sighted users hovering "● hace 4m" get the same
            // explanation the aria-label already gives screen readers.
            title={tFor(lang, "dashTopbar.liveActivity")}
          >
            <span class="topbar__ticker-dot" />
            <span class="topbar__ticker-track" aria-live="polite">
              <span
                class="topbar__ticker-item"
                // keyed by the event so the slide-in plays once per new event
                key={tickerItem!.id}
                // REQ-319: the full sentence on hover, even where it is clipped
                title={tickerPlainText(ticker.html)}
                // Trusted server-derived activity markup (no user input).
                // deno-lint-ignore react-no-danger
                dangerouslySetInnerHTML={{ __html: ticker.html }}
              />
            </span>
            <span class="topbar__ticker-time">{ticker.time}</span>
          </a>
        )
        : null}
      {
        /* EN/ES switch — the landing page's toggle, promoted to the app
          chrome so the language is switchable from every page, not only
          Settings. Same behavior as Settings' app-language select: flip
          the signal instantly, persist locally + cookie (setLang), and
          save the profile so the assistant/doc defaults follow. */
      }
      <div
        class="topbar__lang"
        role="group"
        aria-label={tFor(lang, "dashTopbar.language")}
      >
        {(["en", "es"] as const).map((code) => (
          <button
            key={code}
            type="button"
            class={`topbar__lang-btn ${
              lang === code ? "topbar__lang-btn--on" : ""
            }`}
            aria-pressed={lang === code}
            data-cy={`topbar-lang-${code}`}
            onClick={() => {
              if (langSignal.value === code) return;
              setLang(code);
              profileClient.updateUser({ language: code }).catch(() => {
                /* profile save is best-effort — the UI already flipped */
              });
            }}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}
