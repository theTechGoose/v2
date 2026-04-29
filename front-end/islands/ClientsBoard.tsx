/**
 * Interactive heart of /clients: toolbar (search + filter chips) + the
 * 12-card editorial grid + the slide-up contact panel. Mirrors the
 * prototype's ClientsToolbar + ClientsCards + ClientCard components.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  type Client,
  type ClientStatus,
  CLIENTS,
  daysSinceContact,
  FILTERS,
  moodFor,
  STORIES,
} from "../lib/clients-seed.ts";

type FilterId = ClientStatus | "all";

function SinceBadge({ days }: { days: number }) {
  const tier =
    days <= 2  ? "warm"   :
    days <= 7  ? "steady" :
    days <= 21 ? "cool"   : "cold";
  const num = days < 30 ? String(days).padStart(2, "0") : String(Math.round(days / 7));
  const unit = days < 30 ? (days === 1 ? "day ago" : "days ago") : "weeks ago";
  return (
    <div class={`ccard2__since ccard2__since--${tier}`}>
      <span class="ccard2__since-num">{num}</span>
      <span class="ccard2__since-unit">{unit}</span>
    </div>
  );
}

function inferAddress(c: Client): string {
  if (c.address) return c.address;
  if (c.segment === "HOA") return "422 Greenleaf Way";
  if (c.segment === "Property mgmt") return `${c.name.split(" ")[0]} property — multiple units`;
  if (c.segment === "Small biz")     return `${c.name} — main location`;
  return "Home address on file";
}

interface CardProps {
  c: Client;
  idx: number;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function ClientCard({ c, idx, isOpen, onOpen, onClose }: CardProps) {
  const mood = moodFor(c);
  const story = STORIES[c.name] ?? { line: "No notes yet — open the card to leave one.", cta: "Open card" };
  const balanceCls =
    c.balance > 0 ? "ccard2__bal-val--owe" :
    c.balance < 0 ? "ccard2__bal-val--cred" :
    "ccard2__bal-val--zero";
  const balanceText =
    c.balance > 0
      ? `$${c.balance.toLocaleString()} due`
      : c.balance < 0
        ? `$${Math.abs(c.balance).toLocaleString()} credit`
        : "Settled";
  const address = inferAddress(c);

  function onCardClick(e: Event) {
    const target = e.target as HTMLElement;
    if (target.closest(".ccard2__foot") || target.closest(".ccard2__panel")) return;
    if (!isOpen) onOpen();
  }

  const styleStr =
    `--mood-from:${mood.from};` +
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
        <SinceBadge days={daysSinceContact(c)} />
        <div class="ccard2__status">
          <span class="ccard2__status-dot" /> {mood.label}
        </div>
        {c.vip && (
          <div class="ccard2__crown"><I d={ICN.crown} size={13} sw={2.5} /></div>
        )}
      </div>
      <div class="ccard2__av">{c.initials}</div>
      <div class="ccard2__body">
        <h3 class="ccard2__name">{c.name}</h3>
        <div class="ccard2__seg">
          <span>{c.segment}</span>
          <span class="ccard2__seg-dot" />
          <span>{c.lastWhen}</span>
        </div>
        <p class="ccard2__story">{story.line}</p>
      </div>
      <div class="ccard2__foot">
        <button class="ccard2__nudge" type="button">
          {story.cta} <span class="ccard2__nudge-arrow">→</span>
        </button>
        <div class="ccard2__bal-wrap">
          <div class="ccard2__bal-lbl">Balance</div>
          <div class={`ccard2__bal-val ${balanceCls}`}>{balanceText}</div>
        </div>
      </div>

      <div class="ccard2__panel" onClick={(e) => e.stopPropagation()}>
        <div class="ccard2__panel-head">
          <div class="ccard2__panel-av">{c.initials}</div>
          <div style="min-width:0;flex:1">
            <div class="ccard2__panel-name">{c.name}</div>
            <div class="ccard2__panel-seg">{c.segment} · {mood.label}</div>
          </div>
          <button class="ccard2__panel-x" type="button" onClick={onClose} aria-label="Close">
            <I d={ICN.x} size={14} sw={2.5} />
          </button>
        </div>
        <div class="ccard2__panel-rows">
          <a class="ccard2__panel-row" href={`tel:${c.phone}`}>
            <span class="ccard2__panel-row-icon"><I d={ICN.phone} size={13} sw={2.2} /></span>
            <span class="ccard2__panel-row-text">
              <div class="ccard2__panel-row-lbl">Phone</div>
              <div class="ccard2__panel-row-val">{c.phone}</div>
            </span>
            <span class="ccard2__panel-row-arrow"><I d={ICN.arrow} size={12} sw={2.4} /></span>
          </a>
          <a class="ccard2__panel-row" href={`mailto:${c.contact}`}>
            <span class="ccard2__panel-row-icon"><I d={ICN.mail} size={13} sw={2.2} /></span>
            <span class="ccard2__panel-row-text">
              <div class="ccard2__panel-row-lbl">Email</div>
              <div class="ccard2__panel-row-val">{c.contact}</div>
            </span>
            <span class="ccard2__panel-row-arrow"><I d={ICN.arrow} size={12} sw={2.4} /></span>
          </a>
          <div class="ccard2__panel-row">
            <span class="ccard2__panel-row-icon"><I d={ICN.pin} size={13} sw={2.2} /></span>
            <span class="ccard2__panel-row-text">
              <div class="ccard2__panel-row-lbl">Address</div>
              <div class="ccard2__panel-row-val">{address}</div>
            </span>
            <span class="ccard2__panel-row-arrow"><I d={ICN.arrow} size={12} sw={2.4} /></span>
          </div>
        </div>
        <div class="ccard2__panel-actions">
          <button class="ccard2__panel-act" type="button"><I d={ICN.msg} size={12} sw={2.4} /> Message</button>
          <button class="ccard2__panel-act ccard2__panel-act--pink" type="button"><I d={ICN.eye} size={12} sw={2.4} /> Open card</button>
        </div>
      </div>
    </div>
  );
}

interface BoardProps { children?: ComponentChildren }

export default function ClientsBoard({ children }: BoardProps) {
  const [filter, setFilter] = useState<FilterId>("all");
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

  const rows = CLIENTS.filter((c) => {
    if (filter !== "all" && c.status !== filter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.contact.toLowerCase().includes(q) ||
        c.last.toLowerCase().includes(q) ||
        c.phone.includes(q)
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
            placeholder="Search by name, address, phone, or last job…"
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div class="ctoolbar2__filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              class={`ctoolbar2__filter ${filter === f.id ? "ctoolbar2__filter--active" : ""}`}
              onClick={() => setFilter(f.id as FilterId)}
            >
              {f.label}
              <span class="ctoolbar2__filter-count">{f.count}</span>
            </button>
          ))}
        </div>
        <button class="ctoolbar2__sort" type="button">
          Warmth <I d={<path d="m6 9 6 6 6-6" />} size={12} sw={2.5} />
        </button>
      </div>

      <div class="clay2">
        <div class="ccards2">
          {rows.map((c, i) => (
            <ClientCard
              key={c.name}
              c={c}
              idx={i}
              isOpen={openId === c.name}
              onOpen={() => setOpenId(c.name)}
              onClose={() => setOpenId(null)}
            />
          ))}
        </div>
        <div class="cside2">
          {children}
        </div>
      </div>
    </>
  );
}
