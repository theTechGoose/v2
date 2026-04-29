# Animations — client-card-2

## Keyframes used (catalogued in `shared/design-tokens/motion.md`)

### `pulse-dot` — `.ccard2__status-dot`
- 2.4s opacity loop (1 → 0.4 → 1).

### `ccard2-editorial-in` — declared but not wired in the export
- Defined as `from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); }`.
- The cards apply `animation-delay: idx*35ms` inline, but the `animation` shorthand isn't set anywhere — so this keyframe is dormant. Wire it up if you want a staggered entry.

## Transitions

```css
.ccard2 {
  transition: transform 320ms var(--ease-bounce), box-shadow 320ms var(--ease-out);
}
.ccard2:hover { transform: translateY(-4px); box-shadow: …--mood-shadow…; }
.ccard2__panel {
  transition: transform 380ms var(--ease-bounce), opacity 240ms var(--ease-out);
}
.ccard2__nudge { transition: gap var(--dur-fast) var(--ease-out); }
.ccard2__nudge:hover { gap: 9px; }
.ccard2__nudge-arrow { transition: transform var(--dur-fast) var(--ease-out); }
.ccard2__nudge:hover .ccard2__nudge-arrow { transform: translateX(2px); }
.ccard2__panel-x { transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.ccard2__panel-x:hover { background: rgba(26,83,92,0.12); transform: rotate(90deg); }
.ccard2__panel-row { transition: background var(--dur-fast) var(--ease-out); }
.ccard2__panel-row:hover { background: var(--mint-100); }
.ccard2__panel-row-arrow { transition: transform var(--dur-fast) var(--ease-out); }
.ccard2__panel-row:hover .ccard2__panel-row-arrow { transform: translateX(2px); color: var(--brand-pink); }
.ccard2__panel-act { transition: transform var(--dur-fast) var(--ease-out); }
.ccard2__panel-act:hover { transform: translateY(-1px); }
```
