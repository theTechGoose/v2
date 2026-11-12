/**
 * Interactive heart of /clients: toolbar (search + filter chips) + the
 * editorial card grid + the slide-up contact panel.
 *
 * Receives ONE PAGE of the backend's `CustomerCard[]` (REQ-135) with the chip
 * counts the API counted — no seed data, no derivations the backend already
 * owns (status, balance, days-since-contact all come pre-computed via
 * BuildCustomerCards) and no list-wide filtering here: the search box and
 * the chips report upward and the island asks the API for the page.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { tFor } from "../lib/i18n.ts";
import type { ClientsFilter, CustomerCard } from "../clients/clients.ts";
import type { SubscriptionView } from "../clients/field.ts";
import { fmtMoneyExact, perVisitCents } from "../lib/field.ts";
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
import { messageHrefFor, nudgeActionFor } from "../lib/client-actions.ts";
import {
  formatPhoneDisplay,
  telHref,
} from "../../shared/quote-flow/format-helpers.ts";

// Chip set matches the canonical reference (DocuMonster Clients.html)
// — six entries with the exact labels from the design source. URL
// bookmarking via ?segment= is additive: it doesn't change the visual
// chip set, just lets a filtered view be reloaded / shared / back-buttoned.
type FilterId = ClientsFilter;

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
export function filterFromSearch(
  search: string | null | undefined,
): FilterId {
  if (!search) return "all";
  const raw = new URLSearchParams(search).get("segment");
  return isFilterId(raw) ? raw : "all";
}

function SinceBadge({ days, lang }: { days: number; lang: "en" | "es" }) {
  const { tier, num, unit } = sinceBadge(days, lang);
  return (
    <div class={`ccard2__since ccard2__since--${tier}`}>
      <span
        class={`ccard2__since-num${
          num.length > 2 ? " ccard2__since-num--word" : ""
        }`}
      >
        {num}
      </span>
      <span class="ccard2__since-unit">{unit}</span>
    </div>
  );
}

interface CardProps {
  c: CustomerCard;
  /** REQ-145 — the customer's subscriptions (the field module's), oldest first */
  subs: SubscriptionView[];
  idx: number;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  lang: "en" | "es";
}

function ClientCard(
  { c, subs, idx, isOpen, onOpen, onClose, lang }: CardProps,
) {
  const mood = moodFor(c, lang);
  const initials = initialsOf(c.name);
  // NW-36 (REQ-013): the app never collects a customer segment, so no
  // "Unsorted" placeholder — the label renders only when a real one exists.
  const seg = c.segment ? segmentLabel(c.segment, lang) : null;
  const story = storyLineFor(c, lang);
  const cta = ctaFor(c, lang);
  const balance = balanceDisplay(c, lang);
  const address = addressFor(c, lang);
  const nudge = nudgeActionFor(c);
  const messageHref = messageHrefFor(c);

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
        {c.businessName && <div class="ccard2__biz">{c.businessName}</div>}
        <div class="ccard2__seg">
          {seg && (
            <>
              <span>{seg}</span>
              <span class="ccard2__seg-dot" />
            </>
          )}
          <span>{c.lastWhenRel}</span>
        </div>
        <p class="ccard2__story">{story}</p>
        {subs.length > 0 && (
          /* REQ-145: the count on the face; the panel lists them */
          <div
            class="ccard2__biz"
            data-cy="ccard2-subs-count"
            style="margin-top:6px"
          >
            <I d={ICN.repeat} size={12} sw={2.2} /> {tFor(
              lang,
              subs.length === 1
                ? "clientsBoard.subsCount.one"
                : "clientsBoard.subsCount.other",
              { n: subs.length },
            )}
          </div>
        )}
      </div>
      <div class="ccard2__foot">
        {/* REQ-277 (M31): the nudge does what it says — a message verb texts
            the customer; "Open card" (or nowhere to send) opens the panel */}
        {nudge.kind === "message"
          ? (
            <a class="ccard2__nudge" data-cy="ccard2-nudge" href={nudge.href}>
              {cta} <span class="ccard2__nudge-arrow">→</span>
            </a>
          )
          : (
            <button
              class="ccard2__nudge"
              data-cy="ccard2-nudge"
              type="button"
              onClick={() => {
                if (!isOpen) onOpen();
              }}
            >
              {cta} <span class="ccard2__nudge-arrow">→</span>
            </button>
          )}
        <div class="ccard2__bal-wrap">
          <div class="ccard2__bal-lbl">
            {tFor(lang, "clientsBoard.balance")}
          </div>
          <div class={`ccard2__bal-val ${balance.cls}`}>{balance.text}</div>
        </div>
      </div>

      <div class="ccard2__panel" onClick={(e) => e.stopPropagation()}>
        <div class="ccard2__panel-head">
          <div class="ccard2__panel-av">{initials}</div>
          <div style="min-width:0;flex:1">
            <div class="ccard2__panel-name">{c.name}</div>
            {c.businessName && (
              <div class="ccard2__panel-biz">{c.businessName}</div>
            )}
            <div class="ccard2__panel-seg">
              {seg ? `${seg} · ` : ""}
              {mood.label}
            </div>
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
            /* One phone formatter everywhere: the dial href is always
               normalized to tel:+1…, the label always reads
               "+1 (512) 555-3150" (P-64). */
            <a class="ccard2__panel-row" href={telHref(c.phoneNumber)}>
              <span class="ccard2__panel-row-icon">
                <I d={ICN.phone} size={13} sw={2.2} />
              </span>
              <span class="ccard2__panel-row-text">
                <div class="ccard2__panel-row-lbl">
                  {tFor(lang, "clientsBoard.panel.phone")}
                </div>
                <div class="ccard2__panel-row-val">
                  {formatPhoneDisplay(c.phoneNumber)}
                </div>
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
        {/* REQ-145: every subscription of this customer, each a link to the field page */}
        <div
          class="ccard2__panel-rows"
          data-cy="ccard2-subs"
          style="margin-top:8px;max-height:150px;overflow-y:auto"
        >
          <div class="ccard2__panel-row" style="pointer-events:none">
            <span class="ccard2__panel-row-icon">
              <I d={ICN.repeat} size={13} sw={2.2} />
            </span>
            <span class="ccard2__panel-row-text">
              <div class="ccard2__panel-row-lbl">
                {tFor(lang, "clientsBoard.panel.subs")}
                {subs.length ? ` · ${subs.length}` : ""}
              </div>
              {subs.length === 0 && (
                <div class="ccard2__panel-row-val">
                  {tFor(lang, "clientsBoard.panel.subsNone")}
                </div>
              )}
            </span>
          </div>
          {subs.map((s) => (
            <a
              class="ccard2__panel-row"
              href="/field/subscriptions"
              key={s.id}
              data-cy="ccard2-sub"
              title={tFor(lang, "clientsBoard.panel.subsOpen")}
            >
              <span class="ccard2__panel-row-icon">
                <I d={ICN.pin} size={13} sw={2.2} />
              </span>
              <span class="ccard2__panel-row-text">
                <div class="ccard2__panel-row-lbl">
                  {s.schedule[lang]} · {s.active
                    ? tFor(lang, "field.subs.active")
                    : tFor(lang, "field.subs.paused")}
                </div>
                <div class="ccard2__panel-row-val">
                  {s.address} · {fmtMoneyExact(perVisitCents(s))}{" "}
                  {tFor(lang, "clientsBoard.panel.perVisit")}
                </div>
              </span>
              <span class="ccard2__panel-row-arrow">
                <I d={ICN.arrow} size={12} sw={2.4} />
              </span>
            </a>
          ))}
        </div>
        {/* REQ-277 (M31): Message texts (else mails) the customer and is not
            offered with nowhere to send; the mock's "Open card" went nowhere —
            this panel IS the open card — so it is gone */}
        {messageHref && (
          <div class="ccard2__panel-actions">
            <a
              class="ccard2__panel-act"
              data-cy="ccard2-message"
              href={messageHref}
            >
              <I d={ICN.msg} size={12} sw={2.4} />{" "}
              {tFor(lang, "clientsBoard.panel.message")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

interface BoardProps {
  /** the page's cards, as the API cut them (REQ-135) */
  cards: CustomerCard[];
  /** the chip counts the API counted over the search */
  counts: Record<FilterId, number>;
  /** no customers on the books at all (the empty-roster copy, not "no matches") */
  rosterEmpty: boolean;
  query: string;
  onQuery: (q: string) => void;
  filter: FilterId;
  onFilter: (f: FilterId) => void;
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  children?: ComponentChildren;
  lang?: "en" | "es";
  /** REQ-145 — the account's subscriptions by customer id */
  subsByCustomer?: Map<string, SubscriptionView[]>;
}

export default function ClientsBoard(
  {
    cards,
    counts,
    rosterEmpty,
    query,
    onQuery,
    filter,
    onFilter,
    page,
    totalPages,
    onPage,
    children,
    lang = "en",
    subsByCustomer,
  }: BoardProps,
) {
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

  // REQ-135 — the rows ARE the page: the API searched, filtered and cut them
  const rows = cards;

  return (
    <>
      <div class="ctoolbar2">
        <div class="ctoolbar2__search">
          <I d={ICN.search} size={14} />
          <input
            data-cy="clients-search"
            placeholder={tFor(lang, "clientsBoard.searchPlaceholder")}
            value={query}
            onInput={(e) =>
              onQuery((e.currentTarget as HTMLInputElement).value)}
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
                onClick={() => onFilter(f.id)}
              >
                {tFor(lang, f.labelKey)}
                <span class="ctoolbar2__filter-count">
                  {counts[f.id]}
                </span>
              </button>
            );
          })}
        </div>
        <button class="ctoolbar2__sort" type="button">
          {tFor(lang, "clientsBoard.sort.warmth")}{" "}
          <I d={<path d="m6 9 6 6 6-6" />} size={12} sw={2.5} />
        </button>
        {/* REQ-208: the customers export carries numbers, contacts, documents and balances */}
        <a
          class="ctoolbar2__sort"
          data-cy="clients-export"
          href="/api/customers/export.csv"
          style="text-decoration:none"
        >
          {tFor(lang, "export.customers")}
        </a>
      </div>

      <div class="clay2">
        <div class="ccards2">
          {rows.map((c, i) => (
            <ClientCard
              key={c.id}
              c={c}
              subs={subsByCustomer?.get(c.id) ?? []}
              idx={i}
              isOpen={openId === c.id}
              onOpen={() => setOpenId(c.id)}
              onClose={() => setOpenId(null)}
              lang={lang}
            />
          ))}
          {rows.length === 0 && (
            <div class="ccards2__empty">
              {rosterEmpty
                ? tFor(lang, "clientsBoard.empty.noClients")
                : tFor(lang, "clientsBoard.empty.noMatches")}
            </div>
          )}
          {/* REQ-135 — the pager: one page at a time from the API */}
          {!rosterEmpty && (
            <nav class="cpager" data-cy="clients-pager" aria-label="pages">
              <button
                type="button"
                class="cpager__btn"
                data-cy="clients-prev"
                disabled={page <= 1}
                onClick={() =>
                  onPage(page - 1)}
              >
                ← {tFor(lang, "clientsBoard.prev")}
              </button>
              <span class="cpager__where" data-cy="clients-page">
                {tFor(lang, "clientsBoard.page", { page, pages: totalPages })}
              </span>
              <button
                type="button"
                class="cpager__btn"
                data-cy="clients-next"
                disabled={page >= totalPages}
                onClick={() =>
                  onPage(page + 1)}
              >
                {tFor(lang, "clientsBoard.next")} →
              </button>
            </nav>
          )}
        </div>
        <div class="cside2">
          {children}
        </div>
      </div>
    </>
  );
}
