# `PhaseDivider` — Inline phase boundary marker

> ✅ **Build in v1.** Pure CSS / static. Used to visually separate the chat into "Phase 1 — Chat" / "Phase 2 — Contract terms" / "Phase 3 — Send" sections.

## Purpose

A horizontal line with a centered pill containing an icon + a phase label. Sits between message groups inside the chat scroll, breaking the conversation into the three workflow phases.

## Source

- JSX: `Paperwork Monsters Assistant.html` lines **~4444–4450** (inside ChatScroll)
- Inline CSS: search for `.phase-divider`, `.phase-divider__line`, `.phase-divider__label`

## JSX (verbatim)

```jsx
<div className="phase-divider">
  <div className="phase-divider__line"/>
  <div className="phase-divider__label">
    <I d={ICN.contract} size={11}/> Phase 2 — Contract terms
  </div>
  <div className="phase-divider__line"/>
</div>
```

## CSS (intended rules — read inline `<style>` for canonical version)

```css
.phase-divider {
  display: flex; align-items: center; gap: 12px;
  margin: 18px 0 12px;
}
.phase-divider__line {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--border-strong) 50%, transparent 100%);
}
.phase-divider__label {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--mint-200); color: var(--brand-teal);
  border: 1px solid var(--border);
  font-family: var(--font-heading); font-weight: 800; font-size: 11px;
  letter-spacing: 0.04em;
  padding: 5px 11px; border-radius: 999px;
}
.phase-divider__label svg { color: var(--brand-pink); }
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/assistant/PhaseDivider.tsx — server component
import * as I from "../ui/icons.tsx";

const ICONS = {
  chat:     I.Msg,
  terms:    I.Contract,
  send:     I.Send,
} as const;

export function PhaseDivider(props: {
  phase: 1 | 2 | 3;
  label: string;       // "Phase 2 — Contract terms"
}) {
  const Icon = props.phase === 1 ? ICONS.chat
            : props.phase === 2 ? ICONS.terms
            :                     ICONS.send;
  return (
    <div class="phase-divider" aria-label={props.label}>
      <div class="phase-divider__line" aria-hidden="true" />
      <div class="phase-divider__label">
        <Icon size={11} />
        {props.label}
      </div>
      <div class="phase-divider__line" aria-hidden="true" />
    </div>
  );
}
```

## Props

```ts
type PhaseDividerProps = { phase: 1 | 2 | 3; label: string };
```

## Data source

Static — derived from message metadata (`message.phaseTransition`) when the agents module emits a phase boundary in the message stream.

## Island vs server

**Server.** Pure CSS; no JS.

## Accessibility

- `aria-label` on the wrapper carries the full label so SR users hear "Phase 2 — Contract terms" once.
- The two `__line` divs are decorative → `aria-hidden="true"`.
- Don't make this a heading element — it's a separator within a scrollable conversation. `role="separator"` would be technically correct: `<div role="separator" aria-label={label}>`.

## Edge cases

- **Sub-phase markers** (e.g., "Step 5 of 10"): use the wizard's own internal step indicator, not phase-divider — phase-divider is only for the three top-level phases.
- **Day/time markers** (`Today · 8:42 AM · Phase 1 — Chat`): the prototype renders these as a separate `.chat__day` element above messages — not a phase divider. Two separate components.
- **Phase 4+:** if more phases get added, use a generic `phase-pill` color scheme rather than hard-coding 1/2/3 styles.
