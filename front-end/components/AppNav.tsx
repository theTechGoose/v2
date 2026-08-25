import { Brand } from "./ui/Brand.tsx";
import { Icon } from "./ui/Icon.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";

export interface NavItem {
  href: string;
  labelKey: string;
  icon:
    | "home"
    | "doc"
    | "file-text"
    | "receipt"
    | "chat"
    | "users"
    | "settings";
  badge?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", labelKey: "appNav.home", icon: "home" },
  { href: "/assistant", labelKey: "appNav.assistant", icon: "chat" },
  { href: "/quotes", labelKey: "nav.quotes", icon: "doc" },
  { href: "/invoices", labelKey: "nav.invoices", icon: "receipt" },
  { href: "/customers", labelKey: "appNav.customers", icon: "users" },
  { href: "/settings", labelKey: "appNav.settings", icon: "settings" },
];

interface Props {
  active?: string;
  badges?: Partial<Record<string, number>>;
  user?: { name?: string; phoneNumber: string };
  business?: string;
  lang?: Lang;
}

export function AppSidebar(
  { active, badges = {}, user, business, lang = "en" }: Props,
) {
  const initials = (user?.name ?? user?.phoneNumber ?? "?").trim().slice(0, 1)
    .toUpperCase();
  return (
    <aside class="sidebar" aria-label={tFor(lang, "appNav.ariaPrimary")}>
      <div class="sidebar__brand">
        <Brand size="sm" />
      </div>
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
              <span>{tFor(lang, item.labelKey)}</span>
            </span>
            {badges[item.href]
              ? <span class="sidebar__badge">{badges[item.href]}</span>
              : null}
          </a>
        ))}
      </nav>
      <div class="sidebar__profile">
        <div class="avatar">{initials}</div>
        <div class="col" style="line-height:1.2">
          <strong style="font-size:14px">
            {user?.name ?? tFor(lang, "common.account")}
          </strong>
          {business ? <span class="micro">{business}</span> : null}
        </div>
      </div>
    </aside>
  );
}
