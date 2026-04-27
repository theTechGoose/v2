import { useState } from "preact/hooks";
import { I, ICN, type IconName } from "../lib/dash-icons.tsx";

interface NavEntry { id: string; icon: IconName; label: string; count?: number; href: string }

const NAV: NavEntry[] = [
  { id: "home",      icon: "home",     label: "Dashboard",     href: "/dashboard" },
  { id: "jobs",      icon: "hardhat",  label: "Jobs",          href: "/jobs",      count: 7 },
  { id: "clients",   icon: "user",     label: "Clients",       href: "/clients" },
  { id: "quotes",    icon: "quote",    label: "Quotes",        href: "/quotes",    count: 4 },
  { id: "contracts", icon: "contract", label: "Contracts",     href: "/contracts" },
  { id: "invoices",  icon: "invoice",  label: "Invoices",      href: "/invoices",  count: 3 },
  { id: "payments",  icon: "pay",      label: "Payments",      href: "/payments" },
  { id: "messages",  icon: "msg",      label: "Conversations", href: "/messages",  count: 2 },
];

interface Props {
  active?: string;
  user?: { name?: string; phoneNumber: string };
  business?: string;
}

export default function DashSidebar({ active = "home", user, business }: Props) {
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

  const initials = (user?.name ?? user?.phoneNumber ?? "??").trim().slice(0, 2).toUpperCase();
  const displayName = user?.name ?? "Account";
  const biz = business ?? "Your business";

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
          <div class="sb__label">Account</div>
          <a class={`nav-item ${active === "settings" ? "nav-item--active" : ""}`} href="/settings">
            <span class="nav-item__icon"><I d={ICN.cog} size={18} /></span>
            <span class="nav-item__label">Settings</span>
          </a>
        </nav>

        <button type="button" class="sb__footer" onClick={toggle} title={collapsed ? "Expand" : "Collapse"}>
          <div class="sb__avatar">{initials}</div>
          <div class="sb__user-text">
            <div class="sb__user-name">{displayName}</div>
            <div class="sb__user-biz">{biz}</div>
          </div>
          <span class="sb__cog" aria-hidden="true">
            <I d={<><path d="M6 9l6 6 6-6" /></>} size={14} />
          </span>
        </button>
      </div>
    </aside>
  );
}
