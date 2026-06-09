/**
 * Interactive heart of /clients: toolbar (search + filter chips) + the
 * editorial card grid + the slide-up contact panel.
 *
 * Receives the backend's `CustomerCard[]` from the SSR route — no seed data,
 * no derivations the backend already owns (status, balance, days-since-contact
 * all come pre-computed via BuildCustomerCards).
 */
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { tFor } from "../lib/i18n.ts";
import type { ClientStatus, CustomerCard } from "../clients/clients.ts";
import {
  addressFor,
  balanceDisplay,
  ctaFor,
  initialsOf,
  moodFor,
  segmentLabel,
  sinceBadge,
  storyLineFor,
} from "../lib/clients-display.ts";

// Chip set matches the canonical reference (Paperwork Monster Clients.html)
// — six entries with the exact labels from the design source. URL
// bookmarking via ?segment= is additive: it doesn't change the visual
// chip set, just lets a filtered view be reloaded / shared / back-buttoned.
type FilterId = ClientStatus | "all";

interface FilterEntry {
  id: FilterId;
  labelKey: string;
}
const FILTER_DEFS: FilterEntry[] = [
  { id: "all", labelKey: "clientsBoard.filter.all" },
  { id: "active", labelKey: "clientsBoard.filter.activeJobs" },
  { id: "lead", labelKey: "clientsBoard.filter.leads" },
  { id: "owes", labelKey: "clientsBoard.filter.oweYou" },
  { id: "regular", labelKey: "clientsBoard.filter.regulars" },
  { id: "cold", labelKey: "clientsBoard.filter.quiet" },
];

const FILTER_IDS: ReadonlyArray<string> = FILTER_DEFS.map((f) => f.id);
function isFilterId(s: string | null | undefined): s is FilterId {
  return !!s && FILTER_IDS.includes(s);
}
function filterFromSearch(search: string | null | undefined): FilterId {
  if (!search) return "all";
  const raw = new URLSearchParams(search).get("segment");
  return isFilterId(raw) ? raw : "all";
}

function SinceBadge({ days, lang }: { days: number; lang: "en" | "es" }) {
  const { tier, num, unit } = sinceBadge(days, lang);
  return (
    <div class={`ccard2__since ccard2__since--${tier}`}>
      <span class="ccard2__since-num">{num}</span>
      <span class="ccard2__since-unit">{unit}</span>
    </div>
  );
}

interface CardProps {
  c: CustomerCard;
  idx: number;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  lang: "en" | "es";
}

function ClientCard({ c, idx, isOpen, onOpen, onClose, lang }: CardProps) {
  const mood = moodFor(c, lang);
  const initials = initialsOf(c.name);
  const seg = segmentLabel(c.segment, lang);
  const story = storyLineFor(c, lang);
  const cta = ctaFor(c, lang);
  const balance = balanceDisplay(c, lang);
  const address = addressFor(c, lang);

  function onCardClick(e: Event) {
    const target = e.target as HTMLElement;
    if (target.closest(".ccard2__foot") || target.closest(".ccard2__panel")) {
      return;
    }
    if (!isOpen) onOpen();
  }

  const styleStr = `--mood-from:${mood.from};` +
    `--mood-to:${mood.to};` +
    `--mood-shadow:${mood.shadow};` +
    `--mood-status:${mood.statusFg};` +
    `animation-delay:${idx * 35}ms`;

  return (
    <div
      class={`ccard2 ${isOpen ? "ccard2--open" : ""}`}
      style={styleStr}
      onClick={onCardClick}
    >
      <div class="ccard2__mood">
        <div class="ccard2__mood-tex" />
        <SinceBadge days={c.daysSinceContact} lang={lang} />
        <div class="ccard2__status">
          <span class="ccard2__status-dot" /> {mood.label}
        </div>
        {c.vip && (
          <div class="ccard2__crown">
            <I d={ICN.crown} size={13} sw={2.5} />
          </div>
        )}
      </div>
      <div class="ccard2__av">{initials}</div>
      <div class="ccard2__body">
        <h3 class="ccard2__name">{c.name}</h3>
        <div class="ccard2__seg">
          <span>{seg}</span>
          <span class="ccard2__seg-dot" />
          <span>{c.lastWhenRel}</span>
        </div>
        <p class="ccard2__story">{story}</p>
      </div>
      <div class="ccard2__foot">
        <button class="ccard2__nudge" type="button">
          {cta} <span class="ccard2__nudge-arrow">→</span>
        </button>
        <div class="ccard2__bal-wrap">
          <div class="ccard2__bal-lbl">{tFor(lang, "clientsBoard.balance")}</div>
          <div class={`ccard2__bal-val ${balance.cls}`}>{balance.text}</div>
        </div>
      </div>

      <div class="ccard2__panel" onClick={(e) => e.stopPropagation()}>
        <div class="ccard2__panel-head">
          <div class="ccard2__panel-av">{initials}</div>
          <div style="min-width:0;flex:1">
            <div class="ccard2__panel-name">{c.name}</div>
            <div class="ccard2__panel-seg">{seg} · {mood.label}</div>
          </div>
          <button
            class="ccard2__panel-x"
            type="button"
            onClick={onClose}
            aria-label={tFor(lang, "common.close")}
          >
            <I d={ICN.x} size={14} sw={2.5} />
          </button>
        </div>
        <div class="ccard2__panel-rows">
          {c.phoneNumber && (
            <a class="ccard2__panel-row" href={`tel:${c.phoneNumber}`}>
              <span class="ccard2__panel-row-icon">
                <I d={ICN.phone} size={13} sw={2.2} />
              </span>
              <span class="ccard2__panel-row-text">
                <div class="ccard2__panel-row-lbl">
                  {tFor(lang, "clientsBoard.panel.phone")}
                </div>
                <div class="ccard2__panel-row-val">{c.phoneNumber}</div>
              </span>
              <span class="ccard2__panel-row-arrow">
                <I d={ICN.arrow} size={12} sw={2.4} />
              </span>
            </a>
          )}
          {c.email && (
            <a class="ccard2__panel-row" href={`mailto:${c.email}`}>
              <span class="ccard2__panel-row-icon">
                <I d={ICN.mail} size={13} sw={2.2} />
              </span>
              <span class="ccard2__panel-row-text">
                <div class="ccard2__panel-row-lbl">
                  {tFor(lang, "clientsBoard.panel.email")}
                </div>
                <div class="ccard2__panel-row-val">{c.email}</div>
              </span>
              <span class="ccard2__panel-row-arrow">
                <I d={ICN.arrow} size={12} sw={2.4} />
              </span>
            </a>
          )}
          <div class="ccard2__panel-row">
            <span class="ccard2__panel-row-icon">
              <I d={ICN.pin} size={13} sw={2.2} />
            </span>
            <span class="ccard2__panel-row-text">
              <div class="ccard2__panel-row-lbl">
                {tFor(lang, "clientsBoard.panel.address")}
              </div>
              <div class="ccard2__panel-row-val">{address}</div>
            </span>
            <span class="ccard2__panel-row-arrow">
              <I d={ICN.arrow} size={12} sw={2.4} />
            </span>
          </div>
        </div>
        <div class="ccard2__panel-actions">
          <button class="ccard2__panel-act" type="button">
            <I d={ICN.msg} size={12} sw={2.4} />{" "}
            {tFor(lang, "clientsBoard.panel.message")}
          </button>
          <button
            class="ccard2__panel-act ccard2__panel-act--pink"
            type="button"
          >
            <I d={ICN.eye} size={12} sw={2.4} />{" "}
            {tFor(lang, "clientsBoard.panel.openCard")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BoardProps {
  cards: CustomerCard[];
  children?: ComponentChildren;
  lang?: "en" | "es";
}

export default function ClientsBoard(
  { cards, children, lang = "en" }: BoardProps,
) {
  // Filter id ("all" | ClientStatus). Seeded from URL ?segment= so a
  // reload / shared link / back-button navigates to the same filtered
  // view. Defaults to "all" (the leftmost chip) when the param is absent
  // or unrecognized.
  const [filter, setFilter] = useState<FilterId>(() => {
    if (typeof globalThis.location === "undefined") return "all";
    return filterFromSearch(globalThis.location.search);
  });
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!openId) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".ccard2")) setOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  // Browser back / forward should re-apply the URL's filter state.
  useEffect(() => {
    function onPop() {
      setFilter(filterFromSearch(globalThis.location.search));
    }
    globalThis.addEventListener("popstate", onPop);
    return () => globalThis.removeEventListener("popstate", onPop);
  }, []);

  function selectFilter(next: FilterId) {
    setFilter(next);
    if (typeof globalThis.location === "undefined") return;
    const url = new URL(globalThis.location.href);
    // "all" is the default — represent it by absence of the param.
    if (next === "all") url.searchParams.delete("segment");
    else url.searchParams.set("segment", next);
    globalThis.history.pushState({ segment: next }, "", url.toString());
  }

  const filterCounts = useMemo(() => {
    const counts: Record<FilterId, number> = {
      all: cards.length,
      active: 0,
      lead: 0,
      owes: 0,
      regular: 0,
      cold: 0,
    };
    for (const c of cards) counts[c.status]++;
    return counts;
  }, [cards]);

  const rows = cards.filter((c) => {
    if (filter !== "all" && c.status !== filter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phoneNumber ?? "").includes(q) ||
        (c.address ?? "").toLowerCase().includes(q) ||
        (c.notes ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <>
      <div class="ctoolbar2">
        <div class="ctoolbar2__search">
          <I d={ICN.search} size={14} />
          <input
            placeholder={tFor(lang, "clientsBoard.searchPlaceholder")}
            value={query}
            onInput={(e) =>
              setQuery((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div class="ctoolbar2__filters">
          {FILTER_DEFS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                class={`ctoolbar2__filter ${
                  active ? "ctoolbar2__filter--active" : ""
                }`}
                onClick={() => selectFilter(f.id)}
              >
                {tFor(lang, f.labelKey)}
                <span class="ctoolbar2__filter-count">
                  {filterCounts[f.id]}
                </span>
              </button>
            );
          })}
        </div>
        <button class="ctoolbar2__sort" type="button">
          {tFor(lang, "clientsBoard.sort.warmth")}{" "}
          <I d={<path d="m6 9 6 6 6-6" />} size={12} sw={2.5} />
        </button>
      </div>

      <div class="clay2">
        <div class="ccards2">
          {rows.map((c, i) => (
            <ClientCard
              key={c.id}
              c={c}
              idx={i}
              isOpen={openId === c.id}
              onOpen={() => setOpenId(c.id)}
              onClose={() => setOpenId(null)}
              lang={lang}
            />
          ))}
          {rows.length === 0 && (
            <div class="ccards2__empty">
              {cards.length === 0
                ? tFor(lang, "clientsBoard.empty.noClients")
                : tFor(lang, "clientsBoard.empty.noMatches")}
            </div>
          )}
        </div>
        <div class="cside2">
          {children}
        </div>
      </div>
    </>
  );
}
