# OnboardingProgress

The "Quick setup" progress strip shown at the top of the chat on
`/assistant/[threadId]?onboard=1` while the conversation is still
onboarding-shaped. Four dots fill as the user answers (name → business → state →
address); the current dot pulses; a confetti burst fires at completion; then the
strip fades itself out so the chat takes over.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/OnboardingProgress.tsx`).
- **Interaction tier:** `island` (client-only state) **with event-driven
  re-fetch**.
- **Client state owned:**
  - `step: Step` (`0|1|2|3|4`) — seeded from `initialStep` (computed SSR-side from
    the profile so the dots never flash empty), recomputed on every
    `pm:profile-updated` event by fetching `/api/profile` and counting filled
    fields (name, business||legal, state, postal).
  - `done: boolean` — `step >= 4`.
  - `hidden: boolean` — set true ~4.5s after completion → component returns null.
  - `lang` — `langSignal.value` (the `lang` prop is an ignored SSR seed).
  - refs: `canvasRef` (confetti), `lastConfettiAt` (5s throttle).
- **Data source:** `GET /api/profile` (Fresh route → backend). Counts 4 fields
  into the step.
- **Liveness — event PUSH + targeted re-fetch (no polling):** listens for the
  `pm:profile-updated` CustomEvent (dispatched by AsstChat after each successful
  onboarding turn) → re-fetches `/api/profile` → recomputes `step`. Also computes
  once on mount in case the SSR `initialStep` is stale.
- **Honest-empty:** always renders (with `step` dots) while visible; there is no
  empty variant — it's a progress affordance, not a data list.
- **Anti-patterns:**
  - **`globalThis.location.assign("/dashboard")`** in `skipSetup()` — a hard
    full-page navigation (acceptable: it's an explicit "skip" exit, not a
    refresh). FLAG: not a `location.reload()`, but a frozen-state-dropping nav.
  - The "skip" affordance does **not** persist a skip flag (acknowledged in a
    source comment) — the user will see onboarding again on the next
    `?onboard=1` visit. Known gap.
  - No `location.reload()`.
- **Gating (in the route, not the island):** `[threadId].tsx` only mounts this
  when `showOnboardBanner = isOnboard && initialStep < 4 && !hasActivity`
  (hasActivity = bound customer || contract || phase==="terms"). So a thread with
  real work never shows "One left."

## 2. Anatomy
```
hidden===true → null
else:
<div style="…banner…; opacity:{hidden?0:1}">              ← fade-out container
  <canvas ref=canvasRef aria-hidden/>                      ← confetti layer (absolute, full-bleed)
  <div row>
    <span avatar>{done ? "✓" : "👋"}</span>                ← green when done, pink otherwise
    <div col>
      <div><strong eyebrow>{done?"DONE":"QUICK SETUP"}</strong>{message}</div>   ← step-specific copy
      <div dots-row>
        {[1..4].map(i → <span dot [pm-onb-pulse if current]/>)}
        <div role=progressbar aria-valuenow=step><div fill width={pct}/></div>
        <span>{step}/4</span>
      </div>
      {!done && <div quick-replies>                          ← step-specific chips + Skip setup
        step===2 → "Yes" / "different state"
        step===3 → "skip"
        always   → "Skip setup" (ghost, → /dashboard)
      </div>}
    </div>
  </div>
  <style>{@keyframes pm-onb-pulse + reduced-motion guard}</style>
</div>
```
- **Quick-reply chips** dispatch `pm:onboard-send-text` (`{ text }`) which AsstChat
  listens for and forwards into the composer send — non-blocking (you can still
  type your own answer).

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `initialStep` | `0\|1\|2\|3\|4` | `0` | select | no — SSR seed, then synced from `/api/profile` |
| `lang` | `"en"\|"es"` | (ignored) | select | **ignored SSR seed** — reads `langSignal.value` |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| step0 | nothing filled — "let's get you set up" | `cases/step0/step0.json` |
| step2 | 2 of 4 — shows Yes / different-state chips | `cases/step2/step2.json` |
| step3 | 3 of 4 — "One left." + skip chip | `cases/step3/step3.json` |
| done | 4/4 — green ✓, confetti, then fades out | `cases/done/done.json` |

> Isolate note: `initialStep` seeds the visible state directly, so cases are bare
> props. The mount effect will try to fetch `/api/profile` (no backend → throws,
> swallowed) and keep the seeded step. The `done` case fires confetti on mount
> (suppressed under reduced-motion) and hides itself after ~4.5s — capture
> quickly.

## 5. Events
- `ev.expect(e => e.source.includes("button") && /Yes|different state|skip/.test(e.text))`
  → `quickReply(text)` → dispatches `pm:onboard-send-text` `{ text }`.
- `ev.expect(e => e.text === "Skip setup")` → `skipSetup()` →
  `location.assign("/dashboard")`.
- Incoming (not user): `pm:profile-updated` → re-fetch + recompute step.

## 6. Motion (extracted, all inline)
- **Current-step dot:** `@keyframes pm-onb-pulse` — `scale(1)→1.35` + expanding
  `box-shadow` ring, `1.4s ease-in-out infinite` (pink).
- **Progress-bar fill:** `width` transition `480ms cubic-bezier(.34,1.56,.64,1)`
  (overshoot/bounce).
- **Dots:** `transition: all 280ms ease` (fill color).
- **Container:** `transition: opacity 600ms ease-out` → fades to 0 ~4.5s after
  completion, then unmounts (`hidden`).
- **Confetti:** canvas `requestAnimationFrame`, 80 particles, gravity+drift,
  ~1.7s; **suppressed when `prefers-reduced-motion: reduce`** (early-returns).
- **Reduced motion:** component-local guard `[style*="pm-onb-pulse"]{animation:
  none}` + the confetti `matchMedia` early-return. Verify both.

## 7. Responsive
- The row is `flex-wrap:wrap` with `min-width:160px` on the text column, so it
  reflows on narrow widths. No `@media` of its own.

## 8. A11y
- The bar is a real `role="progressbar"` with `aria-valuemin/max/now` + label —
  good.
- Confetti canvas is `aria-hidden`.
- Quick-reply / skip are real `<button>`s.
- **Gap:** the step copy itself isn't in an `aria-live` region, so a step advance
  isn't announced; minor.

## 9. Used on
Only `routes/assistant/[threadId].tsx`, conditionally (`showOnboardBanner`). Not
on `index.tsx`. Pairs with the `?onboard=1` entry flow seeded by
`/assistant?onboard=1` → `onboarding-start` → redirect to the new thread.
