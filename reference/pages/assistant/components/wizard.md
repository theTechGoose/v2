# `Wizard` — Multi-step inline contract-terms form

> ⚠️ **DEFERRED — depends on agents module + contract DTO extensions.** This is the most complex chat-internal component. It walks the user through 10 contract-terms questions inline, branching on answers and persisting state to the conversation.

## Purpose

A large rounded card embedded inside an assistant message. Header with config chip + "All-on-one" toggle. Below: a horizontal strip of completed-step chips (each with check + label + value + edit pencil). Below that: the **active step** (number, question, 4-5 button options + "Custom…"). Below that: a row of upcoming step pills. Footer: progress bar + sticky "Next" button.

The 10 steps in the prototype are: Config (preset), Customer, Start date, Wraps (end date), **Payment terms** (active in screenshot), Warranty, Termination, Dispute resolution, Governing state, State notices.

## Source

- JSX: `Paperwork Monsters Assistant.html` lines **~4453–4524** (inside ChatScroll)
- Inline CSS: search for `.wiz`, `.wiz__head*`, `.wiz__chips`, `.wiz__step*`, `.wiz__opts`, `.wiz-opt`, `.wiz-opt--custom`, `.wiz__hint`, `.wiz__rest*`, `.wiz-pill`, `.wiz-chip`

## JSX (verbatim — active state for "Payment terms" step)

```jsx
<div className="wiz">
  <div className="wiz__head">
    <div className="wiz__head-icon"><I d={ICN.contract} size={16}/></div>
    <div className="wiz__head-txt">
      <div className="wiz__head-title">Contract terms</div>
      <div className="wiz__head-sub">Tap an answer · last button is always Custom</div>
    </div>
    <div className="wiz__head-config">
      <I d={ICN.bookmark} size={11}/> Standard residential
    </div>
    <button className="wiz__head-mode" title="Show all on one page">
      <I d={ICN.list} size={11}/> All-on-one
    </button>
  </div>

  {/* Completed steps as chips */}
  <div className="wiz__chips">
    <span className="wiz-chip">
      <span className="wiz-chip__check">✓</span>
      <span className="wiz-chip__label">Config:</span>
      <span className="wiz-chip__val">Standard residential</span>
      <I d={ICN.pencil} size={10} sw={2.4} />
    </span>
    <span className="wiz-chip">
      <span className="wiz-chip__check">✓</span>
      <span className="wiz-chip__label">Customer:</span>
      <span className="wiz-chip__val">Tom &amp; Linda K.</span>
      <I d={ICN.pencil} size={10} sw={2.4} />
    </span>
    <span className="wiz-chip">
      <span className="wiz-chip__check">✓</span>
      <span className="wiz-chip__label">Start:</span>
      <span className="wiz-chip__val">Mon May 4</span>
      <I d={ICN.pencil} size={10} sw={2.4} />
    </span>
    <span className="wiz-chip">
      <span className="wiz-chip__check">✓</span>
      <span className="wiz-chip__label">Wraps:</span>
      <span className="wiz-chip__val">2 days · May 5</span>
      <I d={ICN.pencil} size={10} sw={2.4} />
    </span>
  </div>

  {/* Active step */}
  <div className="wiz__step">
    <div className="wiz__step-num">Step 5 of 10 · Payment terms</div>
    <h3 className="wiz__step-q">How do you want to get paid?</h3>
    <div className="wiz__opts">
      <button className="wiz-opt">
        50 / 50
        <span className="wiz-opt__sub">$1,700 deposit · $1,700 on finish</span>
      </button>
      <button className="wiz-opt">
        30 / 30 / 40
        <span className="wiz-opt__sub">$1,020 / $1,020 / $1,360</span>
      </button>
      <button className="wiz-opt">
        Net 15 — full
        <span className="wiz-opt__sub">$3,400 due 15 days after wrap</span>
      </button>
      <button className="wiz-opt">
        Deposit + balance
        <span className="wiz-opt__sub">$500 hold · balance on finish</span>
      </button>
      <button className="wiz-opt wiz-opt--custom">
        <I d={ICN.plus} size={11} sw={2.5} style={{display:'inline', marginRight:4}}/> Custom…
        <span className="wiz-opt__sub">Tell Bossie a different schedule</span>
      </button>
    </div>
    <div className="wiz__hint">
      <I d={ICN.bolt} size={11}/> Defaults:
      <strong style={{color:'var(--brand-teal)', margin:'0 4px'}}>Net 15 · 1.5% late fee</strong> — editable after picking
    </div>
  </div>

  {/* Remaining steps */}
  <div className="wiz__rest">
    <span className="wiz__rest-label">Up next:</span>
    <span className="wiz-pill"><span className="wiz-pill__num">6</span> Warranty</span>
    <span className="wiz-pill"><span className="wiz-pill__num">7</span> Termination</span>
    <span className="wiz-pill"><span className="wiz-pill__num">8</span> Dispute</span>
    <span className="wiz-pill"><span className="wiz-pill__num">9</span> Governing state</span>
    <span className="wiz-pill"><span className="wiz-pill__num">10</span> State notices</span>
  </div>

  {/* Footer / progress (intended) */}
  {/* …progress bar showing 5/10 = 50% filled… */}
</div>
```

## Step list (10 questions)

| # | Step | Maps to Contract DTO field |
|---|---|---|
| 1 | Config (preset) | `paymentTerms` defaults override based on preset |
| 2 | Customer | `customerId` |
| 3 | Start date | `timeline.startDate` |
| 4 | Wraps (end date) | `timeline.estimatedCompletionDate` |
| 5 | Payment terms | `paymentTerms.{type, schedule, lateFeePercent, …}` |
| 6 | Warranty | `warranty.{type, months, description}` |
| 7 | Termination notice | `terminationNoticeDays` |
| 8 | Dispute resolution | `disputeResolution.{method, jurisdiction}` |
| 9 | Governing state | `state` |
| 10 | State notices | `stateNotices` |

DTO fields are listed as v1 should add to `paperwork/dto/contract.ts` — see `backend.md` §7. Until then, store wizard state alongside the conversation.

## CSS (intended structure — read inline `<style>` for canonical)

```css
.wiz {
  background: linear-gradient(135deg, #fff 0%, var(--mint-200) 100%);
  border: 1.5px solid var(--green-100);
  border-radius: 16px;
  padding: 16px;
  margin-top: 8px;
}

.wiz__head {
  display: grid; grid-template-columns: auto 1fr auto auto;
  gap: 10px; align-items: center;
  margin-bottom: 12px;
}
.wiz__head-icon  { width: 32px; height: 32px; border-radius: 9px;
                   background: var(--brand-green); color: #fff;
                   display: flex; align-items: center; justify-content: center; }
.wiz__head-title { font-family: var(--font-heading); font-weight: 800;
                   font-size: 14px; color: var(--brand-teal); }
.wiz__head-sub   { font-size: 11px; color: var(--fg-muted); margin-top: 1px; }
.wiz__head-config{ display: inline-flex; align-items: center; gap: 4px;
                   background: var(--coffee-50); color: var(--coffee-600);
                   padding: 3px 8px; border-radius: 999px;
                   font-family: var(--font-heading); font-weight: 800; font-size: 10px; }
.wiz__head-mode  { background: transparent; border: 1px solid var(--border-strong);
                   border-radius: 8px; padding: 4px 10px;
                   font-family: var(--font-heading); font-weight: 700; font-size: 11px;
                   color: var(--fg-muted); cursor: pointer; }

/* completed-step chips ----------------------------------- */
.wiz__chips    { display: flex; flex-wrap: wrap; gap: 6px;
                 padding: 4px 0 12px; border-bottom: 1px dashed rgba(81,152,67,0.18);
                 margin-bottom: 14px; }
.wiz-chip      { display: inline-flex; align-items: center; gap: 6px;
                 background: #fff; border: 1px solid var(--green-100);
                 border-radius: 999px; padding: 4px 8px 4px 6px;
                 font-size: 11px; cursor: pointer;
                 transition: border-color 120ms; }
.wiz-chip:hover            { border-color: var(--brand-green); }
.wiz-chip__check          { width: 14px; height: 14px; border-radius: 999px;
                            background: var(--brand-green); color: #fff;
                            display: flex; align-items: center; justify-content: center;
                            font-size: 9px; font-weight: 800; }
.wiz-chip__label          { color: var(--fg-muted); font-weight: 600; }
.wiz-chip__val            { font-family: var(--font-heading); font-weight: 800;
                            color: var(--brand-teal); }

/* active step -------------------------------------------- */
.wiz__step       { padding: 0 4px 12px; }
.wiz__step-num   { font-family: var(--font-heading); font-weight: 700;
                   font-size: 11px; letter-spacing: 0.04em;
                   color: var(--brand-pink); text-transform: uppercase;
                   margin-bottom: 4px; }
.wiz__step-q     { font-family: var(--font-heading); font-weight: 800;
                   font-size: 18px; color: var(--brand-teal);
                   margin: 0 0 10px; letter-spacing: -0.01em; }

.wiz__opts       { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.wiz-opt {
  background: #fff;
  border: 1.5px solid var(--border-strong);
  border-radius: 12px;
  padding: 10px 14px;
  text-align: left; cursor: pointer;
  font-family: var(--font-heading); font-weight: 800; font-size: 13px;
  color: var(--brand-teal);
  transition: all 200ms var(--ease-bounce);
  display: flex; flex-direction: column; gap: 2px;
}
.wiz-opt:hover         { border-color: var(--brand-green);
                          transform: translateY(-1px);
                          box-shadow: 0 6px 14px rgba(81,152,67,0.15); }
.wiz-opt__sub          { font-family: var(--font-body); font-weight: 500;
                          font-size: 11px; color: var(--fg-muted); }
.wiz-opt--custom       { border-style: dashed; color: var(--brand-pink); }
.wiz-opt--custom:hover { border-color: var(--brand-pink); }

.wiz__hint {
  margin-top: 10px;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--fg-muted);
}

/* upcoming-step pills ------------------------------------ */
.wiz__rest       { margin-top: 12px;
                    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
                    border-top: 1px dashed rgba(100,69,54,0.10);
                    padding-top: 12px; }
.wiz__rest-label { font-family: var(--font-heading); font-weight: 700;
                   font-size: 10px; letter-spacing: 0.06em;
                   color: var(--fg-subtle); text-transform: uppercase;
                   margin-right: 4px; }
.wiz-pill        { display: inline-flex; align-items: center; gap: 5px;
                   background: var(--mint-100);
                   border: 1px solid var(--border);
                   border-radius: 999px; padding: 3px 9px 3px 4px;
                   font-family: var(--font-heading); font-weight: 700;
                   font-size: 11px; color: var(--fg-muted); }
.wiz-pill__num {
  width: 16px; height: 16px; border-radius: 999px;
  background: var(--mint-200); color: var(--brand-teal);
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 800;
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/Wizard.tsx — large island

type WizardStep = {
  id: string;
  label: string;             // "Payment terms"
  question: string;          // "How do you want to get paid?"
  options: { id: string; label: string; sub?: string; isCustom?: boolean }[];
  hint?: string;
};

type WizardSpec = { steps: WizardStep[] };

export function Wizard(props: { wizardId: string; spec: WizardSpec }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [allOnOne, setAllOnOne] = useState(false);

  const completed = props.spec.steps.slice(0, activeIdx);
  const remaining = props.spec.steps.slice(activeIdx + 1);
  const active    = props.spec.steps[activeIdx];

  async function pick(stepId: string, optionId: string) {
    setAnswers({ ...answers, [stepId]: optionId });
    // POST partial answer to agents module
    await fetch('/api/proxy/agents/wizard/answer', {
      method: 'POST',
      body: JSON.stringify({ wizardId: props.wizardId, stepId, optionId }),
    });
    if (activeIdx < props.spec.steps.length - 1) setActiveIdx(activeIdx + 1);
  }

  if (allOnOne) return <WizardAllOnOne {...props} answers={answers} setAnswers={setAnswers} />;

  return (
    <div class="wiz">
      <div class="wiz__head">…</div>
      <div class="wiz__chips">
        {completed.map(s => <Chip step={s} value={answers[s.id]} onEdit={() => setActiveIdx(props.spec.steps.indexOf(s))} />)}
      </div>
      <div class="wiz__step">
        <div class="wiz__step-num">Step {activeIdx + 1} of {props.spec.steps.length} · {active.label}</div>
        <h3 class="wiz__step-q">{active.question}</h3>
        <div class="wiz__opts">
          {active.options.map(o => (
            <button class={`wiz-opt ${o.isCustom ? 'wiz-opt--custom' : ''}`} onClick={() => pick(active.id, o.id)}>
              {o.label}
              {o.sub && <span class="wiz-opt__sub">{o.sub}</span>}
            </button>
          ))}
        </div>
        {active.hint && <div class="wiz__hint">{active.hint}</div>}
      </div>
      <div class="wiz__rest">
        <span class="wiz__rest-label">Up next:</span>
        {remaining.map((s, i) => (
          <span class="wiz-pill"><span class="wiz-pill__num">{activeIdx + 2 + i}</span> {s.label}</span>
        ))}
      </div>
    </div>
  );
}
```

## Props

```ts
type WizardProps = { wizardId: string; spec: WizardSpec };
```

## Data source

The agents module owns wizard state and `spec` shape. The frontend renders the spec it receives. Each answer is POSTed back, the agent re-evaluates, and may emit a new wizard message with the next step (or a confirmation card). Until the agents module is ready, this is purely a **deferred** spec.

## Island vs server

**Island.** State machine + step transitions.

## Accessibility

- Each option `<button>` should be a real `<button type="button">` (not a `<div>`).
- `.wiz__step-q` is the active question — wrap in an `<h3 id={`wiz-${wizardId}-q`}>` and make the option group `<div role="radiogroup" aria-labelledby={…}>` with each option `role="radio"` + `aria-checked={false}`.
- Custom option opens a free-text dialog. Use `<dialog>` element so SR users get focus management.
- Provide keyboard support: arrow keys move between options, Enter selects.
- "Edit" pencil on a completed-step chip should be focusable + announced as "Edit Customer: Tom & Linda K.".
- `wiz__rest-label` "Up next:" is informational — wrap in `<span class="sr-only">` if it's overly chatty.
- Honor `prefers-reduced-motion` on the option-card hover transform.

## Edge cases

- **Custom answer:** opens a free-text inline editor (or a dialog). Required for "Custom payment terms" which can't be expressed as a preset.
- **Edit a completed step:** clicking a chip jumps `activeIdx` back; the visual fills back in for the now-unanswered later steps.
- **All-on-one mode toggle** (`.wiz__head-mode`): renders all 10 steps stacked, like a traditional form. Useful for power users.
- **Conditional steps:** governing-state can hide / change content of state-notices step. The spec must declare a step's `dependsOn`.
- **Partial answer auto-save:** every pick POSTs immediately; resuming the conversation later restores the same activeIdx.
- **Mobile (<768px):** option grid → 1 col; active step's question font drops to 16 px; chip strip horizontally scrolls.
- **>10 steps:** the pill row wraps; consider truncating to next 5 with "…and 3 more".
