# `Hero` — Dashboard hero panel

## Purpose

Top-of-content panel: large headline ("You've billed $18,420 this month."), supporting copy, three pill stats (`▲ 24% vs March`, `$4,180 ahead`, `4 quotes awaiting signature`), and a single CTA button to "/assistant" (linking to the AI agent chat). Right side has decorative confetti, a soft blob, and the monster character image. The dollar amount uses the `<Ticker>` component for an easing animation from 0 → target on mount.

## Source

- JSX: `Paperwork Monsters Dashboard.html` lines **2398–2432**
- Inline CSS: Dashboard.html — search `.hero`, `.hero__copy`, `.hero__title`, `.hero__sub`, `.hero__stats`, `.hero__cta-row`, `.hero__art`, `.hero__confetti`, `.hero__monster`, `.hero__art-blob`, `.btn--quote`, `.btn__lightning`

## JSX (verbatim)

```jsx
const Hero = () => {
  const spark = [22, 28, 26, 34, 32, 40, 38, 46, 50, 48, 58, 62];
  return (
    <section className="hero">
      <div className="hero__copy">
        <h1 className="hero__title">
          You've billed <em>$<Ticker value={18420}/></em> this month.<br/>
          Let's get those quotes out the door.
        </h1>
        <p className="hero__sub">
          4 quotes are sitting with clients. Send a nudge, or fire off a fresh one straight from a text.
        </p>
        <div className="hero__stats">
          <span className="hero__stat"><strong>▲ 24%</strong> vs March</span>
          <span className="hero__stat"><strong>$4,180</strong> ahead of last month</span>
          <span className="hero__stat hero__stat--pink"><strong>4 quotes</strong> awaiting signature</span>
        </div>
        <div className="hero__cta-row" style={{marginTop:18}}>
          <a className="btn btn--quote" href="Paperwork Monsters Assistant.html"
             style={{textDecoration:'none'}}>
            <span className="btn__lightning"><I d={ICN.crown} size={14}/></span>
            My assistant
          </a>
        </div>
      </div>
      <div className="hero__art">
        <span className="hero__confetti hero__confetti--1"/>
        <span className="hero__confetti hero__confetti--2"/>
        <span className="hero__confetti hero__confetti--3"/>
        <div className="hero__art-blob"/>
        <img src={window.LOGO_DATA_URL} alt="" className="hero__monster"/>
      </div>
    </section>
  );
};
```

The `const spark = [22, 28, …, 62]` array is **defined but unused** in this build of `Hero`. Carry it over to the analytics dashboard or drop entirely.

## `<Ticker>` (verbatim — `Dashboard.html:2322–2343`)

```jsx
const useTicker = (target, duration = 1400) => {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
};

const Ticker = ({ value, prefix = '' }) => {
  const v = useTicker(value);
  return <>{prefix}{v.toLocaleString('en-US')}</>;
};
```

## CSS (key rules — read inline `<style>` for the exact set)

```css
.hero {
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: 1fr 240px;
  gap: 24px; align-items: center;
  background: linear-gradient(135deg, var(--mint-100) 0%, var(--mint-200) 100%);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 28px 32px;
  margin-bottom: 16px;
}
.hero__title {
  font-family: var(--font-heading); font-weight: 800;
  font-size: clamp(22px, 2.4vw, 28px);
  line-height: 1.2; letter-spacing: -0.02em;
  color: var(--brand-teal); margin: 0 0 10px;
}
.hero__title em { font-style: normal; color: var(--brand-pink); }

.hero__sub {
  font-size: 14px; line-height: 1.55; color: var(--fg-muted);
  margin: 0 0 14px; max-width: 520px;
}

.hero__stats { display: flex; flex-wrap: wrap; gap: 8px; }
.hero__stat {
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(255,255,255,0.7); backdrop-filter: blur(6px);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 12px;
  font-family: var(--font-body); font-size: 12px;
  color: var(--fg-muted);
}
.hero__stat strong { font-family: var(--font-heading); font-weight: 800;
                     color: var(--brand-green); }
.hero__stat--pink strong { color: var(--brand-pink); }

.btn--quote {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--brand-teal); color: #fff;
  padding: 10px 16px; border-radius: 12px;
  font-family: var(--font-heading); font-weight: 800; font-size: 13px;
  border: 0; cursor: pointer;
  transition: all 200ms var(--ease-bounce);
  box-shadow: 0 6px 14px rgba(26,83,92,0.32);
}
.btn--quote:hover { transform: translateY(-1px); }
.btn__lightning {
  width: 22px; height: 22px; border-radius: 6px;
  background: linear-gradient(135deg, var(--brand-pink), var(--pink-600));
  color: #fff; display: flex; align-items: center; justify-content: center;
}

/* art column ---------------------------------------------- */
.hero__art       { position: relative; height: 140px; }
.hero__art-blob  { position: absolute; inset: 10px;
                   background: radial-gradient(circle at 50% 50%, rgba(255,107,107,0.18) 0%, transparent 70%);
                   border-radius: 50%; }
.hero__monster   { position: absolute; left: 50%; top: 50%;
                   transform: translate(-50%, -50%);
                   width: 120px; height: 120px; }
.hero__confetti       { position: absolute; width: 8px; height: 8px;
                        border-radius: 2px; opacity: 0.7; }
.hero__confetti--1    { top: 10px; left: 30%;  background: var(--brand-pink); }
.hero__confetti--2    { bottom: 20px; right: 10%; background: var(--brand-green); }
.hero__confetti--3    { top: 60%; left: 8%; background: var(--coffee-500); }
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/dashboard/Hero.tsx — server component (most of it)
// + v2/frontend/islands/Ticker.tsx — island (animation only)

import { Ticker } from "../../islands/Ticker.tsx";
import * as I from "../ui/icons.tsx";

type HeroProps = {
  billedThisMonth: number;          // 18420
  monthOverMonthPct: number;        // 24
  aheadOfLastMonth: number;         // 4180
  quotesAwaiting: number;           // 4
};

export function Hero(props: HeroProps) {
  return (
    <section class="hero">
      <div class="hero__copy">
        <h1 class="hero__title">
          You've billed <em>$<Ticker value={props.billedThisMonth} /></em> this month.<br />
          Let's get those quotes out the door.
        </h1>
        <p class="hero__sub">
          {props.quotesAwaiting} quotes are sitting with clients. Send a nudge, or fire off a fresh one straight from a text.
        </p>
        <div class="hero__stats">
          <span class="hero__stat"><strong>▲ {props.monthOverMonthPct}%</strong> vs last month</span>
          <span class="hero__stat"><strong>${props.aheadOfLastMonth.toLocaleString('en-US')}</strong> ahead of last month</span>
          <span class="hero__stat hero__stat--pink"><strong>{props.quotesAwaiting} quotes</strong> awaiting signature</span>
        </div>
        <div class="hero__cta-row" style="margin-top:18px">
          <a class="btn btn--quote" href="/assistant">
            <span class="btn__lightning"><I.Crown size={14} /></span>
            My assistant
          </a>
        </div>
      </div>
      <div class="hero__art" aria-hidden="true">
        <span class="hero__confetti hero__confetti--1" />
        <span class="hero__confetti hero__confetti--2" />
        <span class="hero__confetti hero__confetti--3" />
        <div class="hero__art-blob" />
        <img src="/logo-monster.png" alt="" class="hero__monster" />
      </div>
    </section>
  );
}
```

```tsx
// v2/frontend/islands/Ticker.tsx
import { useEffect, useState } from "preact/hooks";

export function Ticker({ value, duration = 1400, prefix = '' }: { value: number; duration?: number; prefix?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{prefix}{v.toLocaleString('en-US')}</>;
}
```

## Props

See `HeroProps` above.

## Data source

All four numeric props come from `GET /analytics/dashboard` (see `backend.md` §3.D):
- `billedThisMonth` ← `revenue.lastMonth` (rename or compute MTD if needed)
- `monthOverMonthPct` ← `revenue.monthOverMonthPct`
- `aheadOfLastMonth` ← `revenue.lastMonth - prevMonthRevenue` (compute server-side or add to DTO)
- `quotesAwaiting` ← `quotes.sent` (status === 'sent')

## Island vs server

- `Hero` itself: **server component** (renders with `Hero({ ... })` from server-fetched stats)
- `Ticker`: **island** (RAF + state)

## Accessibility

- `<h1>` is the page title — owned by Hero. Don't put another `<h1>` on the page.
- `Ticker` should set `aria-live="off"` (or use `aria-hidden="true"` on the parent and provide a static `<span class="sr-only">$18,420</span>` sibling) — otherwise SR announces every tick.
- `.hero__art` is decoration → `aria-hidden="true"`.
- The `<em>$18,420</em>` inside the `<h1>` is purely visual (pink color); no semantic emphasis. Acceptable.
- Ensure the CTA's text "My assistant" is descriptive enough; consider `aria-label="Open AI assistant"` if users find it ambiguous.

## Edge cases

- **`billedThisMonth === 0`:** the headline reads "You've billed $0 this month." Replace with a friendlier "Let's get your first invoice out!" copy variant.
- **`monthOverMonthPct < 0`:** swap the `▲` for `▼`, swap green for pink. Add a `delta-down` modifier class.
- **First-time user:** all four numbers are 0 — render an onboarding variant pointing at the `/assistant` CTA with a different sub-headline.
- **Number too large:** `$1,234,567` fits but `$12,345,678` doesn't. Use `clamp()` on the title font-size and/or shorten with `Intl.NumberFormat('en-US', { notation: 'compact' })` for >$100k.
- **Reduced motion:** the Ticker animation should freeze and render the final value immediately (`if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(value); return; }`).
- **Confetti & blob:** purely decorative; on mobile they can be hidden to save space.
