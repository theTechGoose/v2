# Design tokens — "Sabor Design System"

Source of truth: `static/_proto/colors_and_type.css` (copied verbatim to
`assets/tokens-source.css`). Tokens are CSS custom properties declared on
`:root`; the whole app surface consumes them via semantic classes defined in
the per-feature CSS files (`static/dashboard.css`, `quotes.css`, …).

**Theme variants: none.** There is exactly one theme (light). No
`[data-theme]`, no `prefers-color-scheme`, no `.dark` block exists anywhere in
`static/*.css`. Do not scaffold a dark mode — it was never designed.

**Two surfaces, two palettes.** The *authenticated app* and *marketing/auth*
pages use the Sabor tokens below. The *public customer-facing* pages
(`/q /c /co /i`) are rendered with **hard-coded inline-style hex values**, not
tokens — a deliberately separate, document-like palette (see
[§ Public surface palette](#public-surface-palette)). Keep them distinct when
rebuilding; do not "tokenize" the public pages against Sabor or their look
shifts.

---

## Palette

### Brand anchors
| Token | Hex | Role |
|---|---|---|
| `--brand-mint` | `#f7fff7` | Mint Cream — app surface / `--bg` |
| `--brand-pink` | `#ff6b6b` | Grapefruit — accent |
| `--brand-teal` | `#1a535c` | Dark Teal — primary text `--fg` |
| `--brand-green` | `#519843` | Medium Jungle — **primary action** |
| `--brand-coffee` | `#644536` | Coffee Bean — neutral / shadow tint |

### Tonal scales (derived)
- **pink**: `50 #fff1f1 · 100 #ffd9d9 · 200 #ffb3b3 · 300 #ff8d8d · 400 #ff7a7a · 500 #ff6b6b · 600 #fa5252 · 700 #e03131 · 800 #c92a2a`
- **teal**: `50 #e8f1f2 · 100 #c8dde0 · 200 #8fbabf · 300 #56969e · 400 #2d737c · 500 #1a535c · 600 #144048 · 700 #0f3036 · 800 #0a2024`
- **green**: `50 #ecf5e9 · 100 #cfe5c8 · 200 #a5cd98 · 300 #7bb568 · 400 #5fa34f · 500 #519843 · 600 #427a37 · 700 #335d2a`
- **coffee**: `50 #f2ebe8 · 100 #dbc9c2 · 200 #b89d90 · 300 #94715f · 400 #785544 · 500 #644536 · 600 #4f362a · 700 #3a271f`
- **mint** (surface): `50 #fcfffc · 100 #f7fff7 · 200 #ecf6ec · 300 #ddebdd`

### Semantic colors
| Token | Value | |
|---|---|---|
| `--bg` | `var(--brand-mint)` | page background |
| `--bg-alt` / `--bg-raised` | `#ffffff` | cards / raised surfaces |
| `--bg-sunken` | `var(--mint-200)` `#ecf6ec` | wells, insets |
| `--bg-overlay` | `rgba(100,69,54,.40)` | modal scrim (coffee 40%) |
| `--fg` | `var(--brand-teal)` | body text |
| `--fg-strong` | `var(--teal-700)` `#0f3036` | headings |
| `--fg-muted` | `rgba(26,83,92,.72)` | secondary text |
| `--fg-subtle` | `rgba(26,83,92,.55)` | tertiary text |
| `--fg-on-primary` / `--fg-on-accent` | `#ffffff` | text on green/pink |
| `--border` | `rgba(100,69,54,.16)` | hairline (coffee 16%) |
| `--border-strong` | `rgba(100,69,54,.32)` | emphasized border |
| `--border-focus` | `var(--brand-green)` | focus ring color |
| `--primary` | `var(--brand-green)` `#519843` | primary button |
| `--primary-hover` | `var(--green-600)` `#427a37` | |
| `--primary-press` | `var(--green-700)` `#335d2a` | |
| `--secondary` | `var(--brand-teal)` | |
| `--accent` | `var(--brand-pink)` | |
| `--neutral` | `var(--brand-coffee)` | |
| `--success` / `--success-bg` | `#519843` / `var(--green-50)` | |
| `--warning` / `--warning-bg` | `#e8a33d` / `#fff6e5` | |
| `--danger` / `--danger-bg` | `var(--pink-700)` `#e03131` / `var(--pink-50)` | |
| `--info` / `--info-bg` | `var(--brand-teal)` / `var(--teal-50)` | |

---

## Typography
- **Fonts** (Google Fonts CDN `@import`): `--font-heading` = **Nunito** (400–800),
  `--font-body` = **Inter** (400–700), `--font-mono` = ui-monospace stack.
  To self-host: drop variable TTFs in `./fonts/` and swap the `@import` for
  `@font-face`.
- **Type scale**: `--type-display 56px · --type-h1 40px · --type-h2 32px ·
  --type-h3 24px · --type-h4 20px · --type-body 16px · --type-small 14px ·
  --type-micro 12px`.
- **Line heights**: `--lh-display 1.05 · --lh-tight 1.15 · --lh-snug 1.30 ·
  --lh-body 1.55`.
- **Tracking**: `--track-tight -0.01em · --track-normal 0 · --track-loose 0.08em`.
- **Weights**: `--w-regular 400 · --w-medium 500 · --w-semibold 600 ·
  --w-bold 700 · --w-extra 800`.
- Heading utility classes (`.h1`–`.h4`, `.ds-display`) use Nunito + extra/bold
  weight + tight tracking + `text-wrap: balance`. Body (`.body`/`p`),
  `.small`, `.micro` use Inter. `.eyebrow` = Nunito bold micro, uppercase,
  `--track-loose`, colored `--brand-green`.

## Spacing — 8pt soft grid
`--space-1 4 · -2 8 · -3 12 · -4 16 · -5 24 · -6 32 · -7 48 · -8 64 · -9 96` (px).

## Radii
`--radius-sm 8 · -md 12 · -lg 16 · -xl 24 · -2xl 32 · -pill 999` (px).

## Shadows (warm, coffee-tinted)
- `--shadow-sm`: `0 1px 2px rgba(100,69,54,.06), 0 1px 3px rgba(100,69,54,.04)`
- `--shadow-md`: `0 4px 8px rgba(100,69,54,.08), 0 2px 4px rgba(100,69,54,.04)`
- `--shadow-lg`: `0 12px 24px rgba(100,69,54,.10), 0 4px 8px rgba(100,69,54,.06)`
- `--shadow-xl`: `0 24px 48px rgba(100,69,54,.12), 0 8px 16px rgba(100,69,54,.06)`
- `--shadow-focus`: `0 0 0 4px rgba(81,152,67,.24)` (green focus ring)

## Motion
- Easings: `--ease-bounce cubic-bezier(.34,1.56,.64,1)` ·
  `--ease-standard cubic-bezier(.2,0,0,1)` · `--ease-out cubic-bezier(0,0,.2,1)`.
- Durations: `--dur-micro 120ms · --dur-fast 200ms · --dur-base 320ms`.
- **Reduced motion**: global `@media (prefers-reduced-motion: reduce)` clamps
  every `animation-duration`/`transition-duration` to `0.01ms !important`
  (in tokens CSS). `static/_proto/styles.css` also forces `scroll-behavior:auto`.
  Feature CSS files add their own reduced-motion blocks (assistant ×4,
  assistant-page ×5, dashboard ×2, landing ×3, verify ×1) — **the rebuild must
  preserve reduced-motion in every animated component.**

## Layout
`--container-marketing 1200px · --container-product 1280px · --sidebar-w 240px`.
`.container` = `max-width:1200px; margin:0 auto; padding:0 clamp(20px,5vw,56px)`.

## Breakpoints (measured from real `@media` queries in `static/*.css`)
The product surface keys off three breakpoints; the rest are page-specific.
| Width | Meaning (most-used) |
|---|---|
| **720px** | primary mobile cutover (most common: 8 queries) — sidebar→drawer, stacked layouts |
| **980px** | tablet / two-pane collapse (7 queries) |
| **1280px** | `--container-product` max width (5 queries) |
| 1200px | `--container-marketing` (landing) |
| others | 480, 560, 640/641, 700, 760, 768, 880, 1024, 1100/1099, 1201, 1400 — confirm per page against that page's CSS |

Always re-shoot/verify a component at *its own* CSS's breakpoints, not these
defaults blindly.

---

## Public surface palette
The public pages (`routes/q|c|co|i/[id].tsx` and the `Public*` islands) are
**not tokenized** — they use inline-style hex literals to read like a printed
document. Recurring values observed:
| Hex | Role |
|---|---|
| `#f7f6f1` | warm paper page background |
| `#ffffff` | card |
| `#1c2c30` | body text |
| `#144852` | headings / strong (a deeper teal than app `--fg`) |
| `#519843` | accent / eyebrow / bullets (shared with app green) |
| `#6b7a7e` | muted text |
| `#4a5a5e` | secondary text |
| `#e3e8e6` | hairline divider |
| `#b9c1bf` | footer/"powered by" subtle |
| `#a83b3b` | declined/danger badge text |
| Font | system stack `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto…` (NOT Nunito/Inter), with `'Helvetica Neue'` for the money/hero numerals |
| Card radius | `18px`; total-band radius `14px`; shadow `0 8px 32px rgba(20,72,82,.08)` |

These pages still load `/landing.css` for resets, but their components are
inline-styled. Rebuild them as their own primitive set; do not map to Sabor.

---

## Tailwind 4 `@theme` mapping (rebuild target)

Fresh 2 ships Tailwind 4 (CSS-first). Emit a single `@theme` block of custom
properties — **not** a `tailwind.config.js`. Mapping (representative; mirror the
full token list above 1:1):

```css
@theme {
  /* color — name them so utilities read naturally: bg-surface, text-fg, etc. */
  --color-surface: #f7fff7;          /* --brand-mint / --bg */
  --color-surface-raised: #ffffff;
  --color-surface-sunken: #ecf6ec;   /* mint-200 */
  --color-fg: #1a535c;               /* brand-teal */
  --color-fg-strong: #0f3036;        /* teal-700 */
  --color-fg-muted: rgba(26,83,92,.72);
  --color-fg-subtle: rgba(26,83,92,.55);
  --color-primary: #519843;          /* green-500 */
  --color-primary-hover: #427a37;    /* green-600 */
  --color-primary-press: #335d2a;    /* green-700 */
  --color-accent: #ff6b6b;           /* pink-500 */
  --color-neutral: #644536;          /* coffee-500 */
  --color-danger: #e03131;           /* pink-700 */
  --color-warning: #e8a33d;
  --color-border: rgba(100,69,54,.16);
  /* full pink/teal/green/coffee/mint 50–800 ramps → --color-pink-50 … etc. */

  /* type */
  --font-heading: "Nunito", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
  --text-display: 56px; --text-h1: 40px; --text-h2: 32px; --text-h3: 24px;
  --text-h4: 20px; --text-base: 16px; --text-sm: 14px; --text-xs: 12px;

  /* spacing — Tailwind's --spacing base + named steps, or map 1:1 */
  --spacing-1: 4px; /* … through --spacing-9: 96px */

  /* radius */
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 24px;
  --radius-2xl: 32px; --radius-pill: 999px;

  /* shadow */
  --shadow-sm: 0 1px 2px rgba(100,69,54,.06), 0 1px 3px rgba(100,69,54,.04);
  --shadow-md: 0 4px 8px rgba(100,69,54,.08), 0 2px 4px rgba(100,69,54,.04);
  --shadow-lg: 0 12px 24px rgba(100,69,54,.10), 0 4px 8px rgba(100,69,54,.06);
  --shadow-xl: 0 24px 48px rgba(100,69,54,.12), 0 8px 16px rgba(100,69,54,.06);

  /* motion */
  --ease-bounce: cubic-bezier(.34,1.56,.64,1);
  --ease-standard: cubic-bezier(.2,0,0,1);
  --ease-out: cubic-bezier(0,0,.2,1);

  /* breakpoints */
  --breakpoint-mobile: 720px;
  --breakpoint-tablet: 980px;
  --breakpoint-desktop: 1280px;
}
```

> Note: the *current* app does not use Tailwind utilities — it uses hand-written
> semantic CSS classes (`.btn`, `.card`, `.app`, `.main`, …) per feature file.
> The rebuild can either (a) port those semantic classes into `@layer
> components` backed by these `@theme` tokens, or (b) re-express them as utility
> compositions. Each component spec lists the exact source classes + extracted
> CSS so either path is mechanical.
