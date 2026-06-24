# Capture checklist — OnboardingProgress

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- Only appears on `http://localhost:5280/assistant/<threadId>?onboard=1` AND only
  while the gate passes (`initialStep < 4 && !hasActivity`).
- Reach it via the entry flow: `http://localhost:5280/assistant?onboard=1` →
  server seeds an onboarding thread → 302 to `/assistant/<id>?onboard=1`.

## Viewports
- **1280px** (full chat column) and **720px** (mobile — the row wraps; chips wrap
  to a second line).

## Element(s) to crop
- The full pink banner strip across the top of the `.chat` column: 👋/✓ avatar,
  the QUICK SETUP eyebrow + step copy, the 4 dots + thin progress bar + `N/4`,
  and the quick-reply chip row.

## Transient states to drive
1. **step0** — fresh onboarding thread, nothing answered (dots empty, first dot
   pulsing).
2. **step2** — after answering name + business; the "Yes" / "different state"
   chips appear (the state question).
3. **step3** — after the state answer; "One left." copy + the "skip" chip for the
   address question.
4. **done** — answer the address question → all 4 dots green, ✓ avatar, confetti
   burst, then the banner fades out after ~4.5s. Capture mid-confetti AND the
   faded-out (gone) end state.

## Motion to film
- `pm-onb-pulse` on the current-step dot (1.4s).
- The progress-bar `width` fill on each step advance (480ms bounce ease).
- The completion confetti (canvas, ~1.7s) and the 600ms opacity fade-out.
- Re-shoot with `prefers-reduced-motion: reduce`: the dot pulse stills (local
  guard) and the confetti does NOT fire (matchMedia early-return) — verify both.
