# `QSideTip` — Monster tip card

> ✅ **Build in v1 (with hard-coded fallback).** A new `GET /analytics/quotes/insight` endpoint can supply a context-aware tip; until it ships, hard-code a single static tip — the prototype already does.

## Purpose

The third card in the right rail. A single dark-teal gradient panel containing one statistical observation about the contractor's pipeline, written in the monsters' voice. The "tip" is the same interpretive layer the assistant chat uses, surfaced as a small, glanceable insight on the quotes page.

The prototype's tip is hard-coded:

> Quotes opened 3+ times within 24 hours close **78% of the time** when followed up the same day. There's one in your pipeline right now.

That's an industry-statistic + a call to action ("there's one in your pipeline right now") that ties the tip to the contractor's actual data. In production, the call-to-action half should be dynamically derived (e.g. only show "there's one in your pipeline" when at least one quote has `opens >= 3`); the statistic itself can stay editorial.

## Source

- **JSX:** `Paperwork Monsters Quotes.html` lines **5314–5322**
- **CSS:** no dedicated selectors — uses inline styles + the shared `.qside__card`/`.qside__title` from `side-big.md`. The dark gradient is overridden inline.

## JSX (verbatim)

```jsx
const QSideTip = () => (
  <div className="qside__card" style={{background:'linear-gradient(135deg,#1A535C,#0F3A40)',color:'#fff',border:'none'}}>
    <div className="qside__title" style={{color:'#fff',marginBottom:'8px'}}>Monster tip</div>
    <p style={{font:'400 13.5px/1.5 var(--font-body)',color:'rgba(255,255,255,0.85)',margin:0,textWrap:'pretty'}}>
      Quotes opened 3+ times within 24 hours close <strong style={{color:'#FF8D8D'}}>78% of the time</strong> when
      followed up the same day. There's one in your pipeline right now.
    </p>
  </div>
);
```

## CSS

The prototype uses inline styles only. Production should promote them to dedicated classes for maintainability:

```css
.qside__card--tip {
  background: linear-gradient(135deg, #1A535C 0%, #0F3A40 100%);
  color: #fff;
  border: none;
}
.qside__card--tip .qside__title { color: #fff; margin-bottom: 8px; }
.qside__tip-body {
  font: 400 13.5px/1.5 var(--font-body);
  color: rgba(255,255,255,0.85);
  margin: 0;
  text-wrap: pretty;
}
.qside__tip-body strong {
  color: #FF8D8D;
  font-weight: 700;
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/quotes/QSideTip.tsx — server component
import { Fragment } from "preact";

export type Tip = {
  /** The body — may include <strong> for the highlighted stat. */
  body: preact.ComponentChildren;
};

export function QSideTip({ tip }: { tip?: Tip }) {
  const fallback: Tip = {
    body: (
      <Fragment>
        Quotes opened 3+ times within 24 hours close <strong>78% of the time</strong> when
        followed up the same day. There's one in your pipeline right now.
      </Fragment>
    ),
  };
  const t = tip ?? fallback;

  return (
    <div class="qside__card qside__card--tip">
      <div class="qside__title">Monster tip</div>
      <p class="qside__tip-body">{t.body}</p>
    </div>
  );
}
```

## Props

```ts
type Tip = { body: preact.ComponentChildren };

type QSideTipProps = {
  tip?: Tip;       // optional — falls back to a hard-coded default
};
```

## Data source

**v1 fallback:** the hard-coded tip rendered by the prototype.

**Production:** `GET /analytics/quotes/insight` returns one of N pre-written tips, optionally with a dynamic call-to-action half:

```json
{
  "templateId": "opened-3-plus-fast-followup",
  "stat":       { "value": 78, "unit": "%", "label": "of the time" },
  "lead":       "Quotes opened 3+ times within 24 hours close",
  "trail":      "when followed up the same day.",
  "callout":    { "kind": "match-count", "thresholdField": "opens", "threshold": 3, "actual": 1 }
}
```

The frontend renders the lead + stat + trail, then conditionally renders the callout sentence based on `callout.actual`:

| `callout.actual` | Sentence |
|---|---|
| 0 | (omit the callout — don't show a "you have 0" line) |
| 1 | "There's **one** in your pipeline right now." |
| ≥ 2 | "There are **{actual}** in your pipeline right now." |

A small library of templates (~10) keyed by stage / pipeline shape covers most contractor states. Rotate weekly so the tip feels fresh.

## Island vs server

**Server.** Static.

## Accessibility

- White-on-dark-teal contrast at 4.5:1 ≥ pass for the muted body text (`rgba(255,255,255,0.85)`). The pink stat number (`#FF8D8D`) on dark teal — verify ≥ 4.5:1 (it sits around 5.1:1, passes).
- The `<strong>` carries semantic emphasis; SRs read with default emphasis. Don't use `<b>` (purely visual).
- This is informational content — no headings or interactive elements needed. The "Monster tip" eyebrow is technically an `h3` candidate (since `<QSideBig>` and `<QSideRate>` headings are at the same level), but the prototype renders it as a styled `<div>`. Production should use `<h3 class="qside__title">` consistently across all three side-cards for SR navigation.

## Edge cases

- **No callout sentence (zero matches):** the body is just the stat and explanation. Reads cleanly.
- **Tip endpoint fails / returns 500:** fall back to the hard-coded default. Don't show a broken card.
- **Two tips are equally relevant:** server-side tie-break is fine (newest > oldest, or alphabetical). Don't try to A/B in the frontend.
- **Localisation:** the tip text is brand-voice English. When ES is added, localise template IDs server-side and let the frontend render whatever locale string comes back. Don't try to interpolate at render time.
- **Reduced motion:** no animations defined; nothing to disable.
