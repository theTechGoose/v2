import { useState } from "preact/hooks";
import { I, ICN, type IconName } from "../lib/dash-icons.tsx";

interface NavEntry { id: string; icon: IconName; label: string; count?: number; href: string }

const NAV: NavEntry[] = [
  { id: "home",      icon: "home",     label: "Dashboard",     href: "/dashboard" },
  { id: "clients",   icon: "user",     label: "Clients",       href: "/clients" },
  { id: "quotes",    icon: "quote",    label: "Quotes",        href: "/quotes",    count: 4 },
  { id: "contracts", icon: "contract", label: "Contracts",     href: "/contracts" },
  { id: "invoices",  icon: "invoice",  label: "Invoices",      href: "/invoices",  count: 3 },
  { id: "payments",  icon: "pay",      label: "Payments",      href: "/payments" },
];

interface Props {
  active?: string;
}

export default function DashSidebar({ active = "home" }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof globalThis.localStorage === "undefined") return false;
    return globalThis.localStorage.getItem("pm:sb-collapsed") === "1";
  });

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
    <aside class={`sb ${collapsed ? "sb--collapsed" : ""}`}>
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
          {NAV.map((item) => (
            <a
              key={item.id}
              href={item.href}
              class={`nav-item ${active === item.id ? "nav-item--active" : ""}`}
            >
              <span class="nav-item__icon"><I d={ICN[item.icon]} size={18} /></span>
              <span class="nav-item__label">{item.label}</span>
              {item.count != null ? <span class="nav-item__count">{item.count}</span> : null}
            </a>
          ))}
        </nav>

        <div class="sb__bottom">
          <div class="sb__bottom-head">
            <span class="sb__label">Account</span>
            <button
              type="button"
              class="sb__toggle"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand" : "Collapse"}
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
  );
}
