import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { type DashboardStats } from "../clients/dashboard.ts";
import {
  type CachedDash,
  readCached,
  refreshDash,
  subscribeDash,
} from "../lib/dash-cache.ts";
import { langSignal, tFor } from "../lib/i18n.ts";
import {
  type AccountsView,
  adminsClient,
  isActing,
} from "../clients/admins.ts";
import { isFolder, viewAt } from "../lib/nav-folders.ts";
import { restingPath, SB_DRAWER_CSS } from "../lib/sb-drawer.ts";
import { NAV } from "../lib/nav-tree.ts";

type CountKey = "clients" | "quotes" | "invoices";

// REQ-176 — the tree itself is data in lib/nav-tree.ts; this island renders one level of it.

interface Props {
  active?: string;
  /** When false, the nav-tab list (Dashboard/Clients/…/Admin) is omitted and
   *  only the sidebar chrome — brand, Assistant CTA, user footer, collapse,
   *  logout — renders. Used by the accounts-manager view, which wants the
   *  regular shell with no tabs yet. */
  showNav?: boolean;
}

interface SbState {
  counts: Partial<Record<CountKey, number>>;
  identity: { display: string; biz?: string; initials: string } | null;
  /** Contractor UI language (roadmap p.13). */
  lang: "en" | "es";
  /** Super-admin flag — gates the Admin tab. Server-enforced; this only
   *  controls visibility. */
  superAdmin: boolean;
}

const INITIAL_STATE: SbState = {
  counts: {},
  identity: null,
  lang: "en",
  superAdmin: false,
};

function deriveInitials(
  name: string | undefined,
  fallback: string | undefined,
): string {
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
    invoices: stats.invoices.pending,
  };
}

/** Project the shared dash-cache snapshot onto the sidebar's slice. */
function projectSidebar(snap: CachedDash | null): SbState {
  if (!snap) return INITIAL_STATE;
  const { stats, profile } = snap;
  const userName = profile?.user.name?.trim();
  const bizName =
    (profile?.identity?.businessName ?? profile?.identity?.displayName)?.trim();
  const counts = stats ? pickCounts(stats) : {};
  const lang = profile?.user.language === "es" ? "es" : "en";
  const superAdmin = profile?.user.superAdmin === true;
  if (!userName && !bizName) {
    return { counts, identity: null, lang, superAdmin };
  }
  const display = userName || bizName || tFor(lang, "common.account");
  const biz = userName && bizName ? bizName : undefined;
  const fallback = profile?.initials?.trim();
  const initials = (fallback && fallback !== "?" ? fallback : null) ??
    deriveInitials(userName, bizName);
  return { counts, identity: { display, biz, initials }, lang, superAdmin };
}

export default function DashSidebar(
  { active = "home", showNav = true }: Props,
) {
  // REQ-156 — which folder is open: the active entry's, until Back or a folder row is clicked
  const [path, setPath] = useState<string[]>(() => restingPath(active));
  const view = viewAt(NAV, path);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof globalThis.localStorage === "undefined") return false;
    return globalThis.localStorage.getItem("pm:sb-collapsed") === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  // REQ-358 — every close (✕, backdrop, ☰, Escape) puts the drawer back at the page's folder,
  // so it never re-opens on the folder browsed last.
  useEffect(() => {
    if (!mobileOpen) setPath(restingPath(active));
  }, [mobileOpen]);
  // REQ-358 — Escape closes the phone drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [mobileOpen]);
  // Seed from the shared cache so a navigation between pages renders the
  // last-known counts/identity immediately and the badge doesn't flash
  // empty before the refetch lands.
  const [s, setS] = useState<SbState>(() => projectSidebar(readCached()));
  // REQ-146: the accounts this session can act in — the switcher shows when
  // there is more than one, the "In X's account" line when acting for another's.
  const [accounts, setAccounts] = useState<AccountsView | null>(null);
  useEffect(() => {
    let alive = true;
    adminsClient.accounts().then((v) => {
      if (alive) setAccounts(v);
    }).catch(() => {/* no session yet, or the API is down — no switcher */});
    return () => {
      alive = false;
    };
  }, []);

  async function switchAccount(userId: string) {
    if (!accounts || userId === accounts.currentUserId) return;
    globalThis.dispatchEvent(new Event("pm:logout"));
    try {
      await adminsClient.switchTo(userId);
    } catch {
      return;
    }
    try {
      globalThis.sessionStorage?.removeItem("pm:dash-cache:v1");
    } catch { /* private mode */ }
    globalThis.location.href = "/dashboard";
  }

  useEffect(() => {
    // Roadmap p.2/p.4: the topbar hamburger drives the rail. On desktop it
    // collapses/expands the rail QuickBooks-style; on mobile it slides the
    // drawer in/out. (Previously it only ever toggled the mobile drawer, so
    // on desktop the hamburger appeared to "do nothing".)
    const onToggle = () => {
      const wide = typeof globalThis.innerWidth === "number" &&
        globalThis.innerWidth >= 641;
      if (wide) toggle();
      else setMobileOpen((o) => !o);
    };
    globalThis.addEventListener("pm:sb-toggle", onToggle as EventListener);
    return () =>
      globalThis.removeEventListener("pm:sb-toggle", onToggle as EventListener);
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
      try {
        globalThis.localStorage?.setItem("pm:sb-collapsed", next ? "1" : "0");
      } catch { /* SSR-safe */ }
      return next;
    });
  }

  async function logout() {
    // P-67: tell polling islands (DashTopbar) to stand down BEFORE the
    // session dies, so no in-flight poll lands mid-transition.
    globalThis.dispatchEvent(new Event("pm:logout"));
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
    } catch {
      /* network down — proxy still clears the cookie locally on retry; redirect anyway */
    }
    globalThis.location.href = "/";
  }

  // Reactive UI language: seeded from the profile cache, flipped instantly
  // when Settings changes it. Reading langSignal here re-renders the rail.
  const lang = langSignal.value;

  return (
    <>
      {mobileOpen && (
        <Backdrop
          class="sb-backdrop"
          onClose={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <style>{SB_DRAWER_CSS}</style>
      <aside
        class={`sb ${collapsed ? "sb--collapsed" : ""} ${
          mobileOpen ? "sb--open" : ""
        }`}
      >
        {
          /* Pre-paint collapse: SSR can't know localStorage, so without this
            a collapsed rail flashes expanded until hydration. The parser runs
            this synchronously before painting the nav below. Hydration then
            re-derives the same class from the useState initializer. */
        }
        <script
          // deno-lint-ignore react-no-danger
          dangerouslySetInnerHTML={{
            __html:
              `(function(){try{if(localStorage.getItem("pm:sb-collapsed")==="1"){var s=document.currentScript;var a=s&&s.closest(".sb");if(a){a.classList.add("sb--collapsed");}}}catch(_){}})();`,
          }}
        />
        <div class="sb__inner">
          <div class="sb__head">
            <a
              class="sb__brand"
              href="/dashboard"
              title={tFor(lang, "nav.brandTitle")}
              style="text-decoration:none;color:inherit"
            >
              <div class="sb__brand-logo">
                <img
                  src="/logo-monster-card.png"
                  alt=""
                  style="width:30px;height:30px;object-fit:cover;border-radius:8px;display:block"
                />
              </div>
              <div class="sb__brand-text">
                <div class="sb__brand-name">{tFor(lang, "brand.name")}</div>
              </div>
            </a>
            {/* REQ-358 — the drawer covers the ☰, so it carries its own close (phone widths only) */}
            <button
              type="button"
              class="sb__close"
              data-cy="sb-close"
              aria-label={tFor(lang, "nav.closeMenu")}
              title={tFor(lang, "nav.closeMenu")}
              onClick={() => setMobileOpen(false)}
            >
              <I d={<path d="M6 6l12 12M18 6L6 18" />} size={20} />
            </button>
          </div>

          <a
            class="sb__textus"
            href="/assistant"
            title={tFor(lang, "nav.assistantTitle")}
          >
            <div class="sb__textus-icon">
              <I d={ICN.crown} size={18} />
            </div>
            <div class="sb__textus-text">
              <span>{tFor(lang, "nav.assistant")}</span>
            </div>
          </a>

          <div class="sb__divider" />

          {showNav && (
            <nav class="sb__nav">
              {view.parentPath !== null && (
                <button
                  type="button"
                  class="nav-item nav-item--back"
                  data-cy="nav-back"
                  onClick={() => setPath(view.parentPath!)}
                  title={tFor(lang, "nav.back")}
                >
                  <span class="nav-item__icon">
                    <I d={ICN.chevLeft} size={18} />
                  </span>
                  {!collapsed && (
                    <span class="nav-item__label">
                      {tFor(lang, "nav.back")}
                    </span>
                  )}
                </button>
              )}
              {view.folder && !collapsed && (
                <div class="sb__label" data-cy="nav-folder-name">
                  {tFor(lang, `nav.${view.folder.id}`)}
                </div>
              )}
              {view.items.map((item) => {
                if (isFolder(item)) {
                  return (
                    <button
                      type="button"
                      key={item.id}
                      class="nav-item nav-item--folder"
                      data-cy={`nav-folder-${item.id}`}
                      onClick={() => setPath([...path, item.id])}
                      title={tFor(lang, `nav.${item.id}`)}
                    >
                      <span class="nav-item__icon">
                        <I d={ICN[item.icon]} size={18} />
                      </span>
                      {!collapsed && (
                        <span class="nav-item__label">
                          {tFor(lang, `nav.${item.id}`)}
                        </span>
                      )}
                      {!collapsed && (
                        <span class="nav-item__chev">
                          <I d={ICN.chev} size={16} />
                        </span>
                      )}
                    </button>
                  );
                }
                const count = item.countKey
                  ? s.counts[item.countKey as CountKey]
                  : undefined;
                return (
                  <a
                    key={item.id}
                    href={item.href}
                    class={`nav-item ${
                      active === item.id ? "nav-item--active" : ""
                    }`}
                  >
                    <span class="nav-item__icon">
                      <I d={ICN[item.icon]} size={18} />
                    </span>
                    {
                      /* Icon-only rail: the label leaves the DOM entirely when
                      collapsed (not just display:none) so the rail is a true
                      QuickBooks-style icon rail (roadmap p9). */
                    }
                    {!collapsed && (
                      <span class="nav-item__label">
                        {tFor(lang, `nav.${item.id}`)}
                      </span>
                    )}
                    {!collapsed && count != null && count > 0
                      ? <span class="nav-item__count">{count}</span>
                      : null}
                  </a>
                );
              })}
              {
                /* Super-admin tab — super-admins only, inside the Admin folder
                (REQ-176). Server enforces the /admin gate too (route middleware
                + every endpoint); this just hides the entry for everyone else.
                Label is intentionally not i18n'd (internal operator tool). */
              }
              {s.superAdmin && view.folder?.id === "manage" && (
                <a
                  href="/admin"
                  class={`nav-item ${
                    active === "admin" ? "nav-item--active" : ""
                  }`}
                >
                  <span class="nav-item__icon">
                    <I d={ICN.shield} size={18} />
                  </span>
                  {!collapsed && <span class="nav-item__label">Admin</span>}
                </a>
              )}
            </nav>
          )}

          <div class="sb__bottom">
            {s.identity && (
              <a
                href="/settings"
                class="sb__footer"
                style="display:flex;align-items:center;gap:10px;padding:10px 8px;margin:0 0 6px;border-radius:10px;text-decoration:none;color:inherit;background:rgba(255,255,255,0.04);"
                title={s.identity.biz
                  ? `${s.identity.display} · ${s.identity.biz}`
                  : s.identity.display}
              >
                <span
                  aria-hidden="true"
                  style="flex:0 0 auto;width:32px;height:32px;border-radius:50%;background:var(--brand-green,#519843);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;letter-spacing:0.04em"
                >
                  {s.identity.initials}
                </span>
                <span
                  class="sb__footer-text"
                  style="min-width:0;flex:1;display:flex;flex-direction:column;line-height:1.2;overflow:hidden"
                >
                  <span style="font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    {s.identity.display}
                  </span>
                  {s.identity.biz && (
                    <span style="font-size:11px;color:rgba(255,255,255,0.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                      {s.identity.biz}
                    </span>
                  )}
                </span>
                <span
                  class="sb__footer-chev"
                  style="flex:0 0 auto;color:rgba(255,255,255,0.55)"
                >
                  <I d={ICN.chev} size={14} />
                </span>
              </a>
            )}
            {
              /* Roadmap p.4: removed the duplicate "Settings" nav link — the user block
              above (which opens /settings) is the single entry point. */
            }
            {
              /* REQ-146: whose account this is, and the switch between the
              accounts this person can act in. */
            }
            {accounts && isActing(accounts) && (
              <div
                class="sb__acting"
                data-cy="acting-in"
                style="display:flex;align-items:center;gap:6px;margin:0 8px 6px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.08);color:#fff;font-size:12px;line-height:1.3"
              >
                <I d={ICN.shield} size={12} />{" "}
                {!collapsed && tFor(lang, "nav.actingIn", {
                  label: accounts.accounts.find((a) =>
                    a.userId === accounts.currentUserId
                  )?.label ?? "",
                })}
              </div>
            )}
            {accounts && accounts.accounts.length > 1 && !collapsed && (
              <label
                class="sb__switch"
                style="display:block;margin:0 8px 8px;color:rgba(255,255,255,0.7);font-size:11px"
              >
                {tFor(lang, "nav.switchAccount")}
                <select
                  data-cy="account-switch"
                  value={accounts.currentUserId}
                  style="display:block;width:100%;margin-top:4px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.25);color:#fff;font-size:12px"
                  onChange={(e) =>
                    switchAccount((e.currentTarget as HTMLSelectElement).value)}
                >
                  {accounts.accounts.map((a) => (
                    <option value={a.userId} key={a.userId}>
                      {a.role === "owner"
                        ? tFor(lang, "nav.myAccount")
                        : a.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {
              /* REQ-143: the worker screen is always one click away — it is a
              separate login (cell + PIN), so this is a plain link. */
            }
            <a
              href="/worker"
              class="nav-item"
              style="color:rgba(255,255,255,0.7)"
              data-cy="nav-worker-view"
            >
              <span class="nav-item__icon">
                <I d={ICN.hardhat} size={18} />
              </span>
              {!collapsed && (
                <span class="nav-item__label">
                  {tFor(lang, "nav.workerView")}
                </span>
              )}
            </a>
            <button
              type="button"
              class="nav-item nav-item--logout"
              onClick={logout}
            >
              <span class="nav-item__icon">
                <I d={ICN.logout} size={18} />
              </span>
              <span class="nav-item__label">
                {tFor(lang, "nav.logout")}
              </span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
