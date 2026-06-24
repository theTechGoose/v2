# Capture checklist — DashSidebar

**Theme:** light only.
**Auth:** log in with dev master OTP `000000` (any seeded phone). Sidebar renders
on every authed route.

## Route / URL
- Any authed page, e.g. `http://localhost:5280/dashboard`.
- For `super-admin`: log in as a super-admin account (Admin tab only renders for them).
- For `no-nav`: `http://localhost:5280/accounts-manager`.

## Viewports (this component's own @media)
- **1280px** (desktop expanded + collapsed).
- **641px** (just above the drawer cutover — still a fixed rail).
- **390px** (mobile drawer; iPhone-ish).

## Element(s) to crop
- The `<aside class="sb">` rail (full height). On mobile also capture the
  `.sb-backdrop` scrim behind the open drawer.

## Transient states to drive
1. **default** — `/dashboard`, expanded, with seeded counts (clients/quotes/
   contracts/invoices badges visible).
2. **collapsed** — click `.sb__toggle` (or set `localStorage["pm:sb-collapsed"]="1"`
   and reload). Capture 84px rail with labels/counts hidden + toggle glyph rotated.
3. **active-quotes** — navigate to `/quotes`; Quotes row shows green active pill.
4. **empty** — a brand-new account (no clients/quotes/etc. and no name set):
   no badges, no `.sb__footer` block.
5. **super-admin** — Admin row present below Payments.
6. **mobile-open** — at 390px, click the topbar hamburger (`.topbar__menu`) to
   dispatch `pm:sb-toggle`; capture the slid-in drawer + scrim.
7. **no-nav** — `/accounts-manager`: rail chrome with brand + assistant + footer
   + toggle + logout, NO nav tabs.

## Motion to film
- Collapse/expand width transition (280ms bounce) + toggle glyph rotate (220ms).
- Mobile drawer slide-in (240ms bounce) + backdrop fade (180ms).
- Assistant CTA hover lift. Re-shoot each with `prefers-reduced-motion: reduce`.
