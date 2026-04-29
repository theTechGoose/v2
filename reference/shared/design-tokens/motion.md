# Motion — easings, durations, keyframes catalog

Source: `extracted/colors_and_type.css` (motion tokens), `extracted/styles.css` (landing keyframes), `extracted/Paperwork Monsters *.html` (per-page inline styles).

## Easings & durations (from token file)

| Token | Value |
|---|---|
| `--ease-bounce` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| `--ease-standard` | `cubic-bezier(0.20, 0.00, 0.00, 1.00)` |
| `--ease-out` | `cubic-bezier(0.00, 0.00, 0.20, 1.00)` |
| `--dur-micro` | 120ms |
| `--dur-fast` | 200ms |
| `--dur-base` | 320ms |

## Keyframes catalog

### Dashboard / shared chrome

#### `tickerPulse` — used by `.topbar__ticker-dot` (live activity bullet)
- 1.6s ease-in-out infinite. Box-shadow ripple, green.
- Defined: every dashboard HTML.
```css
@keyframes tickerPulse {
  0%   { box-shadow: 0 0 0 0 rgba(81,152,67,0.55); }
  70%  { box-shadow: 0 0 0 6px rgba(81,152,67,0); }
  100% { box-shadow: 0 0 0 0 rgba(81,152,67,0); }
}
```

#### `tickerSlideIn` — used by `.topbar__ticker-item` (entry of new line)
- 360ms ease-bounce, runs once on element insert.
```css
@keyframes tickerSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

#### `hbob` — used by `.hero__monster` (hero mascot bob)
- 5.5s ease-in-out infinite, alternates rotate/translate.
```css
@keyframes hbob {
  0%,100% { transform: rotate(-4deg) translateY(0); }
  50%     { transform: rotate(-2deg) translateY(-6px); }
}
```

#### `hotPulse` — used by `.hot-card` ring (hot/important card glow), pink
- 1.6s ease-in-out infinite, pink box-shadow ripple.
```css
@keyframes hotPulse {
  0%   { box-shadow: 0 0 0 0 rgba(255,107,107,0.55); }
  70%  { box-shadow: 0 0 0 8px rgba(255,107,107,0); }
  100% { box-shadow: 0 0 0 0 rgba(255,107,107,0); }
}
```

#### `ppulse` — used by `.hero__pulse-dot` (hero greeting status bullet), green
- 2s infinite, larger box-shadow than tickerPulse.
```css
@keyframes ppulse {
  0%   { box-shadow: 0 0 0 0 rgba(81,152,67,0.55); }
  70%  { box-shadow: 0 0 0 10px rgba(81,152,67,0); }
  100% { box-shadow: 0 0 0 0 rgba(81,152,67,0); }
}
```

### Cards (clients/contracts/quotes/invoices/payments)

#### `ccard-in` — used by `.ccard` row entrance
- 0.6s ease-bounce both. Slight Y + scale entry.
```css
@keyframes ccard-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
```

#### `ccard2-editorial-in` — used by `.ccard2` (newer client cards)
- Used in mount transitions on Clients page.
```css
@keyframes ccard2-editorial-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

#### `pulse` — used by `.ph2__crumb-dot` / `.ph__crumb-dot` (page-header status bullet)
- 2.4s infinite. Two slightly different definitions across pages (rgba 0.55 vs 0.6).
```css
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,107,0.55); }
  50%      { box-shadow: 0 0 0 6px rgba(255,107,107,0); }
}
```

#### `pulse-dot` — used by status dots (e.g. `.ccard2__status-dot`)
- 2.4s infinite, opacity-only fade.
```css
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
```

#### `pulse-ring` — used by orbit/halo rings around avatars
- 2s infinite, scale + fade out.
```css
@keyframes pulse-ring {
  0%   { transform: scale(0.8); opacity: 0.6; }
  100% { transform: scale(2.2); opacity: 0; }
}
```

### Landing — global

#### `bob` — used by `.hero-monster` (landing mascot, styles.css)
- 6s implied (consult source); rotate/translate combo.
```css
@keyframes bob {
  0%, 100% { transform: translate(-50%, -50%) rotate(-2deg); }
  50%      { transform: translate(-50%, calc(-50% - 10px)) rotate(2deg); }
}
```

#### `chipFloat` — used by floating chips/labels in landing hero
```css
@keyframes chipFloat {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-8px); }
}
```

#### `twinkle` — used by `.spark.s1/s2/s3` sparkles (3s loop, staggered delays)
```css
@keyframes twinkle {
  0%, 100% { opacity: 0.3; transform: scale(0.6) rotate(0); }
  50%      { opacity: 1; transform: scale(1) rotate(90deg); }
}
```

#### `marquee` — used by `.marquee-track` (horizontal infinite scroll)
```css
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
```

#### `shadowPulse` — used by hero ground shadow
- 4s ease-in-out infinite. Scales horizontal and dims.
```css
@keyframes shadowPulse {
  0%,100% { transform: translateX(-50%) scaleX(1); opacity: .5; }
  50%     { transform: translateX(-50%) scaleX(0.85); opacity: .35; }
}
```

#### `spinSlow` — used by `.hero-ring` orbital dotted rings
- 36s linear infinite (r2 ring: 50s reverse).
```css
@keyframes spinSlow { to { transform: rotate(360deg); } }
```

#### `typingBounce` — used by `.typing span` chat-typing dots (styles.css + Landing)
- 0.2s/0.4s staggered delays.
```css
@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30%           { transform: translateY(-4px); opacity: 1; }
}
```

### Landing — hero phone (`.hs-phone`)

#### `blobDrift` — used by `.hs-blob` ambient backdrop blobs
- 14–16s ease-in-out infinite, alternate (`-4s reverse` for the second blob).
```css
@keyframes blobDrift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(20px, -16px) scale(1.06); }
}
```

#### `phoneFloat` — used by `.hs-phone` (smartphone hero element)
- 6s ease-in-out infinite. Translate Y while preserving rotate(-3deg).
```css
@keyframes phoneFloat {
  0%, 100% { transform: translateX(-50%) rotate(-3deg) translateY(0); }
  50%      { transform: translateX(-50%) rotate(-3deg) translateY(-10px); }
}
```

#### `docFloat` — used by `.hs-doc` (floating "doc" beside phone)
- 6s ease-in-out -3s infinite (offset start).
```css
@keyframes docFloat {
  0%, 100% { transform: rotate(5deg) translateY(0); }
  50%      { transform: rotate(5deg) translateY(-8px); }
}
```

#### `badgeFloat` — used by `.hs-badge` (floating "trusted by" badges)
- 5s ease-in-out -2s infinite.
```css
@keyframes badgeFloat {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-8px); }
}
```

### Landing — chat / contact-form preview (`.cf-*`)

#### `cfPulse` — used by `.cf-phone__avatar` outer ring
```css
@keyframes cfPulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(81, 152, 67, 0.18); }
  50%      { box-shadow: 0 0 0 6px rgba(81, 152, 67, 0); }
}
```

#### `cfDot` — used by `.cf-typing i` (chat reply typing dots)
```css
@keyframes cfDot {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30%           { transform: translateY(-3px); opacity: 1; }
}
```

#### `cfSlideIn` — used by `.cf-bubble--reply` entrance
- 420ms ease-bounce backwards.
```css
@keyframes cfSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

## Quick reference — which pages use which

| Keyframe | Pages |
|---|---|
| `tickerPulse`, `tickerSlideIn` | All dashboard pages (topbar) |
| `hbob` | All dashboard pages (hero mascot/icon) |
| `hotPulse`, `ppulse` | All dashboard pages (hot cards / hero pulse) |
| `ccard-in`, `ccard2-editorial-in` | clients, contracts, invoices, quotes, payments |
| `pulse`, `pulse-dot`, `pulse-ring` | clients, contracts, invoices, quotes, payments |
| `bob`, `chipFloat`, `shadowPulse`, `spinSlow` | landing (styles.css) |
| `twinkle`, `marquee`, `typingBounce` | landing (and shared via styles.css) |
| `blobDrift`, `phoneFloat`, `docFloat`, `badgeFloat` | landing (hero phone scene) |
| `cfPulse`, `cfDot`, `cfSlideIn` | landing (contact-form chat preview) |

Reduced-motion is honored globally — see `spacing-radii-shadows.md`.
