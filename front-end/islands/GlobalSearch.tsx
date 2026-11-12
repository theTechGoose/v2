/**
 * REQ-207 — the dashboard's search box (topbar).
 *
 * One input finds a customer, a quote, an invoice, a change order or a work
 * order by number (full or partial), customer name or number, address, date
 * or job text. `/` focuses it from anywhere on the page, typing is debounced
 * 250 ms and hits GET /api/search?q=, the rows come back ranked (exact
 * number, prefix, substring — shared/documents/search.ts) and are shown
 * grouped by type. Arrow keys move, Enter opens the highlighted row (or the
 * best one), Escape closes. Every row carries the customer, the number and
 * type, the amount, the state and links to its related records.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { dashboardClient, type SearchHit } from "../clients/dashboard.ts";
import { langSignal, tFor, tnFor } from "../lib/i18n.ts";
import { bestHit, groupHits } from "../../shared/documents/search.ts";

const DEBOUNCE_MS = 250;
const PER_TYPE = 8;

// Rendered by the island itself (part of its vdom), so hydration keeps it —
// unlike a route-level <style> that lands inside an island boundary.
const CSS = `
.gsearch{position:relative}
.gsearch__icon{flex-shrink:0;color:var(--fg-subtle)}
.gsearch__panel{position:absolute;top:calc(100% + 6px);left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 12px 32px rgba(20,72,82,.14);max-height:min(70vh,520px);overflow:auto;z-index:60;padding:6px;text-align:left}
.gsearch__heading{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--fg-muted);padding:8px 10px 4px}
.gsearch__row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:8px 10px;border-radius:10px;cursor:pointer;color:var(--fg)}
.gsearch__row--on{background:rgba(20,72,82,.07)}
.gsearch__main{min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.gsearch__customer{font-weight:700;color:var(--brand-teal)}
.gsearch__num{font-family:var(--font-mono);font-size:12px;color:var(--fg-muted);white-space:nowrap}
.gsearch__meta{text-align:right;font-size:12px;white-space:nowrap;display:flex;align-items:center;gap:8px}
.gsearch__amt{font-weight:700;color:var(--fg)}
.gsearch__status{padding:1px 7px;border-radius:999px;background:rgba(100,69,54,.08);font-size:11px;color:var(--fg-muted)}
.gsearch__status--paid,.gsearch__status--accepted,.gsearch__status--approved,.gsearch__status--done{background:rgba(81,152,67,.14);color:#2f6b25}
.gsearch__sub,.gsearch__related{grid-column:1/-1;font-size:12px;color:var(--fg-muted);min-width:0;overflow:hidden;text-overflow:ellipsis}
.gsearch__related a{margin-left:6px;color:var(--brand-teal);text-decoration:underline;white-space:nowrap}
.gsearch__note{padding:10px;font-size:13px;color:var(--fg-muted)}
@media (max-width:720px){.topbar__search{max-width:none}.gsearch__panel{position:fixed;left:8px;right:8px;top:64px}}
`;

function money(cents: number, lang: "en" | "es"): string {
  return new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function statusLabel(lang: "en" | "es", status: string): string {
  const key = `search.status.${status}`;
  const label = tFor(lang, key);
  return label === key ? status : label;
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
    el.isContentEditable === true;
}

export default function GlobalSearch() {
  const lang = langSignal.value;
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  // the query the shown rows answer (a test waits for it before reading rows)
  const [answered, setAnswered] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // data-cy hooks appear only once hydrated, so a test never types before the handlers are live
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => setMounted(true), []);

  // "/" focuses the box from anywhere that is not already a text field
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // a click anywhere else closes the panel
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // debounced search; a stale answer never overwrites a newer one
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      setState("idle");
      setActive(-1);
      return;
    }
    setState("loading");
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const { results } = await dashboardClient.search(query, {
          limit: PER_TYPE,
        });
        if (seq.current !== id) return;
        const ordered = groupHits(results).flatMap((g) => g.hits);
        setHits(ordered);
        setAnswered(query);
        setState("ready");
        const best = bestHit(ordered);
        setActive(best ? ordered.indexOf(best) : -1);
        setOpen(true);
      } catch {
        if (seq.current === id) setState("error");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const groups = groupHits(hits);
  const showPanel = open && q.trim() !== "";

  function go(hit: SearchHit) {
    setOpen(false);
    globalThis.location.assign(hit.url);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (hits.length ? Math.min(hits.length - 1, i + 1) : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (hits.length ? Math.max(0, i - 1) : -1));
    } else if (e.key === "Enter") {
      const hit = hits[active] ?? bestHit(hits);
      if (hit) {
        e.preventDefault();
        go(hit);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div
      ref={rootRef}
      class="topbar__search gsearch"
      data-cy={mounted ? "global-search" : undefined}
    >
      <style>{CSS}</style>
      <svg
        class="gsearch__icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder={tFor(lang, "search.placeholder")}
        aria-label={tFor(lang, "search.label")}
        aria-expanded={showPanel}
        aria-controls="gsearch-list"
        aria-activedescendant={active >= 0
          ? `gsearch-opt-${active}`
          : undefined}
        role="combobox"
        autocomplete="off"
        data-cy={mounted ? "global-search-input" : undefined}
        onInput={(e) => {
          setQ((e.currentTarget as HTMLInputElement).value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd class="topbar__kbd" title={tFor(lang, "search.shortcut")}>/</kbd>
      {showPanel && (
        <div
          class="gsearch__panel"
          id="gsearch-list"
          role="listbox"
          data-cy="global-search-results"
          data-state={state}
          data-q={answered}
        >
          {state === "loading" && hits.length === 0 && (
            <div class="gsearch__note">{tFor(lang, "search.searching")}</div>
          )}
          {state === "error" && (
            <div class="gsearch__note" role="alert">
              {tFor(lang, "search.error")}
            </div>
          )}
          {state === "ready" && hits.length === 0 && (
            <div class="gsearch__note" data-cy="global-search-empty">
              {tFor(lang, "search.noResults", { q: q.trim() })}
            </div>
          )}
          {groups.map((g) => (
            <div
              key={g.type}
              class="gsearch__group"
              data-cy={`global-search-group-${g.type}`}
            >
              <div class="gsearch__heading">
                {tFor(lang, `search.group.${g.type}`)}
              </div>
              {g.hits.map((h) => {
                const idx = hits.indexOf(h);
                const title = h.customerName ?? h.label;
                const line = h.type === "customer"
                  ? h.sub
                  : [h.label !== title ? h.label : undefined, h.sub]
                    .filter(Boolean).join(" · ");
                return (
                  <div
                    key={`${h.type}-${h.id}`}
                    id={`gsearch-opt-${idx}`}
                    role="option"
                    aria-selected={idx === active}
                    class={`gsearch__row ${
                      idx === active ? "gsearch__row--on" : ""
                    }`}
                    data-cy="global-search-row"
                    data-type={h.type}
                    data-number={h.number}
                    data-id={h.id}
                    data-url={h.url}
                    onMouseEnter={() => setActive(idx)}
                    onMouseDown={(e) => {
                      // before the input blurs and the panel closes
                      e.preventDefault();
                      go(h);
                    }}
                  >
                    <div class="gsearch__main">
                      <span class="gsearch__customer">{title}</span>
                      <span class="gsearch__num">
                        {h.number} · {tFor(lang, `search.type.${h.type}`)}
                        {h.version > 1
                          ? ` · ${
                            tFor(lang, "search.version", { version: h.version })
                          }`
                          : ""}
                      </span>
                    </div>
                    <div class="gsearch__meta">
                      {typeof h.amountCents === "number" && (
                        <span class="gsearch__amt">
                          {money(h.amountCents, lang)}
                        </span>
                      )}
                      {h.status && (
                        <span
                          class={`gsearch__status gsearch__status--${h.status}`}
                        >
                          {statusLabel(lang, h.status)}
                        </span>
                      )}
                    </div>
                    {line && <div class="gsearch__sub">{line}</div>}
                    {h.counts && (
                      <div class="gsearch__sub" data-cy="global-search-counts">
                        {/* REQ-350: each count agrees with its noun */}
                        {tnFor(lang, "search.counts.quotes", h.counts.quotes)}
                        {" · "}
                        {tnFor(
                          lang,
                          "search.counts.invoices",
                          h.counts.invoices,
                        )}
                      </div>
                    )}
                    {h.related.length > 0 && (
                      <div class="gsearch__related">
                        {tFor(lang, "search.related")}
                        {h.related.map((r) => (
                          <a
                            key={`${r.type}-${r.id}`}
                            href={r.url}
                            data-cy="global-search-related"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            {tFor(lang, `search.type.${r.type}`)} {r.number}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
