# Capture checklist — ui/Brand

**Theme:** light only.
**Caveat:** only consumer is the orphaned `components/AppNav.tsx` — there is no
live route rendering it. Capture via **isolate** (load verify.css for correct
`.brand__mark` styling).

## Viewports
- One desktop width — no responsive behavior.

## Element(s) to crop
- The `<a class="brand">` (mark + wordmark), tight.

## States to drive
1. **md** — default, teal/`--fg` text, pink "P" mark.
2. **sm** — wordmark text at 16px (mark unchanged).
3. **inverse** — render on a dark/teal background so the white wordmark shows.

## Motion
- None.
