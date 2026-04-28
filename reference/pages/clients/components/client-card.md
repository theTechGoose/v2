# `ClientCard` + `ClientsCards` — Editorial mood-card grid

> ✅ **Build in v1 (the centerpiece of the page).** Most of the data the card displays already exists on the v2 `Customer` DTO. The "story" copy is editorial mock data — production must derive it (see §Data source). The expanded contact panel is a v1 inline overlay; once a real `/clients/:id` page exists, replace the overlay with a route navigation.

## Purpose

The 12-card editorial grid that fills the left column of the page. Each card is a moodboard-style micro-page for one client:

- **Mood band** (top, 138 px tall): a custom gradient driven by `moodFor(c)` — `vip` → cool teal, `balance > 0` → pink "owes you", `status === 'active'` → confident green, `status === 'lead'` → coral, `status === 'cold'` → coffee, otherwise a regular sage. The band carries a paper-grain texture (radial gradients), a gigantic "days since last contact" numeric in the bottom-right corner (decorative; opacity scales with how cold the relationship is), a status pill in the top-left, and an optional crown badge in the top-right for `vip: true`.
- **Avatar** (86 × 86 px, `border-radius: 22px`): bleeds across the mood→body boundary. Coloured with the same gradient as the band so it reads as part of the band even though it sits on the card root (so overflow can't clip it).
- **Body**: client name (19 px), `segment · lastWhen` line ("Property mgmt · in progress · today"), and a four-line clamped narrative paragraph ("the story") in the assistant's voice.
- **Foot**: a transparent pink "nudge" button on the left ("Send the warm offer →") and a right-aligned balance read-out (`Balance · $1,920 due` / `$500 credit` / `Settled`).
- **Detail panel**: an absolute-positioned sheet that slides up from inside the card on click. Shows a header with avatar + name + status, three contact rows (phone / email / address — phone and email are real `tel:` and `mailto:` links), and two action buttons (Message / Open card).

Tapping anywhere on the card except the foot button or the panel itself opens the panel. Esc closes. Outside-click closes. Only one card can be open at a time across the grid.

## Source

- **JSX:** `Paperwork Monsters Clients.html`
  - `CLIENTS` data array — lines **3903–3916**
  - `STORIES` editorial copy — lines **3929–3943**
  - `STATUS_LABELS` — line **3927**
  - `moodFor(c)` — lines **4024–4048**
  - `SINCE_DAYS` + `daysSinceContact()` — lines **4050–4065**
  - `SinceBadge` — lines **4067–4081**
  - `ClientCard` — lines **4082–4191**
  - `ClientsCards` (grid + open/close coordinator) — lines **4193–4220**
- **CSS:** Clients.html lines **1748–2079** (`.ccards2`, `.ccard2*`, `.ccard2__panel*`)
  - The `pulse-dot` keyframe at lines 1845–1848 is local to this component family
  - The `ccard2-editorial-in` keyframe at 1764–1767 is defined but never wired up — deletable

## Static seed (verbatim)

```js
const CLIENTS = [
  { name:'Greenleaf HOA',          initials:'GH', segment:'HOA',           band:['#5FA34F','#335D2A'], shadow:'rgba(81,152,67,0.5)',  contact:'board@greenleaf-hoa.org',  phone:'(415) 555-0145', last:'Common area paint',     lastWhen:'quote viewed Tue',     lastTone:'warm', balance: 0,    balanceSub:'settled · quote out $5,800', jobs:'—',  jobsSub:'quote out · $5,800',   status:'regular', temp: 78, vip: true },
  { name:'Maple Grove Apartments', initials:'MG', segment:'Property mgmt', band:['#5FA34F','#427A37'], shadow:'rgba(81,152,67,0.45)', contact:'janet@maplegrove.co',      phone:'(415) 555-0124', last:'Re-roof — building C',  lastWhen:'in progress · today',  lastTone:'hot',  balance: 4200, balanceSub:'progress invoice · due May 5', jobs:'2',  jobsSub:'active',                  status:'active',  temp: 92, vip: true },
  { name:'Cobblestone Cafe',       initials:'CC', segment:'Small biz',     band:['#7BB568','#519843'], shadow:'rgba(81,152,67,0.4)',  contact:'hello@cobblestone.cafe',   phone:'(415) 555-0117', last:'Patio re-tile',         lastWhen:'on track · Apr 30',    lastTone:'hot',  balance: 0,    balanceSub:'settled · deposit on file',     jobs:'1',  jobsSub:'active',                  status:'regular', temp: 71, vip: false },
  { name:'Marshall & Sons',        initials:'MS', segment:'Property mgmt', band:['#785544','#4F362A'], shadow:'rgba(100,69,54,0.4)',  contact:'mike@marshall-sons.com',   phone:'(415) 555-0166', last:'Driveway repour',       lastWhen:'awaiting permit',       lastTone:'warm', balance: -500, balanceSub:'$500 deposit on file',           jobs:'1',  jobsSub:'active',                  status:'active',  temp: 64, vip: false },
  { name:'Sarah Chen',             initials:'SC', segment:'Homeowner',     band:['#FF8D8D','#E03131'], shadow:'rgba(224,49,49,0.4)',  contact:'sarah.chen@gmail.com',     phone:'(415) 555-0188', last:'Bathroom remodel',      lastWhen:'in progress · Wed',    lastTone:'hot',  balance: 1920, balanceSub:'INV-208 · due in 3 days',         jobs:'1',  jobsSub:'active',                  status:'owes',    temp: 58, vip: false },
  // ... 7 more (Hilltop, Tom & Linda, Jana, Marcus, Bayside, Riverside, Ortega)
];
```

(See Clients.html:3903–3916 for the full 12 clients. Don't ship this seed beyond v1 prototyping — replace with `GET /clients`.)

```js
const STATUS_LABELS = { active:'Active job', lead:'Lead', owes:'Owes you', regular:'Regular', cold:'Quiet' };
```

```js
// Story for each client — written in the monsters' voice, one sentence each.
const STORIES = {
  'Greenleaf HOA':          { line:'Eleven jobs since 2022. Margaret peeked at the new paint quote Tuesday — nudge gently, they always say yes by Thursday.', cta:'Send a friendly nudge' },
  'Maple Grove Apartments': { line:'Diego is on building C right now. Janet pays progress invoices the day she gets them — send the next one tonight.',         cta:'Draft progress invoice' },
  'Cobblestone Cafe':       { line:'Patio re-tile lands April 30. Aisha tipped the crew last visit; they\'re not just a customer, they\'re fans.',                cta:'Confirm Wednesday' },
  // ... see Clients.html:3929–3943 for the full set
};
```

## Mood logic — `moodFor(c)` (verbatim)

```js
const moodFor = (c) => {
  // VIP / regular cool greens — premium, established
  if (c.vip) {
    return { from:'#1A535C', to:'#0F3A40', shadow:'rgba(26,83,92,0.35)', statusFg:'#1A535C', label:'On the books' };
  }
  // Past due — pink, but warm not alarming
  if (c.balance > 0) {
    return { from:'#FF6B6B', to:'#D63F3F', shadow:'rgba(255,107,107,0.35)', statusFg:'#B23030', label:'Owes you' };
  }
  // Active job — confident green
  if (c.status === 'active') {
    return { from:'#5FA34F', to:'#3F7A33', shadow:'rgba(81,152,67,0.35)', statusFg:'#3F7A33', label:'Active job' };
  }
  // Hot lead — coral
  if (c.status === 'lead') {
    return { from:'#F7A893', to:'#E8704F', shadow:'rgba(232,112,79,0.35)', statusFg:'#A8431F', label:'New lead' };
  }
  // Quiet — coffee, dignified
  if (c.status === 'cold') {
    return { from:'#9C8074', to:'#5C4034', shadow:'rgba(92,64,52,0.35)', statusFg:'#5C4034', label:'Quiet' };
  }
  // Regular — warm sage
  return { from:'#7FA86F', to:'#4A7039', shadow:'rgba(74,112,57,0.32)', statusFg:'#3F7A33', label:'Regular' };
};
```

**Order matters.** `vip` wins over `owes`, which wins over `active`, which wins over `lead` / `cold`. Don't reshuffle without re-thinking the visual hierarchy — a VIP who currently owes you is still a VIP first.

## Days-since logic

```js
// Hand-curated for the prototype; production reads `c.daysSinceContact` from the DTO.
const SINCE_DAYS = { 'Greenleaf HOA': 2, 'Maple Grove Apartments': 0, /* ... 12 total */ };
const daysSinceContact = (c) => SINCE_DAYS[c.name] ?? 7;

const SinceBadge = ({ days }) => {
  const tier =
    days <= 2  ? 'warm'   :
    days <= 7  ? 'steady' :
    days <= 21 ? 'cool'   : 'cold';
  // Below 30 days: zero-padded numeric ("02"); above: weeks count
  const num = days < 30 ? String(days).padStart(2, '0') : Math.round(days / 7);
  const unit = days < 30 ? (days === 1 ? 'day ago' : 'days ago') : 'weeks ago';
  return (
    <div className={`ccard2__since ccard2__since--${tier}`}>
      <span className="ccard2__since-num">{num}</span>
      <span className="ccard2__since-unit">{unit}</span>
    </div>
  );
};
```

The "tier" controls the band overlay opacity (lower = more visible) so cold relationships scream louder than fresh ones. Inverted from instinct — that's intentional.

## JSX (verbatim — `ClientCard`)

```jsx
const ClientCard = ({ c, idx, isOpen, onOpen, onClose }) => {
  const mood = moodFor(c);
  const story = STORIES[c.name] || { line:'No notes yet — open the card to leave one.', cta:'Open card' };
  const balanceCls = c.balance > 0 ? 'ccard2__bal-val--owe' : c.balance < 0 ? 'ccard2__bal-val--cred' : 'ccard2__bal-val--zero';
  const balanceText = c.balance > 0
    ? `$${c.balance.toLocaleString()} due`
    : c.balance < 0
      ? `$${Math.abs(c.balance).toLocaleString()} credit`
      : 'Settled';
  const open = isOpen;
  const setOpen = (v) => v ? onOpen() : onClose();
  // The address line — synthesize from segment for display purposes
  const address = c.address || (c.segment === 'HOA' ? '422 Greenleaf Way' :
    c.segment === 'Property mgmt' ? `${c.name.split(' ')[0]} property — multiple units` :
    c.segment === 'Small biz' ? `${c.name} — main location` :
    'Home address on file');
  return (
    <div
      className={`ccard2 ${open ? 'ccard2--open' : ''}`}
      style={{
        '--mood-from': mood.from,
        '--mood-to': mood.to,
        '--mood-shadow': mood.shadow,
        '--mood-status': mood.statusFg,
        animationDelay: `${idx * 35}ms`,
      }}
      onClick={(e) => {
        // ignore clicks on the inner foot button or panel itself
        if (e.target.closest('.ccard2__foot') || e.target.closest('.ccard2__panel')) return;
        if (!open) setOpen(true);
      }}
    >
      <div className="ccard2__mood">
        <div className="ccard2__mood-tex"/>
        <SinceBadge days={daysSinceContact(c)}/>
        <div className="ccard2__status">
          <span className="ccard2__status-dot"/> {mood.label}
        </div>
        {c.vip && <div className="ccard2__crown"><I d={ICN.crown} size={13} sw={2.5}/></div>}
      </div>
      <div className="ccard2__av">{c.initials}</div>
      <div className="ccard2__body">
        <h3 className="ccard2__name">{c.name}</h3>
        <div className="ccard2__seg">
          <span>{c.segment}</span>
          <span className="ccard2__seg-dot"/>
          <span>{c.lastWhen}</span>
        </div>
        <p className="ccard2__story">{story.line}</p>
      </div>
      <div className="ccard2__foot">
        <button className="ccard2__nudge">
          {story.cta} <span className="ccard2__nudge-arrow">→</span>
        </button>
        <div className="ccard2__bal-wrap">
          <div className="ccard2__bal-lbl">Balance</div>
          <div className={`ccard2__bal-val ${balanceCls}`}>{balanceText}</div>
        </div>
      </div>

      {/* Detail panel — slides up over the card on click */}
      <div className="ccard2__panel" onClick={(e) => e.stopPropagation()}>
        <div className="ccard2__panel-head">
          <div className="ccard2__panel-av">{c.initials}</div>
          <div style={{minWidth:0, flex:1}}>
            <div className="ccard2__panel-name">{c.name}</div>
            <div className="ccard2__panel-seg">{c.segment} · {mood.label}</div>
          </div>
          <button className="ccard2__panel-x" onClick={() => setOpen(false)} aria-label="Close">
            <I d={ICN.x} size={14} sw={2.5}/>
          </button>
        </div>
        <div className="ccard2__panel-rows">
          <a className="ccard2__panel-row" href={`tel:${c.phone}`}>
            <span className="ccard2__panel-row-icon"><I d={ICN.phone} size={13} sw={2.2}/></span>
            <span className="ccard2__panel-row-text">
              <div className="ccard2__panel-row-lbl">Phone</div>
              <div className="ccard2__panel-row-val">{c.phone}</div>
            </span>
            <span className="ccard2__panel-row-arrow"><I d={ICN.arrow} size={12} sw={2.4}/></span>
          </a>
          <a className="ccard2__panel-row" href={`mailto:${c.contact}`}>
            <span className="ccard2__panel-row-icon"><I d={ICN.mail} size={13} sw={2.2}/></span>
            <span className="ccard2__panel-row-text">
              <div className="ccard2__panel-row-lbl">Email</div>
              <div className="ccard2__panel-row-val">{c.contact}</div>
            </span>
            <span className="ccard2__panel-row-arrow"><I d={ICN.arrow} size={12} sw={2.4}/></span>
          </a>
          <div className="ccard2__panel-row">
            <span className="ccard2__panel-row-icon"><I d={ICN.pin} size={13} sw={2.2}/></span>
            <span className="ccard2__panel-row-text">
              <div className="ccard2__panel-row-lbl">Address</div>
              <div className="ccard2__panel-row-val">{address}</div>
            </span>
            <span className="ccard2__panel-row-arrow"><I d={ICN.arrow} size={12} sw={2.4}/></span>
          </div>
        </div>
        <div className="ccard2__panel-actions">
          <button className="ccard2__panel-act"><I d={ICN.msg} size={12} sw={2.4}/> Message</button>
          <button className="ccard2__panel-act ccard2__panel-act--pink"><I d={ICN.eye} size={12} sw={2.4}/> Open card</button>
        </div>
      </div>
    </div>
  );
};
```

## JSX (verbatim — `ClientsCards`)

```jsx
const ClientsCards = ({ rows }) => {
  const [openId, setOpenId] = React.useState(null);
  React.useEffect(() => {
    if (!openId) return;
    const onDocClick = (e) => {
      if (!e.target.closest('.ccard2')) setOpenId(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpenId(null); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openId]);
  return (
    <div className="ccards2">
      {rows.map((c, i) => (
        <ClientCard
          c={c} idx={i} key={c.name}
          isOpen={openId === c.name}
          onOpen={() => setOpenId(c.name)}
          onClose={() => setOpenId(null)}
        />
      ))}
    </div>
  );
};
```

## CSS (key rules — abridged)

```css
.ccards2 {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.ccard2 {
  position: relative; background: #fff;
  border-radius: var(--radius-xl); overflow: hidden;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(26,83,92,0.04), 0 8px 22px -14px rgba(26,83,92,0.18);
  transition: transform 320ms var(--ease-bounce), box-shadow 320ms var(--ease-out);
  display: flex; flex-direction: column;
}
.ccard2:hover {
  transform: translateY(-4px);
  box-shadow: 0 2px 0 rgba(26,83,92,0.05),
              0 22px 42px -18px var(--mood-shadow, rgba(26,83,92,0.28));
}
.ccard2--open { cursor: default; }
.ccard2--open:hover { transform: none; }

.ccard2__mood {
  position: relative; height: 138px;
  background: linear-gradient(135deg, var(--mood-from) 0%, var(--mood-to) 100%);
}
.ccard2__mood-tex {
  position: absolute; inset: 0; overflow: hidden;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  pointer-events: none;
}
.ccard2__mood-tex::before {
  content: ''; position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 18% 22%, rgba(255,255,255,0.18) 0, transparent 35%),
    radial-gradient(circle at 82% 78%, rgba(0,0,0,0.10) 0, transparent 40%);
}

.ccard2__since {
  position: absolute; bottom: -22px; right: -6px;
  text-align: right; pointer-events: none; user-select: none;
  font-family: var(--font-heading); line-height: 0.85;
  color: rgba(255,255,255,0.18); letter-spacing: -0.03em;
}
.ccard2__since-num  { font-weight: 900; font-size: 96px; display: block; }
.ccard2__since-unit { display: block; font-size: 16px; font-weight: 700;
                      letter-spacing: 0.18em; text-transform: uppercase;
                      margin-top: 4px; opacity: 0.85; }
/* Cold = louder. Warm = quieter so it doesn't compete. */
.ccard2__since--warm   { color: rgba(255,255,255,0.16); }
.ccard2__since--steady { color: rgba(255,255,255,0.22); }
.ccard2__since--cool   { color: rgba(255,255,255,0.32); }
.ccard2__since--cold   { color: rgba(255,255,255,0.45); }

.ccard2__status {
  position: absolute; top: 14px; left: 14px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: var(--radius-pill);
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(4px);
  color: var(--mood-status, var(--brand-teal));
  font-family: var(--font-heading);
  font-size: 10px; font-weight: 800;
  letter-spacing: 0.08em; text-transform: uppercase;
  z-index: 2;
}
.ccard2__status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: currentColor;
  animation: pulse-dot 2.4s infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}

.ccard2__crown {
  position: absolute; top: 14px; right: 14px;
  width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(135deg, #FFD56B, #E8A33D);
  display: grid; place-items: center; color: #5A3D11;
  box-shadow: 0 6px 14px rgba(232,163,61,0.4);
  z-index: 2;
}

/* Avatar bleeds across the mood→body boundary.
   Sits on the CARD (not the mood) so overflow can't clip it. */
.ccard2__av {
  position: absolute; left: 22px; top: 92px;
  width: 86px; height: 86px;
  border-radius: 22px;
  background: linear-gradient(135deg, var(--mood-from) 0%, var(--mood-to) 100%);
  display: grid; place-items: center;
  color: #fff;
  font-family: var(--font-heading);
  font-weight: 800; font-size: 28px;
  letter-spacing: 0.02em;
  z-index: 4;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.28),
              0 12px 24px -8px rgba(0,0,0,0.32);
}

.ccard2__body { padding: 50px 22px 0;          /* top padding clears the crossing avatar */
                flex: 1 1 auto; display: flex; flex-direction: column; }
.ccard2__name { font-family: var(--font-heading); font-weight: 800; font-size: 19px;
                color: var(--brand-teal); letter-spacing: -0.01em; line-height: 1.15;
                margin: 0 0 4px;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccard2__seg  { display: flex; align-items: center; gap: 8px;
                font-size: 12px; color: var(--fg-muted);
                margin-bottom: 14px; }
.ccard2__seg-dot { width: 3px; height: 3px; border-radius: 999px; background: var(--fg-subtle); }

.ccard2__story {
  font-family: var(--font-body);
  font-size: 14.5px; line-height: 1.5;
  color: var(--brand-teal);
  text-wrap: pretty;
  margin: 0;
  /* Fixed story window so foot always lands at the same y across the row.
     4 lines × 1.5 × 14.5px ≈ 87px */
  height: calc(14.5px * 1.5 * 4);
  overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
}

.ccard2__foot {
  margin-top: 18px;
  padding: 14px 22px;
  border-top: 1px solid rgba(26,83,92,0.08);
  display: grid; grid-template-columns: 1fr auto;
  gap: 12px; align-items: center;
}
.ccard2__nudge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0; border: none; background: transparent;
  font-family: var(--font-heading); font-weight: 700; font-size: 12px;
  color: var(--brand-pink);
  cursor: pointer; text-align: left; line-height: 1.3;
  transition: gap var(--dur-fast) var(--ease-out);
}
.ccard2__nudge:hover { gap: 9px; }
.ccard2__nudge-arrow { display: inline-block;
                       transition: transform var(--dur-fast) var(--ease-out); }
.ccard2__nudge:hover .ccard2__nudge-arrow { transform: translateX(2px); }

.ccard2__bal-wrap { text-align: right; }
.ccard2__bal-lbl  { font-family: var(--font-heading);
                    font-size: 9.5px; font-weight: 700;
                    letter-spacing: 0.08em; text-transform: uppercase;
                    color: var(--fg-muted); margin-bottom: 1px; }
.ccard2__bal-val  { font-family: var(--font-heading);
                    font-weight: 800; font-size: 15px;
                    letter-spacing: -0.01em; }
.ccard2__bal-val--owe  { color: var(--pink-700); }
.ccard2__bal-val--cred { color: var(--green-700); }
.ccard2__bal-val--zero { color: var(--brand-teal); }

/* ---- Detail panel ---- */
.ccard2__panel {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, #FFFDF8 0%, #FAF5EB 100%);
  border-radius: var(--radius-xl);
  padding: 22px 22px 18px;
  display: flex; flex-direction: column;
  z-index: 10;
  transform: translateY(8%); opacity: 0; pointer-events: none;
  transition: transform 380ms var(--ease-bounce), opacity 240ms var(--ease-out);
  box-shadow: inset 0 0 0 1px rgba(26,83,92,0.06);
}
.ccard2--open .ccard2__panel {
  transform: translateY(0); opacity: 1; pointer-events: auto;
}
/* …panel-head, panel-rows, panel-actions follow at lines 1982–2079 of the prototype */
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/clients/ClientsCards.tsx — ISLAND
// Holds the open/close coordinator. Each <ClientCard> is a sub-component, not its own island.
import { useEffect, useState } from "preact/hooks";
import { ClientCard, type Client } from "./ClientCard.tsx";

export function ClientsCards({ rows }: { rows: Client[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!openId) return;
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.ccard2')) setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openId]);

  if (rows.length === 0) {
    return (
      <div class="ccards2-empty">
        {/* TODO: empty state — see Edge cases */}
        No clients match these filters. <button type="button">Clear filters</button>
      </div>
    );
  }

  return (
    <div class="ccards2">
      {rows.map((c, i) => (
        <ClientCard
          key={c.id}
          c={c} idx={i}
          isOpen={openId === c.id}
          onOpen={() => setOpenId(c.id)}
          onClose={() => setOpenId(null)}
        />
      ))}
    </div>
  );
}
```

```tsx
// v2/frontend/islands/clients/ClientCard.tsx — sub-component (still part of the cards island)
// Pure rendering except for the click handler that bubbles to ClientsCards.
import * as I from "../../components/ui/icons.tsx";
import { moodFor, type Mood } from "./mood.ts";
import { SinceBadge } from "./SinceBadge.tsx";

export type Client = {
  id:                string;
  name:              string;
  initials:          string;
  segment:           'HOA' | 'Property mgmt' | 'Small biz' | 'Homeowner';
  contact:           string;        // email
  phone:             string;
  address:           string;
  last:              string;        // last job description, e.g. "Bathroom remodel"
  lastWhen:          string;        // formatted, e.g. "in progress · Wed"
  lastTone:          'hot' | 'warm' | 'cold';
  balance:           number;        // > 0 = owes; < 0 = credit; 0 = settled
  balanceSub:        string;
  jobs:              string;        // "—" or count
  jobsSub:           string;
  status:            'active' | 'lead' | 'owes' | 'regular' | 'cold';
  temp:              number;        // 0–100 for sort
  vip:               boolean;
  daysSinceContact:  number;
  story:             { line: string; cta: string };  // from agents module; see Data source
};

export function ClientCard(props: {
  c: Client; idx: number;
  isOpen: boolean; onOpen: () => void; onClose: () => void;
}) {
  const { c, idx, isOpen } = props;
  const mood = moodFor(c);
  const balanceCls = c.balance > 0 ? 'ccard2__bal-val--owe'
                   : c.balance < 0 ? 'ccard2__bal-val--cred'
                   : 'ccard2__bal-val--zero';
  const balanceText = c.balance > 0
    ? `$${c.balance.toLocaleString()} due`
    : c.balance < 0
      ? `$${Math.abs(c.balance).toLocaleString()} credit`
      : 'Settled';

  return (
    <div
      class={`ccard2 ${isOpen ? 'ccard2--open' : ''}`}
      style={{
        '--mood-from':   mood.from,
        '--mood-to':     mood.to,
        '--mood-shadow': mood.shadow,
        '--mood-status': mood.statusFg,
        animationDelay:  `${idx * 35}ms`,
      } as preact.JSX.CSSProperties}
      onClick={(e) => {
        if ((e.target as Element).closest('.ccard2__foot')) return;
        if ((e.target as Element).closest('.ccard2__panel')) return;
        if (!isOpen) props.onOpen();
      }}
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      aria-label={`${c.name} — ${mood.label}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!isOpen) props.onOpen();
        }
      }}
    >
      <div class="ccard2__mood">
        <div class="ccard2__mood-tex" />
        <SinceBadge days={c.daysSinceContact} />
        <div class="ccard2__status">
          <span class="ccard2__status-dot" /> {mood.label}
        </div>
        {c.vip && <div class="ccard2__crown"><I.Crown size={13} sw={2.5} /></div>}
      </div>
      <div class="ccard2__av">{c.initials}</div>

      <div class="ccard2__body">
        <h3 class="ccard2__name">{c.name}</h3>
        <div class="ccard2__seg">
          <span>{c.segment}</span>
          <span class="ccard2__seg-dot" />
          <span>{c.lastWhen}</span>
        </div>
        <p class="ccard2__story">{c.story.line}</p>
      </div>

      <div class="ccard2__foot">
        <button type="button" class="ccard2__nudge">
          {c.story.cta} <span class="ccard2__nudge-arrow">→</span>
        </button>
        <div class="ccard2__bal-wrap">
          <div class="ccard2__bal-lbl">Balance</div>
          <div class={`ccard2__bal-val ${balanceCls}`}>{balanceText}</div>
        </div>
      </div>

      {/* Detail panel */}
      <div class="ccard2__panel" onClick={(e) => e.stopPropagation()}>
        {/* …header + rows + actions — see prototype JSX above */}
      </div>
    </div>
  );
}
```

```ts
// v2/frontend/islands/clients/mood.ts — pure helper; can live server-side too
export type Mood = { from: string; to: string; shadow: string; statusFg: string; label: string };

export function moodFor(c: { vip: boolean; balance: number; status: string }): Mood {
  if (c.vip)              return { from:'#1A535C', to:'#0F3A40', shadow:'rgba(26,83,92,0.35)', statusFg:'#1A535C', label:'On the books' };
  if (c.balance > 0)      return { from:'#FF6B6B', to:'#D63F3F', shadow:'rgba(255,107,107,0.35)', statusFg:'#B23030', label:'Owes you' };
  if (c.status === 'active') return { from:'#5FA34F', to:'#3F7A33', shadow:'rgba(81,152,67,0.35)', statusFg:'#3F7A33', label:'Active job' };
  if (c.status === 'lead')   return { from:'#F7A893', to:'#E8704F', shadow:'rgba(232,112,79,0.35)', statusFg:'#A8431F', label:'New lead' };
  if (c.status === 'cold')   return { from:'#9C8074', to:'#5C4034', shadow:'rgba(92,64,52,0.35)', statusFg:'#5C4034', label:'Quiet' };
  return                       { from:'#7FA86F', to:'#4A7039', shadow:'rgba(74,112,57,0.32)', statusFg:'#3F7A33', label:'Regular' };
}
```

## Props

```ts
type Client = { /* see TS above — id, name, initials, segment, contact, phone, address,
                   last, lastWhen, lastTone, balance, balanceSub, jobs, jobsSub,
                   status, temp, vip, daysSinceContact, story */ };

type ClientCardProps = {
  c:        Client;
  idx:      number;            // grid index, used for `animationDelay`
  isOpen:   boolean;
  onOpen:   () => void;
  onClose:  () => void;
};

type ClientsCardsProps = {
  rows: Client[];              // already filtered + sorted by ClientsToolbar
};
```

## Data source

**v1:** `GET /clients` returns the array shape above. The fields below are **derived** server-side and added to the response — they don't live on the raw `Customer` row:

| Field | Derived from |
|---|---|
| `last` | Most-recent linked entity title (Quote / Contract / Invoice / Job) |
| `lastWhen` | Relative time + state ("in progress · Wed", "quote viewed Tue", "11 days late") |
| `lastTone` | `'hot'` (active job in flight or quote viewed in last 24 h), `'warm'` (open quote, deposit on file, or active scheduled), `'cold'` (no activity ≥ 14 d) |
| `balance` | `Σ pending invoices` − `Σ deposits on file`. Positive = owes; negative = credit |
| `balanceSub` | One-line caption — see prototype seed for examples |
| `jobs`, `jobsSub` | Active job count + state word |
| `status` | Priority pick: `'active'` if any job in flight; `'owes'` if `balance > 0`; `'lead'` if quote out and no contract; `'regular'` if ≥ 2 completed jobs and `daysSinceContact ≤ 30`; `'cold'` if `daysSinceContact > 30`; default `'regular'` |
| `temp` | 0–100 warmth score. Suggested formula: `clamp(100 − daysSinceContact·2 + (status==='active' ? 30 : 0) + (lastTone==='hot' ? 15 : 0) − (balance > 0 ? 10 : 0), 0, 100)` |
| `vip` | Top-quartile by 12-month revenue, OR manually flagged via the contractor's CRM |
| `daysSinceContact` | `today − max(lastAssistantMessage, lastContractStateChange, lastInvoiceStateChange)` |
| `story` | **AI-generated narrative** from the agents module: 1 sentence reading the same data the human reads, plus a 1-action CTA. Until the agents module ships, fall back to a deterministic rule-based caption (see below). Never ship the prototype's editorial `STORIES` map. |

**Deterministic story fallback** (no AI required):

```
balance > 0 && daysLate >= 7 → "INV-### is {daysLate} days late and silence since. Lead with empathy — offer to split it."
                              cta: "Offer the split-pay"

quoteOpenedTwiceToday        → "Hot lead. Knock $150 off if they book this week to close it."
                              cta: "Send the warm offer"

activeJob && deposit         → "Job is on track. Drop a confirmation text the night before to stay top-of-mind."
                              cta: "Schedule confirmation"

cold && daysSince > 30       → "Quiet {n} weeks. Could be deciding between you and someone cheaper — give them a reason to come back."
                              cta: "Win them back"

… etc, ~8 patterns cover ~95% of cases.
```

Until the agents module exists, the deterministic fallback ships. Once it does, the agents module **replaces** these strings with on-brand narrative ("written in the monsters' voice").

## Island vs server

**Island.** The grid is a single hydration root that owns:
- The open/close coordinator (`openId`, doc click + Esc handlers)
- Per-card click → open transition
- Per-card "nudge" CTA → typically navigates to `/assistant?prefill=<clientId>` (no JS state needed)
- Per-card "Open card" panel button → navigates to `/clients/:id`

**Server-rendered:** the entire card and its panel HTML are rendered at SSR. The panel is `display: flex` from the start with `opacity: 0` + `pointer-events: none` — toggling `.ccard2--open` is a CSS-only animation. This means cards work on the static HTML before hydration — no flash.

## Accessibility

- The card root is a clickable `<div>`. Add `role="button"`, `tabIndex={0}`, `aria-expanded={isOpen}`, and an `aria-label` that includes the client name + status. Bind Enter / Space to open.
- The detail panel's close button has `aria-label="Close"` already in the prototype — keep it.
- Focus management on open: when the panel slides up, move focus to the close button (`.ccard2__panel-x`). On close, return focus to the card root.
- Trap focus inside the open panel — Tab cycles through the three contact rows + Message + Open card + Close. The prototype doesn't do this; production should.
- The huge `.ccard2__since-num` is decorative; mark `.ccard2__since` `aria-hidden="true"`. The actual "days since contact" should appear in the SR-only text inside the card root or in the panel.
- The `pulse-dot` keyframe on `.ccard2__status-dot` is decorative; honour `prefers-reduced-motion: reduce`.
- Colour is the primary status signal (mood gradient). Always pair with the `.ccard2__status` text label — do not rely on colour alone. The label is mandatory.

## Edge cases

- **No story (`story` missing):** the prototype falls back to `{ line:'No notes yet — open the card to leave one.', cta:'Open card' }`. Keep this exact copy; it carries the right tone for a brand-new client.
- **Long client name:** `.ccard2__name` is `text-overflow: ellipsis white-space: nowrap`. Truncates at one line. The full name appears in the panel header (also one line, also truncates). For ARIA, the full name is in `aria-label`.
- **Long story line:** clamped to 4 lines via `-webkit-line-clamp: 4`. The fixed story window (`height: calc(14.5px * 1.5 * 4)`) is intentional — keeps the foot row aligned across all cards in a row.
- **Zero balance:** "Settled" — green-friendly teal text, no `+/-` sign.
- **Negative balance (credit):** "$500 credit" — green text. Reads as money-on-account-with-you, not "you owe them".
- **Crown + status pill collision:** the crown sits in the top-right (28 px) and the status pill in the top-left (~80 px wide). They don't overlap unless the card is < 200 px wide. The min-card width via `minmax(300px, 1fr)` keeps this safe.
- **Many cards open simultaneously:** impossible by design. `ClientsCards` enforces single-open via `openId`. Clicking another card while one is open closes the first and opens the second on the next tick — visually a clean handoff because both transitions are 380 ms.
- **Empty filtered set:** the `<ClientsCards>` wrapper renders an empty-state placeholder ("No clients match these filters. [Clear filters]"). Don't render an empty grid.
- **Reduced motion:** disable the lift transform on hover, the panel slide-up keyframe (snap to position instead), and the status-dot pulse. The fade (opacity) on the panel can stay — it's gentle.
