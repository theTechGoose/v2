import { Brand } from "./ui/Brand.tsx";
import { Icon } from "./ui/Icon.tsx";

export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "doc" | "file-text" | "receipt" | "chat" | "users" | "settings";
  badge?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard",  label: "Home",          icon: "home" },
  { href: "/assistant",  label: "Assistant",     icon: "chat" },
  { href: "/quotes",     label: "Quotes",        icon: "doc" },
  { href: "/contracts",  label: "Contracts",     icon: "file-text" },
  { href: "/invoices",   label: "Invoices",      icon: "receipt" },
  { href: "/customers",  label: "Customers",     icon: "users" },
  { href: "/settings",   label: "Settings",      icon: "settings" },
];

interface Props {
  active?: string;
  badges?: Partial<Record<string, number>>;
  user?: { name?: string; phoneNumber: string };
  business?: string;
}

export function AppSidebar({ active, badges = {}, user, business }: Props) {
  const initials = (user?.name ?? user?.phoneNumber ?? "?").trim().slice(0, 1).toUpperCase();
  return (
    <aside class="sidebar" aria-label="Primary">
      <div class="sidebar__brand"><Brand size="sm" /></div>
      <nav class="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            class={`sidebar__item ${active === item.href ? "active" : ""}`}
            aria-current={active === item.href ? "page" : undefined}
          >
            <span class="row gap-3">
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </span>
            {badges[item.href] ? <span class="sidebar__badge">{badges[item.href]}</span> : null}
          </a>
        ))}
      </nav>
      <div class="sidebar__profile">
        <div class="avatar">{initials}</div>
        <div class="col" style="line-height:1.2">
          <strong style="font-size:14px">{user?.name ?? "Account"}</strong>
          {business ? <span class="micro">{business}</span> : null}
        </div>
      </div>
    </aside>
  );
}
