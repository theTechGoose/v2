# Capture checklist — ui/Button

**Theme:** light only.
**Caveat:** this component is currently UNUSED in the running app (zero imports),
so there is no live route that renders it. Capture via **isolate** only, or
temporarily drop it into a scratch route.

## Surface dependency (important)
`.btn-*` styling differs by which feature CSS is loaded:
- Load **verify.css** for the canonical look (all 3 variants + disabled).
- Load **landing.css** to see the marketing restyle (pink, no ghost). Shoot both
  if documenting the divergence.

## Viewports
- One desktop width (e.g. **1280px**) is sufficient — no responsive behavior.

## Element(s) to crop
- Each button variant individually (tight crop), plus a hover and `:active` frame.

## Transient states to drive
1. **primary / outline / ghost** at `size=md`.
2. **lg** size.
3. **disabled** (Button) — dimmed, `cursor:not-allowed`.
4. **anchor** — AnchorButton with `href`.
5. **hover** + **:active** (press nudge `translateY(1px)` on verify.css).

## Motion to film
- Hover/active transitions (120–200ms). On the landing.css surface, the bounce
  hover-lift + active scale. Re-shoot with reduced motion (global clamp).
