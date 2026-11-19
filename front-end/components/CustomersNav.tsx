/**
 * REQ-924 — the sidebar's Customers context (rendered by the DashSidebar island on /customers and
 * /customers/<id>): Back to the root, "Customers · N", All customers (the board), New customer, then
 * one row per customer — initials, name (REQ-1149: with her number when another customer shares
 * the name), and the status line ("$X overdue" / "Owes $X" / the repeat
 * visit's schedule / the board's zero-balance word, REQ-990). The open customer's row is the active one. No search box here: the
 * top bar's search is the context-aware one.
 */
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import { clientsClient, type CustomerCard } from "../clients/clients.ts";
import { fieldClient, type SubscriptionView } from "../clients/field.ts";
import { subscriptionsByCustomer } from "../lib/field.ts";
import { zeroBalanceKey } from "../lib/clients-display.ts";
import {
  type CustomerNavRow,
  customerNavRows,
  shortMoney,
} from "../lib/customer-nav.ts";

/** the workspace fires this after an action changes what a customer owes — the rows re-read */
export const CUSTOMERS_CHANGED = "pm:customers-changed";

/** every page of the roster (100 a page, the server's cap), at most 20 pages */
async function allCards(): Promise<CustomerCard[]> {
  const out: CustomerCard[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await clientsClient.list({ page, pageSize: 100 });
    out.push(...r.items);
    if (page >= r.totalPages) break;
  }
  return out;
}

// v2 (REQ-990): rows carry `billed`; an older cached row would word a paid-up customer as never billed
// v3 (REQ-1149): same-name rows carry a `tag`; a v2 row would show two identical "Lupe Garza" rows
const CACHE_KEY = "pm:customers-nav:v3";
function readCachedRows(): CustomerNavRow[] | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CustomerNavRow[]) : null;
  } catch {
    return null;
  }
}
function writeCachedRows(rows: CustomerNavRow[]) {
  try {
    globalThis.sessionStorage?.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch { /* storage full or off — the next page reads the API again */ }
}

export const CUSTOMERS_NAV_CSS = `.nav-item--cust{padding:7px 12px}
.nav-item--cust .nav-item__label{display:flex;flex-direction:column;line-height:1.2;min-width:0}
.nav-item--cust .cnav__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
.nav-item--cust .cnav__tag{font-size:11px;font-weight:600;opacity:.7}
.nav-item--cust .cnav__sub{font-size:11px;font-weight:500;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav-item--cust .cnav__sub--late{color:#ffb3b3;opacity:1;font-weight:700}
.nav-item--active .cnav__sub--late{color:#fff}
.cnav__av{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-family:var(--font-heading);font-weight:800;font-size:9px;color:#fff;background:rgba(255,255,255,.18);box-shadow:0 0 0 1.5px rgba(255,255,255,.35)}
.nav-item--active .cnav__av{background:rgba(255,255,255,.28)}
.cnav__label{display:flex;justify-content:space-between}
.cnav__ic{display:inline-block;vertical-align:-1px;margin-right:4px}
.cnav__note{padding:8px 12px;font-size:12px;color:rgba(255,255,255,.6)}`;

function statusLine(r: CustomerNavRow, lang: Lang): string {
  if (r.tone === "late") {
    return tFor(lang, "customerWs.nav.overdue", {
      amount: shortMoney(r.amountCents),
    });
  }
  if (r.tone === "owes") {
    return tFor(lang, "customerWs.nav.owes", {
      amount: shortMoney(r.amountCents),
    });
  }
  // REQ-1147: the repeat icon is drawn as an SVG beside the line, not an emoji in it
  if (r.tone === "rec" && r.schedule) return r.schedule[lang];
  // REQ-990: the board's zero-balance word — "Settled", or "Nothing billed yet" when never billed
  return tFor(lang, zeroBalanceKey(r.billed ?? false));
}

export default function CustomersNav(
  { lang, activeId, onAllCustomers, collapsed, onBack, named }: {
    lang: Lang;
    /** the open customer, null on the board */
    activeId: string | null;
    /** true on /customers (the board is the open page) */
    onAllCustomers: boolean;
    collapsed: boolean;
    onBack: () => void;
    named: (label: string) => Record<string, string | undefined>;
  },
) {
  // the last list this tab read, so moving between customers shows it at once (then refreshes)
  const [rows, setRows] = useState<CustomerNavRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    // after hydration (the server rendered no rows): the cached list first, then the fresh one
    const cached = readCachedRows();
    if (cached) setRows(cached);
    const load = () =>
      Promise.all([
        allCards(),
        fieldClient.subscriptions().catch(() => [] as SubscriptionView[]),
      ]).then(([cards, subs]) => {
        if (!alive) return;
        const next = customerNavRows(cards, subscriptionsByCustomer(subs));
        setRows(next);
        writeCachedRows(next);
        setFailed(false);
      }).catch(() => {
        if (alive) setFailed(true);
      });
    load();
    globalThis.addEventListener(CUSTOMERS_CHANGED, load);
    return () => {
      alive = false;
      globalThis.removeEventListener(CUSTOMERS_CHANGED, load);
    };
  }, []);

  return (
    <>
      <style>{CUSTOMERS_NAV_CSS}</style>
      <button
        type="button"
        class="nav-item nav-item--back"
        data-cy="nav-back"
        onClick={onBack}
        {...named(tFor(lang, "nav.back"))}
      >
        <span class="nav-item__icon">
          <I d={ICN.chevLeft} size={18} />
        </span>
        {!collapsed && (
          <span class="nav-item__label">{tFor(lang, "nav.back")}</span>
        )}
      </button>
      {!collapsed && (
        <div class="sb__label cnav__label" data-cy="nav-folder-name">
          <span>{tFor(lang, "customerWs.nav.label")}</span>
          {rows && <span data-cy="nav-customers-count">{rows.length}</span>}
        </div>
      )}
      <a
        href="/customers"
        class={`nav-item ${onAllCustomers ? "nav-item--active" : ""}`}
        data-cy="nav-customers-all"
        {...named(tFor(lang, "customerWs.nav.all"))}
      >
        <span class="nav-item__icon">
          <I d={ICN.user} size={18} />
        </span>
        {!collapsed && (
          <span class="nav-item__label">
            {tFor(lang, "customerWs.nav.all")}
          </span>
        )}
      </a>
      <a
        href="/customers?new=1"
        class="nav-item"
        data-cy="nav-customers-new"
        {...named(tFor(lang, "customerWs.nav.new"))}
      >
        <span class="nav-item__icon">
          <I d={ICN.plus} size={18} />
        </span>
        {!collapsed && (
          <span class="nav-item__label">
            {tFor(lang, "customerWs.nav.new")}
          </span>
        )}
      </a>
      {failed && !collapsed && (
        <div class="cnav__note" role="alert">
          {tFor(lang, "customerWs.nav.error")}
        </div>
      )}
      {rows === null && !failed && !collapsed && (
        <div class="cnav__note">{tFor(lang, "customerWs.nav.loading")}</div>
      )}
      {rows?.length === 0 && !collapsed && (
        <div class="cnav__note">{tFor(lang, "customerWs.nav.empty")}</div>
      )}
      {rows?.map((r) => {
        const line = statusLine(r, lang);
        return (
          <a
            key={r.id}
            href={r.href}
            class={`nav-item nav-item--cust ${
              r.id === activeId ? "nav-item--active" : ""
            }`}
            data-cy="nav-customer-row"
            data-id={r.id}
            data-tone={r.tone}
            aria-current={r.id === activeId ? "page" : undefined}
            {...named(`${r.name}${r.tag ? ` · ${r.tag}` : ""} · ${line}`)}
          >
            <span class="nav-item__icon">
              <span class="cnav__av" aria-hidden="true">{r.initials}</span>
            </span>
            {!collapsed && (
              <span class="nav-item__label">
                <span class="cnav__name">
                  {r.name}
                  {/* REQ-1149: another customer has this name — her number (else phone/email) tells them apart */}
                  {r.tag && (
                    <span class="cnav__tag" data-cy="nav-customer-tag">
                      {" · "}
                      {r.tag}
                    </span>
                  )}
                </span>
                <span
                  class={`cnav__sub ${
                    r.tone === "late" ? "cnav__sub--late" : ""
                  }`}
                  data-cy="nav-customer-line"
                >
                  {r.tone === "rec" && r.schedule && (
                    <span class="cnav__ic" aria-hidden="true">
                      <I d={ICN.repeat} size={11} />
                    </span>
                  )}
                  {line}
                </span>
              </span>
            )}
          </a>
        );
      })}
    </>
  );
}
