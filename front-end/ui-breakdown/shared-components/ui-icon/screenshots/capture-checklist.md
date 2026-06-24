# Capture checklist — ui/Icon

**Theme:** light only.

## Where it renders live
- `islands/Composer.tsx` (Assistant composer) — `image`, `mic`, `send` icons.
  Route: `http://localhost:5280/assistant` (dev master OTP `000000`). The other
  13 names only render via isolate or the orphaned AppNav.

## Best captured via isolate
Render the **all-glyphs** case to produce a single sheet of all 16 icons at
size 24 for the spec. Also shoot `default`, `sized`, `colored`.

## Viewports
- One width is enough (vector; no responsive behavior). Capture at 1x and 2x DPR
  to confirm crispness.

## Element(s) to crop
- Individual icons (tight), plus the full 16-icon sheet.

## States to drive
1. **default** — `home` @ 18.
2. **sized** — `send` @ 32.
3. **colored** — wrap in a `color:#519843` parent → stroke turns green.
4. **all-glyphs** — the full union grid.

## Motion
- None.
