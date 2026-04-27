# `ActionCard` — Inline quote / contract / invoice card from the assistant

> ⚠️ **DEFERRED — depends on agents module + paperwork generation.** The card is rendered when the assistant produces a structured artifact (quote, contract, invoice). It needs the agent to call into the existing v2 paperwork module to actually create the doc.

## Purpose

A pill-headed card embedded inside an assistant message. Top row: square colored icon + title + subtitle + status chip ("Draft" / "Locked" / "Sent" / "Signed"). Body: line items with amounts, a separator, total row. Tappable: opens the full doc preview / pane on the right.

## Source

- JSX: `Paperwork Monsters Assistant.html` lines **~4360–4395** (inside the second user→assistant exchange in `ChatScroll`)
- Inline CSS: search for `.action-card`, `.action-card__head/icon/title/sub/chip/body/row`

## JSX (verbatim)

```jsx
<div className="action-card">
  <div className="action-card__head">
    <div className="action-card__icon"><I d={ICN.quote} size={16}/></div>
    <div style={{flex:1, minWidth:0}}>
      <div className="action-card__title">Quote #Q-2026-041</div>
      <div className="action-card__sub">Tom &amp; Linda K. · 2-car garage · ~480 sqft</div>
    </div>
    <span className="action-card__chip">Draft</span>
  </div>
  <div className="action-card__body">
    <div className="action-card__row"><span>Surface prep + grind</span><strong>$840</strong></div>
    <div className="action-card__row"><span>Polyaspartic system (3-coat)</span><strong>$1,680</strong></div>
    <div className="action-card__row"><span>Color flakes &amp; sealing</span><strong>$520</strong></div>
    <div className="action-card__row"><span>Materials &amp; mobilization</span><strong>$360</strong></div>
    <div className="action-card__row"
         style={{borderTop:'1px solid rgba(20,72,82,0.08)', marginTop:6, paddingTop:8}}>
      <span style={{fontWeight:700, color:'var(--brand-teal)'}}>Total</span>
      <strong style={{fontSize:15}}>$3,400</strong>
    </div>
  </div>
</div>
```

## CSS (intended structure — read inline `<style>` for canonical)

```css
.action-card {
  background: linear-gradient(135deg, var(--mint-200), #fff);
  border: 1px solid var(--green-100);
  border-radius: 14px;
  margin-top: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 200ms, transform 200ms;
}
.action-card:hover { border-color: var(--brand-green); transform: translateY(-1px); }

.action-card__head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  background: rgba(255,255,255,0.6);
  border-bottom: 1px solid var(--border);
}
.action-card__icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--brand-green); color: #fff;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.action-card__title {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 13px; color: var(--brand-teal);
  letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.action-card__sub {
  font-size: 11px; color: var(--fg-muted);
  margin-top: 1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.action-card__chip {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase;
  background: var(--coffee-50); color: var(--coffee-600);
  padding: 3px 9px; border-radius: 999px;
}

.action-card__body {
  padding: 10px 14px;
  display: flex; flex-direction: column; gap: 4px;
}
.action-card__row {
  display: flex; justify-content: space-between;
  font-size: 12px; color: var(--fg-muted);
  padding: 4px 0;
}
.action-card__row strong {
  font-family: var(--font-heading); font-weight: 800;
  color: var(--brand-teal);
}
```

## Status-chip color variants (recommended; not all in prototype)

| Status | Background | Text |
|---|---|---|
| Draft       | `var(--coffee-50)` | `var(--coffee-600)` |
| Locked      | `var(--green-50)`  | `var(--green-600)`  |
| Sent        | `var(--teal-50)`   | `var(--teal-600)`   |
| Signed      | `var(--green-50)`  | `var(--green-600)`  |
| Paid        | `var(--green-50)`  | `var(--green-600)`  |
| Overdue     | `var(--pink-50)`   | `var(--pink-700)`   |

## Preact / Fresh translation

```tsx
// v2/frontend/components/assistant/ActionCard.tsx — server component (mostly)
import * as I from "../ui/icons.tsx";

type Kind = 'quote' | 'contract' | 'invoice';
type Status = 'Draft'|'Locked'|'Sent'|'Signed'|'Paid'|'Overdue';
type Line = { label: string; amountCents: number };
type Payload = {
  refNumber: string;             // e.g. "Q-2026-041"
  title: string;                 // "2-Car Garage Epoxy Floor"
  subtitle: string;              // "Tom & Linda K. · 2-car garage · ~480 sqft"
  status: Status;
  lines: Line[];                 // 1-N line items; total computed
  href?: string;                 // route to full doc, e.g. "/dashboard/quotes/q1"
};

const KIND_ICON = { quote: I.Quote, contract: I.Contract, invoice: I.Invoice } as const;

export function ActionCard(props: { kind: Kind; payload: Payload }) {
  const Icon = KIND_ICON[props.kind];
  const total = props.payload.lines.reduce((s, l) => s + l.amountCents, 0);
  const fmt = (c: number) => `$${(c / 100).toLocaleString('en-US')}`;

  const Card = (
    <div class="action-card">
      <div class="action-card__head">
        <div class="action-card__icon"><Icon size={16} /></div>
        <div style="flex:1; min-width:0">
          <div class="action-card__title">
            {props.kind === 'quote' ? 'Quote' : props.kind === 'contract' ? 'Contract' : 'Invoice'} #{props.payload.refNumber}
          </div>
          <div class="action-card__sub">{props.payload.subtitle}</div>
        </div>
        <span class={`action-card__chip action-card__chip--${props.payload.status.toLowerCase()}`}>
          {props.payload.status}
        </span>
      </div>
      <div class="action-card__body">
        {props.payload.lines.map(l => (
          <div class="action-card__row">
            <span>{l.label}</span><strong>{fmt(l.amountCents)}</strong>
          </div>
        ))}
        <div class="action-card__row" style="border-top:1px solid rgba(20,72,82,0.08); margin-top:6px; padding-top:8px">
          <span style="font-weight:700; color:var(--brand-teal)">Total</span>
          <strong style="font-size:15px">{fmt(total)}</strong>
        </div>
      </div>
    </div>
  );

  return props.payload.href ? <a href={props.payload.href} class="block">{Card}</a> : Card;
}
```

## Props

```ts
type ActionCardProps = { kind: 'quote'|'contract'|'invoice'; payload: Payload };
```

## Data source

The agent module returns an `Action` payload as part of its message stream. Each action has the kind + payload defined above, with the underlying entity already created via the existing v2 endpoints:
- `kind: 'quote'`     → backend created via `POST /quotes`
- `kind: 'contract'`  → `POST /contracts`
- `kind: 'invoice'`   → `POST /invoices`

The `href` points to the full document view (`/dashboard/quotes/:id`).

## Island vs server

**Server.** The card itself is static; clicking it navigates. If we want inline action buttons (Lock / Send / Sign), wrap them in tiny islands that POST to the existing v2 endpoints.

## Accessibility

- Wrap in `<a href>` so it's keyboard-focusable. The whole card becomes a link.
- The status chip color is decorative — make sure the chip text itself is readable.
- Currency: use `<bdi>` to keep `$3,400` from being mirrored in RTL contexts (the app is currently LTR, but future-proof).

## Edge cases

- **Many line items (>10):** the prototype shows 4. Truncate to 4 + "…and 6 more" expansion.
- **Long line label:** `text-overflow: ellipsis` on the `<span>` inside `.action-card__row`.
- **Paid status on invoice:** consider showing the paid amount + balance due as a sub-total row.
- **Cancelled/Voided:** add a strikethrough on the title and a "Voided" chip in pink.
- **Click target:** the whole card is clickable. Don't add inline buttons inside that swallow the click — handle bubbling carefully.
