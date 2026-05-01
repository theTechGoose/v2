import { useEffect, useState } from "preact/hooks";
import { I, ICN, type IconName } from "../lib/dash-icons.tsx";
import { type DashboardStats } from "../clients/dashboard.ts";
import { type CachedDash, readCached, refreshDash, subscribeDash } from "../lib/dash-cache.ts";

interface NavEntry { id: string; icon: IconName; label: string; href: string; countKey?: CountKey }
type CountKey = "clients" | "quotes" | "contracts" | "invoices";

// Canonical NAV from the reference design (Paperwork Monsters Dashboard.html).
// `countKey` maps a sidebar entry to a derived count from /analytics/dashboard.
// We never seed counts client-side — if the fetch fails or returns 0, the
// badge is omitted (rendering an empty pill on a fresh account looks broken).
const NAV: NavEntry[] = [
  { id: "home",      icon: "home",     label: "Dashboard", href: "/dashboard" },
  { id: "clients",   icon: "user",     label: "Clients",   href: "/clients",   countKey: "clients" },
  { id: "quotes",    icon: "quote",    label: "Quotes",    href: "/quotes",    countKey: "quotes" },
  { id: "contracts", icon: "contract", label: "Contracts", href: "/contracts", countKey: "contracts" },
  { id: "invoices",  icon: "invoice",  label: "Invoices",  href: "/invoices",  countKey: "invoices" },
  { id: "payments",  icon: "pay",      label: "Payments",  href: "/payments" },
];

interface Props {
  active?: string;
}

interface SbState {
  counts: Partial<Record<CountKey, number>>;
  identity: { display: string; biz?: string; initials: string } | null;
}

const INITIAL_STATE: SbState = { counts: {}, identity: null };

function deriveInitials(name: string | undefined, fallback: string | undefined): string {
  const src = name?.trim() || fallback?.trim();
  if (!src) return "•";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function pickCounts(stats: DashboardStats): Partial<Record<CountKey, number>> {
  // "Active" totals only — drafts shouldn't badge as new work since the user
  // hasn't sent them yet. Quotes uses sent (not total) for the same reason.
  return {
    clients: stats.customers,
    quotes: stats.quotes.sent,
    contracts: stats.contracts.signed,
    invoices: stats.invoices.pending,
  };
}

/** Project the shared dash-cache snapshot onto the sidebar's slice. */
function projectSidebar(snap: CachedDash | null): SbState {
  if (!snap) return INITIAL_STATE;
  const { stats, profile } = snap;
  const userName = profile?.user.name?.trim();
  const bizName = (profile?.identity?.businessName ?? profile?.identity?.displayName)?.trim();
  const counts = stats ? pickCounts(stats) : {};
  if (!userName && !bizName) return { counts, identity: null };
  const display = userName || bizName || "Account";
  const biz = userName && bizName ? bizName : undefined;
  const fallback = profile?.initials?.trim();
  const initials = (fallback && fallback !== "?" ? fallback : null) ?? deriveInitials(userName, bizName);
  return { counts, identity: { display, biz, initials } };
}

export default function DashSidebar({ active = "home" }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof globalThis.localStorage === "undefined") return false;
    return globalThis.localStorage.getItem("pm:sb-collapsed") === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  // Seed from the shared cache so a navigation between pages renders the
  // last-known counts/identity immediately and the badge doesn't flash
  // empty before the refetch lands.
  const [s, setS] = useState<SbState>(() => projectSidebar(readCached()));

  useEffect(() => {
    const onToggle = () => setMobileOpen((o) => !o);
    globalThis.addEventListener("pm:sb-toggle", onToggle as EventListener);
    return () => globalThis.removeEventListener("pm:sb-toggle", onToggle as EventListener);
  }, []);

  useEffect(() => {
    let alive = true;
    // Subscribe so any sibling island that triggers a refresh propagates
    // here without us re-fetching.
    const unsub = subscribeDash((snap) => {
      if (!alive) return;
      setS(projectSidebar(snap));
    });
    refreshDash().then((snap) => {
      if (!alive) return;
      setS(projectSidebar(snap));
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try { globalThis.localStorage?.setItem("pm:sb-collapsed", next ? "1" : "0"); } catch { /* SSR-safe */ }
      return next;
    });
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" } });
    } catch { /* network down — proxy still clears the cookie locally on retry; redirect anyway */ }
    globalThis.location.href = "/";
  }

  return (
    <>
      {mobileOpen && <div class="sb-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
    <aside class={`sb ${collapsed ? "sb--collapsed" : ""} ${mobileOpen ? "sb--open" : ""}`}>
      <div class="sb__inner">
        <div class="sb__brand">
          <div class="sb__brand-logo">
            <img src="/logo-monster.png" alt="" style="width:30px;height:30px;object-fit:contain" />
          </div>
          <div class="sb__brand-text">
            <div class="sb__brand-name">Paperwork Monsters</div>
          </div>
        </div>

        <a class="sb__textus" href="/assistant" title="My assistant — AI quote builder">
          <div class="sb__textus-icon"><I d={ICN.crown} size={18} /></div>
          <div class="sb__textus-text"><span>My assistant</span></div>
        </a>

        <div class="sb__divider" />

        <nav class="sb__nav">
          {NAV.map((item) => {
            const count = item.countKey ? s.counts[item.countKey] : undefined;
            return (
              <a
                key={item.id}
                href={item.href}
                class={`nav-item ${active === item.id ? "nav-item--active" : ""}`}
              >
                <span class="nav-item__icon"><I d={ICN[item.icon]} size={18} /></span>
                <span class="nav-item__label">{item.label}</span>
                {count != null && count > 0 ? <span class="nav-item__count">{count}</span> : null}
              </a>
            );
          })}
        </nav>

        <div class="sb__bottom">
          {s.identity && (
            <a
              href="/settings"
              class="sb__footer"
              style="display:flex;align-items:center;gap:10px;padding:10px 8px;margin:0 0 6px;border-radius:10px;text-decoration:none;color:inherit;background:rgba(255,255,255,0.04);"
              title={s.identity.biz ? `${s.identity.display} · ${s.identity.biz}` : s.identity.display}
            >
              <span
                aria-hidden="true"
                style="flex:0 0 auto;width:32px;height:32px;border-radius:50%;background:var(--brand-green,#519843);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;letter-spacing:0.04em"
              >
                {s.identity.initials}
              </span>
              <span class="sb__footer-text" style="min-width:0;flex:1;display:flex;flex-direction:column;line-height:1.2;overflow:hidden">
                <span style="font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{s.identity.display}</span>
                {s.identity.biz && (
                  <span style="font-size:11px;color:rgba(255,255,255,0.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{s.identity.biz}</span>
                )}
              </span>
              <span class="sb__footer-chev" style="flex:0 0 auto;color:rgba(255,255,255,0.55)"><I d={ICN.chev} size={14} /></span>
            </a>
          )}
          <div class="sb__bottom-head" style="display:flex;align-items:center;justify-content:flex-end;padding:4px 4px 2px">
            <button
              type="button"
              class="sb__toggle"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand" : "Collapse"}
              style="width:28px;height:28px;border-radius:9px;background:rgba(255,255,255,0.08);border:none;color:rgba(255,255,255,0.65);cursor:pointer;display:grid;place-items:center;flex-shrink:0"
            >
              <I d={<><path d="M6 9l6 6 6-6" /></>} size={14} />
            </button>
          </div>
          <a class={`nav-item ${active === "settings" ? "nav-item--active" : ""}`} href="/settings">
            <span class="nav-item__icon"><I d={ICN.cog} size={18} /></span>
            <span class="nav-item__label">Settings</span>
          </a>
          <button type="button" class="nav-item nav-item--logout" onClick={logout}>
            <span class="nav-item__icon"><I d={ICN.logout} size={18} /></span>
            <span class="nav-item__label">Log out</span>
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}
