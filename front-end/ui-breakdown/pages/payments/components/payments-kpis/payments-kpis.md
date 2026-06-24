# PaymentsKpis

The 4-cell `.qkpi` KPI strip on /payments: **Landed this month** · **In
transit** (pink-accent cell) · **Needs attention** · **Avg days to pay**.

## 1. Classification & behavior
- **Bucket:** local presentational component of the PaymentsPage island
  (`islands/PaymentsPage.tsx` lines 593–654). Not its own island.
- **Interaction tier:** **static / island-child.** No client state, no fetch,
  no events, no callbacks. Every number is a prop.
- **Server actions + flash:** none. Non-interactive — the cells are not links
  or buttons (unlike some KPI strips elsewhere).
- **Data source:** all props, computed by the parent island. **Honest-empty:**
  the Avg-days cell shows `—` + `noHistory` copy when `avgDays===0`; the other
  cells degrade to `$0` / `0` naturally.
- **Liveness:** none.
- **Data-shape hazards (rollups — the flagged concern for this tile):**
  - **`monthTotal` / `transitTotal` / `attentionTotal` are per-render Σ scans**
    in the parent over the landed/transit/attention arrays. On a real backend
    these mirror `DashboardStats.payments.receivedYtdCents` and a settling
    subset — whole-account aggregates. **[precompute counters; don't scan on
    each load].**
  - **`landedCount` / `transitCount` / `attentionCount`** are array lengths of
    the same client-side buckets (count-per-status). **[status-bucketed
    counters].**
  - **`avgDays`** = mean of `(receivedAt − invoice.issuedDate)` over landed
    payments that have an `issuedDate` — a join+average recomputed every render.
    **[materialize a payment-cycle metric].**
  - **`attentionCount`/`attentionTotal` are structurally always 0** — the
    `attention` status is never produced (no source signal on `Payment`), so the
    "Needs attention" cell perpetually reads `0` / "$0 held up". Dead metric.

## 2. Anatomy
```
<div class="qkpi">
  <div class="qkpi__cell">                          ← Landed this month
    <div class="qkpi__lbl">Landed this month</div>
    <div class="qkpi__val">{fmtMoney(monthTotal)}</div>
    <div class="qkpi__sub">{n} payment(s)</div>      ← tnFor plural
  </div>
  <div class="qkpi__cell qkpi__cell--accent">        ← In transit (PINK accent)
    <div class="qkpi__lbl">In transit</div>
    <div class="qkpi__val">{fmtMoney(transitTotal)}</div>   ← pink val
    <div class="qkpi__sub">{n} on the way</div>
  </div>
  <div class="qkpi__cell">                            ← Needs attention
    <div class="qkpi__lbl">Needs attention</div>
    <div class="qkpi__val">{attentionCount}</div>     ← a COUNT, not money
    <div class="qkpi__sub">{fmtMoney(attentionTotal)} held up</div>
  </div>
  <div class="qkpi__cell">                            ← Avg days to pay
    <div class="qkpi__lbl">Avg days to pay</div>
    <div class="qkpi__val">{avgDays>0 ? "Nd" : "—"}</div>
    <div class="qkpi__sub">{avgDays>0 ? "across landed payments" : "no paid history yet"}</div>
  </div>
</div>
```
- Note the **In-transit** cell is **always** the accent cell here (vs Invoices'
  KPIs where the accent is conditional on overdue count).
- Deps: `fmtMoney`, `tFor`, and the `tnFor` plural helper (PaymentsPage.tsx
  lines 43–44). No icons.

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `lang` | `Lang` (required) | — | select | no |
| `landedCount` | number (required) | — | number | no |
| `monthTotal` | number (CENTS, required) | — | number | no |
| `transitCount` | number (required) | — | number | no |
| `transitTotal` | number (CENTS, required) | — | number | no |
| `attentionCount` | number (required) | — | number | no |
| `attentionTotal` | number (CENTS, required) | — | number | no |
| `avgDays` | number (required) | — | number | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| populated | all four cells with real numbers | `cases/populated/populated.json` |
| empty | fresh account, all 0 → "$0", avg "—" | `cases/empty/empty.json` |
| with-transit | non-zero In-transit accent cell | `cases/with-transit/with-transit.json` |
| es | Spanish labels + plurals | `cases/es/es.json` |

## 5. Events
- None. The cells are static `<div>`s (no click/nav).

## 6. Motion
- None of its own. (The `.qkpi__cell--accent` gradient is static.) Reduced-motion
  is a no-op here.

## 7. Responsive (from quotes.css)
- `≤1200px`: `.qkpi` → `repeat(2, 1fr)` (2-up).
- `≤768px`: `.qkpi` → `1fr` (stacked single column).

## 8. A11y
- Labels are uppercase `.qkpi__lbl` text tied visually (not programmatically) to
  the value. No `<dl>`/`<dt>`/`<dd>` semantics — purely visual grouping.
  **Fix:** wrap each cell as a `<dl>` (or add `aria-label` summarizing
  label+value) so AT reads "Landed this month: $15,910".
- The pink accent value relies on color alone to distinguish In-transit — the
  text label "In transit" carries the meaning, so it's not color-only.

## 9. Used on
`/payments` only (rendered by PaymentsPage). CSS = `css/payments-kpis.css`
(documents the `.qkpi*` reuse from `static/quotes.css`; no component-local CSS).
