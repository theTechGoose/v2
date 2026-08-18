import { useEffect, useRef, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { assistantClient, type Conversation } from "../clients/assistant.ts";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";

interface Props {
  initialThreads: Conversation[];
  activeId?: string;
  lang?: Lang;
}

type Chip = "sent" | "draft" | "needs" | "paid";

const POLL_MS = 8_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export default function AsstThreads(
  { initialThreads, activeId }: Props,
) {
  // Self-source the live UI language so this island re-renders when the
  // language flips (SettingsPage), rather than freezing on the SSR seed.
  const lang = langSignal.value;
  const [threads, setThreads] = useState<Conversation[]>(initialThreads);
  // Roadmap p.4: QuickBooks-style minimize for the conversation list. We
  // toggle a class on the parent .asst grid so its first column narrows to a
  // rail, and a class on the aside so the inner content collapses to icons.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof globalThis.localStorage === "undefined") return false;
    return globalThis.localStorage.getItem("pm:threads-collapsed") === "1";
  });
  // P-22: below 880px the conversation column is display:none, and the
  // 390px hamburger only ever opened the nav rail — so past conversations
  // were unreachable on a phone. The conversation list now rides ALONG WITH
  // that drawer: it mirrors the sidebar's own `sb--open` state (rather than
  // listening to `pm:sb-toggle` independently, which opened two competing
  // overlays) and docks into the bottom of the drawer's column, so one
  // hamburger tap yields ONE panel: nav links on top, conversations below.
  const [mobileOpen, setMobileOpen] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  // Cypress hook (data-cy) is only attached after hydration so a test can
  // never click the toggle before its listener is live.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sb = document.querySelector(".sb");
    if (!sb) return;
    // The drawer's open state is the single source of truth: it opens on the
    // hamburger and closes on the hamburger, the backdrop, or a nav tap — the
    // dock follows it in every one of those cases with no second listener.
    const sync = () =>
      setMobileOpen(
        sb.classList.contains("sb--open") &&
          typeof globalThis.innerWidth === "number" &&
          globalThis.innerWidth <= 880,
      );
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(sb, { attributes: true, attributeFilter: ["class"] });
    globalThis.addEventListener("resize", sync);
    return () => {
      mo.disconnect();
      globalThis.removeEventListener("resize", sync);
    };
  }, []);

  useEffect(() => {
    const parent = asideRef.current?.parentElement;
    if (parent) parent.classList.toggle("asst--threads-collapsed", collapsed);
  }, [collapsed]);

  function toggleCollapsed() {
    const next = !collapsed;
    try {
      globalThis.localStorage?.setItem(
        "pm:threads-collapsed",
        next ? "1" : "0",
      );
    } catch { /* SSR-safe */ }
    // Flip the parent grid class synchronously (the effect above also keeps
    // it in sync for the initial-mount case) so the panel's measured width
    // shrinks in the same frame as the toggle instead of one effect-tick
    // later.
    const parent = asideRef.current?.parentElement;
    if (parent) parent.classList.toggle("asst--threads-collapsed", next);
    setCollapsed(next);
  }

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

  const sorted = [...threads].sort((a, b) =>
    tsOf(b.updatedAt) - tsOf(a.updatedAt)
  );
  const groups = groupByRecency(sorted, lang);
  const total = threads.length;

  return (
    <>
      <aside
        ref={asideRef}
        class={`threads ${collapsed ? "threads--collapsed" : ""}${
          mobileOpen ? " threads--dock" : ""
        }`}
        // Docked into the BOTTOM of the drawer's own 260px column (never a
        // full-width sheet, and never with a backdrop of its own): the nav
        // links keep the top of the panel and stay tappable, so one tap
        // reveals navigation AND conversation history. Inline so it beats the
        // `.asst .threads { display:none }` phone rule without a second
        // source of truth in the stylesheet.
        style={mobileOpen
          ? "display:flex;position:fixed;left:0;width:260px;right:auto;bottom:0;top:auto;max-height:42vh;z-index:61;border-radius:14px 14px 0 0;background:#fff;box-shadow:0 -10px 24px rgba(0,0,0,0.28)"
          : undefined}
      >
        <div class="threads__head">
          <button
            type="button"
            class="threads__toggle"
            // Same QuickBooks pattern as the sidebar (roadmap p9): one physical
            // button — collapse arrow when open, hamburger when collapsed.
            data-cy={mounted
              ? (collapsed ? "asst-threads-expand" : "asst-threads-collapse")
              : undefined}
            onClick={toggleCollapsed}
            aria-label={collapsed
              ? tFor(lang, "asstThreads.expandConversations")
              : tFor(lang, "asstThreads.collapseConversations")}
            title={collapsed
              ? tFor(lang, "asstThreads.expand")
              : tFor(lang, "asstThreads.collapse")}
          >
            <I
              d={collapsed
                ? (
                  <>
                    <path d="M3 6h18M3 12h18M3 18h18" />
                  </>
                )
                : (
                  <>
                    {/* QuickBooks-style hamburger + collapse arrow */}
                    <path d="M3 6h13M3 12h13M3 18h13" />
                    <path d="M21 9l-3 3 3 3" />
                  </>
                )}
              size={16}
            />
          </button>
          <h3 class="threads__title">
            {tFor(lang, "asstThreads.conversations")}
          </h3>
          <span class="threads__count">{total}</span>
        </div>
        <a
          href="/assistant"
          class="threads__new"
          style="text-decoration:none"
          title={tFor(lang, "asstThreads.newConversation")}
        >
          <I d={ICN.plus} size={14} sw={2.5} />
          <span class="threads__new-label">
            {tFor(lang, "asstThreads.newConversation")}
          </span>
          <span class="threads__new-kbd">
            {tFor(lang, "asstThreads.newKbd")}
          </span>
        </a>
        <div class="threads__list">
          {groups.length === 0
            ? (
              <div class="threads__empty">
                {tFor(lang, "asstThreads.empty")}
              </div>
            )
            : groups.map((group) => (
              <div key={group.label}>
                <div class="threads__group-label">{group.label}</div>
                {group.items.map((c) => {
                  const chip = deriveChip(c, lang);
                  return (
                    <a
                      key={c.id}
                      href={`/assistant/${c.id}`}
                      class={`thread ${
                        c.id === activeId ? "thread--active" : ""
                      } ${c.hasUnreadEvent ? "thread--unread" : ""}`}
                      style="text-decoration:none;text-align:left;width:100%;display:block"
                    >
                      <div class="thread__head">
                        {c.hasUnreadEvent
                          ? (
                            <span
                              class="thread__unread-dot"
                              aria-label={tFor(lang, "asstThreads.newEvent")}
                            />
                          )
                          : null}
                        <span class="thread__client">{titleFor(c, lang)}</span>
                        <span class="thread__time">
                          {fmtTime(c.updatedAt, lang)}
                        </span>
                      </div>
                      <div class="thread__preview">{c.preview ?? "—"}</div>
                      <div class="thread__chips">
                        <span class={`thread__chip thread__chip--${chip.kind}`}>
                          {chip.label}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            ))}
        </div>
      </aside>
    </>
  );
}

function titleFor(c: Conversation, lang: Lang): string {
  return c.customerName?.trim() || c.title?.trim() ||
    tFor(lang, "asstThreads.newConversation");
}

/**
 * Map the most-advanced known status to one of the four chip CSS
 * variants (draft / sent / paid / needs). Walks the chain backwards —
 * invoice → contract → quote — so the chip reflects the latest stage
 * the conversation has reached, not the earliest.
 */
function deriveChip(
  c: Conversation,
  lang: Lang,
): { kind: Chip; label: string } {
  // Walk the chain backwards (latest stage wins). Customer acceptance
  // is a single event on the contract — quoteStatus only ever reaches
  // "locked"/"sent" in this flow, so no quote-accepted branch is needed.
  if (c.invoiceStatus === "paid") {
    return { kind: "paid", label: tFor(lang, "status.paid") };
  }
  if (c.invoiceStatus === "sent") {
    return { kind: "sent", label: tFor(lang, "asstThreads.chip.invoiced") };
  }
  if (c.contractStatus === "accepted") {
    return { kind: "paid", label: tFor(lang, "status.signed") };
  }
  if (c.contractStatus === "sent") {
    return { kind: "sent", label: tFor(lang, "asstThreads.chip.contractSent") };
  }
  if (c.contractStatus === "draft") {
    return { kind: "needs", label: tFor(lang, "asstThreads.chip.contract") };
  }
  if (c.quoteStatus === "sent") {
    return { kind: "sent", label: tFor(lang, "asstThreads.chip.quoteSent") };
  }
  // Audit2 #5: locking is not sending. A locked quote with no customer bound
  // gets its own chip instead of borrowing "Cotización enviada".
  if (c.quoteStatus === "locked") {
    return { kind: "needs", label: tFor(lang, "asstThreads.chip.quoteLocked") };
  }
  if (c.currentPhase === "terms") {
    return { kind: "needs", label: tFor(lang, "asstThreads.chip.terms") };
  }
  return { kind: "draft", label: tFor(lang, "asstThreads.chip.drafting") };
}

function tsOf(iso: string): number {
  if (!iso) return 0;
  // ISO-8601 string is the normal shape.
  const parsed = Date.parse(iso);
  if (Number.isFinite(parsed)) return parsed;
  // Fallback: a numeric epoch delivered as a string. Disambiguate seconds vs
  // milliseconds by magnitude (10-digit ≈ seconds, 13-digit ≈ ms) so a
  // seconds-epoch value doesn't render as 1970 → bogus "Nd ago".
  const n = Number(iso);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  return 0;
}

const WEEKDAY_KEYS = [
  "asstThreads.weekday.sun",
  "asstThreads.weekday.mon",
  "asstThreads.weekday.tue",
  "asstThreads.weekday.wed",
  "asstThreads.weekday.thu",
  "asstThreads.weekday.fri",
  "asstThreads.weekday.sat",
];

function fmtTime(iso: string, lang: Lang): string {
  const t = tsOf(iso);
  if (!t) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return tFor(lang, "asstThreads.justNow");
  if (diff < HOUR) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return tFor(lang, WEEKDAY_KEYS[new Date(t).getDay()]);
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function groupByRecency(
  convs: Conversation[],
  lang: Lang,
): { label: string; items: Conversation[] }[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart.getTime() - DAY;
  const weekStart = todayStart.getTime() - 7 * DAY;

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const week: Conversation[] = [];
  const older: Conversation[] = [];
  for (const c of convs) {
    const t = tsOf(c.updatedAt);
    if (t >= todayStart.getTime()) today.push(c);
    else if (t >= yesterdayStart) yesterday.push(c);
    else if (t >= weekStart) week.push(c);
    else older.push(c);
  }

  return [
    { label: tFor(lang, "asstThreads.group.today"), items: today },
    { label: tFor(lang, "asstThreads.group.yesterday"), items: yesterday },
    { label: tFor(lang, "asstThreads.group.thisWeek"), items: week },
    { label: tFor(lang, "asstThreads.group.earlier"), items: older },
  ].filter((g) => g.items.length > 0);
}
