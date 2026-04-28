# `PhoneClients` — Mobile mockup (decorative)

> ✅ **Build for documentation only.** This is the side-by-side mobile preview shown next to the desktop layout in the prototype. **Do not ship as a desktop component** in production — on real mobile, the actual responsive `/clients` layout takes over. Treat this file as the spec for what the contractor sees on the iOS app analog.

## Purpose

A 380 × 760 px iPhone mockup that sits to the right of the clients page in the design tool. It does **not** show a mobile clients list — instead, it shows the **mobile dashboard** (greeting + KPIs + money-owed + quotes-waiting). The "My assistant" CTA inside the hero links across to `Paperwork Monsters Assistant.html`.

This is intentional: when a contractor taps a client on the mobile app, they don't land in a list view, they land in the assistant conversation for that client. The mobile "home" is therefore a stripped-down dashboard, not a stripped-down clients list.

The iPhone chrome is identical to the dashboard's `<Phone>` mockup — same notch, status bar, four-tab bottom nav, home indicator, decorative card sizing. Most of the inner content is shared too. **What's specific to the clients-page version of the phone is just the hero copy and the section ordering.** Reuse `pages/dashboard/components/phone-preview.md` where the markup is identical and only document the deltas here.

## Source

- **JSX:** `Paperwork Monsters Clients.html` lines **4355–4486**
- **CSS:** Clients.html — `.phone*`, `.phero*`, `.pkpi*`, `.pjob*`, `.psection-*`, `.ptab*`, `.home-indicator` (interleaved with the dashboard CSS in lines ~1100–1700; identical to the dashboard prototype's phone styles, copy not duplicated here)

## What's shared with the dashboard's `<Phone>`

All of the following come from `pages/dashboard/components/phone-preview.md` and render identically:

- The phone shell (`.phone`, `.phone__screen`, `.phone__notch`, `.phone__status`)
- The top greeting ("Hey, Diego 👋") (`.phone__top`)
- The bottom tab bar (Home / send / Money / More) (`.ptabs`, `.ptab`, `.ptab--active`, `.ptab--text`)
- The home indicator (`.home-indicator`)
- The `<Phone />` component name itself

## What's specific to this page's `<Phone />`

### Hero copy

The hero (`.phero`) carries different copy than the dashboard's:

```jsx
<div className="phero">
  <div className="phero__decor"/>
  <div className="phero__win-chip">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.39 7.36H22l-6.18 4.49L18.21 22 12 17.27 5.79 22l2.39-8.15L2 9.36h7.61z"/></svg>
    2 wins today
  </div>
  <h2 className="phero__title">2 quotes <em>just got accepted</em>.</h2>
  <p className="phero__sub">Send a fresh one — text us the details and we'll handle it.</p>
  <a className="phero__cta" href="Paperwork Monsters Assistant.html" style={{textDecoration:'none'}}>
    <I d={ICN.crown} size={14}/> My assistant
  </a>
</div>
```

The differences vs the dashboard hero:
- Win-chip says "2 wins today" (not "2 quotes accepted today" or whatever the dashboard's hero shows)
- Title says "2 quotes *just got accepted*" — past-tense celebration framing
- CTA goes to `My assistant` — links across to the assistant page (in production: `<a href="/assistant">`)

### KPI tiles

Identical to the dashboard's pkpis:

```jsx
<div className="pkpis">
  <div className="pkpi">
    <div className="pkpi__label">Active jobs</div>
    <div className="pkpi__val">7</div>
    <div className="pkpi__sub"><strong>▲ 2</strong> this week</div>
  </div>
  <div className="pkpi" style={{background: 'linear-gradient(165deg, var(--pink-50), #fff)'}}>
    <div className="pkpi__label">Money owed</div>
    <div className="pkpi__val">$6,420</div>
    <div className="pkpi__sub" style={{color:'var(--pink-700)'}}>1 invoice overdue</div>
  </div>
  <div className="pkpi">
    <div className="pkpi__label">Quotes out</div>
    <div className="pkpi__val">4</div>
    <div className="pkpi__sub">$12.8k in flight</div>
  </div>
  <div className="pkpi">
    <div className="pkpi__label">This month</div>
    <div className="pkpi__val">$18.4k</div>
    <div className="pkpi__sub"><strong>▲ 24%</strong> vs Mar</div>
  </div>
</div>
```

### Section: Money owed to you

Three rows in a `.pcard`. Each row is a `.pjob` with name + meta + amount, where the meta line's colour codes the urgency:

- Hilltop Diner — pink, "11 days overdue · #INV-204" — $1,160
- Sarah Chen — coffee, "Due in 3 days · #INV-208" — $1,920
- Maple Grove Apts. — green, "Due Apr 30 · #INV-210" — $3,340

```jsx
<div className="psection-head">
  <h3 className="psection-title">Money owed to you</h3>
  <span className="psection-link">All →</span>
</div>
<div className="pcard" style={{padding:'4px 14px'}}>
  <div className="pjob" style={{gridTemplateColumns:'1fr auto'}}>
    <div>
      <h4 className="pjob__title">Hilltop Diner</h4>
      <div className="pjob__meta" style={{color:'var(--pink-700)', fontWeight:700}}>11 days overdue · #INV-204</div>
    </div>
    <div className="pjob__amt">$1,160</div>
  </div>
  {/* Sarah Chen row, Maple Grove Apts row… */}
</div>
```

### Section: Quotes waiting

Reuses the desktop dashboard's `QUOTES` array (Clients.html doesn't redefine it — it imports the same one inline at line 3785). Renders the first 2 items as `.pjob` rows. The hot indicator ("Viewed twice 🔥") swaps to green + bold; otherwise the meta is muted with the relative "Sent" text.

```jsx
<div className="psection-head">
  <h3 className="psection-title">Quotes waiting</h3>
  <span className="psection-link">4 out →</span>
</div>
<div className="pcard" style={{padding:'4px 14px'}}>
  {QUOTES.slice(0,2).map((q, i) => (
    <div className="pjob" key={i} style={{gridTemplateColumns:'1fr auto'}}>
      <div>
        <h4 className="pjob__title">{q.client}</h4>
        <div className="pjob__meta">
          {q.desc} · <span style={{color: q.hot ? 'var(--brand-green)':'var(--fg-muted)',
                                   fontWeight: q.hot?700:500}}>
            {q.hot ? 'Viewed twice 🔥' : q.sent.replace('Sent ','')}
          </span>
        </div>
      </div>
      <div className="pjob__amt">{q.amt}</div>
    </div>
  ))}
</div>
```

## Preact / Fresh translation

This component is **not** part of the production component library. The desktop `/clients` route does not render it. On real mobile, the production responsive layout of `/clients` replaces this — they're never both rendered.

If documentation or a Storybook entry is needed for the iOS app analog, a static `<PhoneClients />` can live under `v2/frontend/components/_design/PhoneClients.tsx` (an internal-only path), built from the dashboard's `<Phone />` plus the three deltas above.

```tsx
// v2/frontend/components/_design/PhoneClients.tsx — DOCUMENTATION ONLY
// Mirrors the prototype's Clients.html <Phone> for design reference.
// Do not import from production routes.
import { PhoneShell } from "./PhoneShell.tsx";
import * as I from "../ui/icons.tsx";

export function PhoneClients() {
  return (
    <PhoneShell>
      <div class="phero">
        <div class="phero__decor" />
        <div class="phero__win-chip">
          <I.Star size={11} /> 2 wins today
        </div>
        <h2 class="phero__title">2 quotes <em>just got accepted</em>.</h2>
        <p class="phero__sub">Send a fresh one — text us the details and we'll handle it.</p>
        <a class="phero__cta" href="/assistant" style={{ textDecoration: 'none' }}>
          <I.Crown size={14} /> My assistant
        </a>
      </div>
      {/* …pkpis, money-owed section, quotes-waiting section as above… */}
    </PhoneShell>
  );
}
```

## Props

None. The component is fully static for the prototype. In a real app, content would mirror the same hero/KPIs/section data the responsive `/dashboard` and `/clients` routes render.

## Data source

In production, the iOS app analog is the **actual mobile responsive layout** of `/dashboard` and `/clients`, not a re-implementation. Every section here pulls from the same backend endpoints documented in `pages/dashboard/root.md`:

- `/profile` for the greeting
- `/analytics/dashboard` for the KPIs
- `/invoices?status=pending` for "Money owed to you"
- `/quotes?status=sent` for "Quotes waiting"
- `/notifications` (read for the bell dot)

## Island vs server

**Server.** The mockup has no interactive state (the bottom tabs aren't wired in the prototype).

In a real mobile app, the bottom tab bar is a single navigation island that swaps the current route — but that's well outside the scope of this page documentation.

## Accessibility

The mockup is a static prototype and should be `aria-hidden="true"` if rendered alongside the desktop layout, since it duplicates content the user can already see on the desktop view. Don't double-announce KPIs, money-owed rows, or the hero.

If documenting this in Storybook for designers, ignore SR concerns — it's a visual reference, not a real surface.

## Edge cases

- **Real mobile (<768 px):** do **not** render this mockup. The actual responsive layout of `/clients` takes over and shows the full editorial cards grid (single column) plus the LoopBar and toolbar adapted for narrow viewports. See `root.md` § Mobile breakpoints.
- **Tablet (768–1100 px):** the desktop `/clients` page collapses its right rail (`.cside2` becomes static, `.clay2` becomes one column) — the phone mockup is also hidden at this width via the same media query that hides the dashboard's phone preview.
- **Updating the seed:** if the desktop hero or KPIs change, this mockup's copy should track them. To avoid drift, future iterations should source the phone's content from the same data layer the desktop renders, not from hand-written prototype seeds.
