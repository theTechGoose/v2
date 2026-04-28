# `PhoneQuotes` — Mobile mockup (decorative)

> ✅ **Build for documentation only.** Side-by-side mobile preview shown next to the desktop layout in the prototype. **Do not ship as a desktop component** in production. On real mobile, the actual responsive `/quotes` layout takes over.

## Purpose

A 380 × 760 iPhone mockup rendered to the right of the desktop quotes page in the prototype. **The Phone for the Quotes page renders the same mobile DASHBOARD layout used by the Clients page's Phone preview** — greeting + KPIs + money-owed + quotes-waiting — not a mobile quotes view.

This is intentional: the iOS app analog's home screen is a stripped-down dashboard, and tapping a quote (or any item) drops the user into the assistant conversation for that quote, not a mobile pipeline list. There is no "mobile quotes track view" yet.

The mockup is **byte-identical** to the Clients page's `<Phone>` (compare Clients.html:4355–4486 ↔ Quotes.html:5364–5495). Document this once, here, and reuse from `pages/clients/components/phone-preview-clients.md`.

## Source

- **JSX:** `Paperwork Monsters Quotes.html` lines **5364–5495**
- **CSS:** Quotes.html — `.phone*`, `.phero*`, `.pkpi*`, `.pjob*`, `.psection-*`, `.ptab*`, `.home-indicator` (interleaved with the rest of the prototype's CSS, identical to the Clients/Dashboard prototype's phone styles)

## What's shared with `pages/clients/components/phone-preview-clients.md`

**Everything.** The two mockups are the same JSX. To avoid duplication:

- Read `pages/clients/components/phone-preview-clients.md` for the full breakdown of:
  - Phone shell, status bar, top greeting, bottom tab bar, home indicator
  - Hero copy ("2 wins today" / "2 quotes just got accepted" / "My assistant" CTA)
  - 4 KPI tiles (Active jobs / Money owed / Quotes out / This month)
  - "Money owed to you" section (Hilltop Diner / Sarah Chen / Maple Grove rows)
  - "Quotes waiting" section (renders `QUOTES.slice(0, 2)` from the dashboard's quote seed)

The Phone preview from the Quotes page is the same component as the one in the Clients package — they're literally copy-pasted.

## Specific to this page

Nothing. The component is identical. The only difference between `Clients.html`'s Phone and `Quotes.html`'s Phone is which other components live alongside them in the file (which is invisible to the rendered Phone).

This means:

- In production, the iOS app analog has a single mobile home screen, not one per desktop page.
- The "active page" sidebar nav state on desktop (`active === 'quotes'`) doesn't influence the Phone mockup at all.
- If a future iteration wants a mobile-specific quotes view, it would be a NEW component, not a variation of this Phone.

## Preact / Fresh translation

This component is **not** part of the production component library. The desktop `/quotes` route does not render it. On real mobile, the production responsive layout of `/quotes` replaces this — they're never both rendered.

If a Storybook entry is needed for design reference, point it at the same `_design/PhoneClients.tsx` file documented in `pages/clients/components/phone-preview-clients.md` rather than creating a duplicate `PhoneQuotes.tsx`.

## Props

None. Static.

## Data source

In production, the iOS app's home screen pulls from the same backend endpoints as `/dashboard`:

- `/profile` — greeting
- `/analytics/dashboard` — KPIs
- `/invoices?status=pending` — "Money owed to you"
- `/quotes?status=sent` — "Quotes waiting"
- `/notifications` — bell

(Same list as `pages/clients/components/phone-preview-clients.md` because — to repeat — these are the same component.)

## Island vs server

**Server.** No interactive state (the bottom tabs aren't wired in the prototype).

## Accessibility

If rendered alongside the desktop layout for design reference, set `aria-hidden="true"` on the entire mockup. Don't double-announce content the user can already see on the desktop view.

## Edge cases

- **Real mobile (<768 px):** do **not** render this mockup. The actual responsive `/quotes` layout takes over (cards stack to a single column, KPIs become 2×2 then 1, etc.). See `root.md` § Mobile breakpoints.
- **Tablet (768–1200 px):** the right rail of the desktop `/quotes` page collapses (`.qside { position: static; }`); the Phone mockup is also hidden at this width via the same media-query semantics that hide the dashboard's Phone.
- **Re-importing the Phone in code:** if you need the Phone in two places (Clients design ref + Quotes design ref), import it from one shared location — don't fork. The forks WILL drift.
