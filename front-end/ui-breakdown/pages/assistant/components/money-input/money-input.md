# MoneyInput

A hero currency field — Cash-App/Stripe-style type-and-replace amount entry with
a per-digit odometer roll, an aurora-mesh background, mouse-tracked 3D tilt,
quick-amount chips, a log-scale magnitude bar, and a spelled-out value sub-line.
Used inside AsstChat's price-capture screen.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/MoneyInput.tsx`). **Assistant-local** — only
  consumed by AsstChat.
- **Interaction tier:** `island` (client-only, controlled input). No fetch.
- **Client state owned:**
  - `display: string` — the formatted typing string (e.g. `"1,250.00"`).
  - `cents: number | null` — the parsed value in cents (the canonical output).
  - `focused`, `ready` (gates the odometer roll transition until after first
    paint), `stageWidth` (measured via `ResizeObserver` for hero-font
    auto-shrink), `isTouchOnly` (swaps the keyboard-nudge hint for a touch hint).
  - `lang` — `langSignal.value` (the `lang` prop is an ignored SSR seed); drives
    the spelled-out value words + eyebrow/hints.
- **Data source:** none — pure controlled input. Emits via callbacks:
  `onChange(cents | null)` on every change; `onSubmit(cents)` on Enter (when
  `cents > 0`).
- **Liveness:** none.
- **Honest-empty:** with no value the int reads "0" / dec "00" dimmed
  (`is-empty`), the clear button is hidden, and the words line shows a hint
  (keyboard vs touch).
- **Anti-patterns:** none. No reload, no polling. Uses a deprecated-but-fine
  pattern: a transparent `.mi__input` layered over the odometer captures keyboard
  /paste/selection while the odometer renders the visible number (caret hidden,
  type-and-replace UX).
- **Data-shape hazards:**
  - Value is **cents (integer)**, not dollars — the parent must treat the
    callback arg as cents. `parseToCents` clamps decimals to 2 places.
  - Hero font auto-shrinks (clamped 32–88px) based on digit count + measured
    stage width so 11-digit amounts ($99,999,999.99) still fit; relies on the
    `ResizeObserver` firing — verify in narrow mounts.

## 2. Anatomy
```
<style>{STYLES}</style>                                   ← injected inline (see css/money-input.css)
<div class="mi [is-focused] [has-value] [is-ready]" style="--mi-hero:{heroSize}px"
     onMouseMove=tilt onMouseLeave=resetTilt onClick=focusInput>
  <div class="mi__aurora" aria-hidden/>                    ← blurred radial mesh
  <div class="mi__shine" aria-hidden/>                     ← mouse-tracked specular
  <div class="mi__eyebrow">{t eyebrow}</div>
  <div class="mi__stage">
    <span class="mi__glyph">$</span>
    <div class="mi__amount">
      <Odometer class="mi__int" text={intStr||"0"}/>        ← per-digit rolling columns
      <Odometer class="mi__dec" text={decStr||"00"}/>
    </div>
    <input class="mi__input" inputMode=decimal/>            ← transparent, layered, captures input
    <button class="mi__clear">✕</button>                    ← fades in when has-value
  </div>
  <div class="mi__bar"><div class="mi__bar-fill" style="width:{magnitude%}"/></div>   ← log-scale, ref $100M
  <div class="mi__words" key=cents>{words || hint}</div>    ← spelled-out, animates per change
  <div class="mi__chips" role=group>                        ← $50 / $100 / $500 / $1k / $5k presets
    {CHIP_PRESETS_CENTS.map(c => <button class="mi__chip [is-active]">${shortMoney(c)}</button>)}
  </div>
</div>
```
- **Odometer:** each digit cell is a 10-tall column translated `-n*10%`; commas/
  dot are static cells. The roll transition (`460ms`) is gated on `.mi.is-ready`.
- **Sub-components:** `Odometer` + `OdoCell` (local, in the same file).
- **Helpers (local):** `parseToCents`, `formatTyping`, `shortMoney`,
  `centsToWords` / `numToWords` (i18n number-to-words, en + es via `tFor`).

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `initialCents` | number | `0` | number | no |
| `onChange` | `(cents:number\|null)=>void` | `undefined` | (callback → Events) | no |
| `onSubmit` | `(cents:number)=>void` | `undefined` | (callback → Events) | no |
| `autoFocus` | boolean | `undefined` | boolean | no |
| `name` | string | `undefined` | text | no |
| `lang` | `"en"\|"es"` | (ignored) | select | **ignored SSR seed** — reads `langSignal.value` |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| empty | no value — dimmed 0/00 + hint, no clear, no active chip | `cases/empty/empty.json` |
| value | a typed amount (`initialCents=125000` → "$1,250") | `cases/value/value.json` |
| chip-active | a preset selected (`initialCents=100000` → $1k chip active) | `cases/chip-active/chip-active.json` |
| large | 8-digit amount → hero font auto-shrinks | `cases/large/large.json` |
| es | Spanish words line ("mil doscientos cincuenta dólares") | `cases/es/es.json` |

> Isolate note: cases are bare props. `onChange`/`onSubmit` are callbacks →
> assert in Events. The odometer roll only animates after `ready` (1 rAF) — for a
> still capture it settles immediately.

## 5. Events
- `ev.expect(e => e.source === "input.mi__input" && e.type === "input")` →
  reformats, updates `cents`, fires `onChange(cents)`.
- `ev.expect(e => e.source === "input.mi__input" && e.type === "keydown" && e.key === "Enter")`
  → `onSubmit(cents)` when `cents>0`.
- `ev.expect(e => /ArrowUp|ArrowDown/.test(e.key))` → nudge ±$10 (±$100 with
  Shift).
- `ev.expect(e => e.source === "button.mi__chip")` → `setValue(presetCents)` →
  `onChange`.
- `ev.expect(e => e.source === "button.mi__clear")` → resets to null, refocuses.

## 6. Motion (extracted, all in the inline STYLES)
- **Odometer roll:** `.mi.is-ready .odo__col { transition: transform 460ms
  cubic-bezier(.22,.85,.25,1) }` — digit columns slide to the new value.
- **Magnitude bar:** `width` transition `540ms cubic-bezier(.22,.85,.25,1)`.
- **Words line:** `@keyframes mi-words-in` (`opacity 0→1` + `translateY 4px→0`)
  `320ms`, re-keyed per `cents` so it replays on each change.
- **3D tilt:** `transform: perspective(1100px) rotateX/Y(--tilt-x/y)`,
  `280ms`; `--tilt-*` set via JS on mousemove (±3deg), reset on leave.
- **Glyph / clear / chips:** color/scale/shadow transitions (160–280ms).
- **Reduced motion:** NO component-local guard — relies entirely on the GLOBAL
  tokens reduced-motion clamp. Verify the odometer, tilt, bar and words all still
  under reduced-motion (the JS tilt becomes a no-transition snap).

## 7. Responsive
- No `@media`. Self-adapts: `ResizeObserver` measures the card and recomputes
  `stageWidth`, shrinking the hero font for narrow mounts; `isTouchOnly`
  (`matchMedia("(hover:none) and (pointer:coarse)")`) swaps the hint copy.

## 8. A11y
- `aria-label` on the input + clear button; chips in a labeled `role="group"`;
  the aurora/shine/glyph are `aria-hidden`.
- **Gaps:** the visible value is the odometer (decorative spans) while the real
  value lives in a transparent input — AT reads the input's `value`, which is OK,
  but the caret is hidden (`caret-color:transparent`) which can disorient some
  users. Keyboard nudge keys are undiscoverable to AT (only a visual hint).

## 9. Used on
Inside `islands/AsstChat.tsx` only — the price-capture screen (one instance,
`autoFocus` unless price-suggestions are showing; `onChange→setPriceCents`,
`onSubmit→onPriceContinue`). Not mounted directly by any route. CSS is the
island's own inline `STYLES` (no assistant.css entry).
