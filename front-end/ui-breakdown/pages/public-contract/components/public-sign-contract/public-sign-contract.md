# PublicSignContract

The customer-facing **signature pad** on the public contract page (`/c/:id`).
Two-input e-sign flow: **(1) draw** your signature on a canvas (pointer / touch /
pen), **(2) type** your full legal name underneath. Both are POSTed to
`/api/contracts/:id/sign` as `{ name, signature /* PNG data URL */ }`. The typed
name is the legal-record fallback; the canvas captures the visual mark.

Source: `islands/PublicSignContract.tsx` (copied to `js/PublicSignContract.tsx`,
476 lines). Mounted by `routes/c/[id].tsx` under the contract document.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/PublicSignContract.tsx`).
- **Interaction tier:** `island` — canvas drawing + `fetch` POST mutation. NOT a
  Fresh Partial, NOT an SSR form/PRG.
- **Surface:** **public palette** (inline hex — `#FF6B6B`/`#d94e4e` pink pad
  frame, `#144852` teal ink stroke, `#519843` green submit, `#1c2c30` ink,
  `#6b7a7e` muted, `#e3e8e6` hairline), NOT Sabor. Its sole external CSS dep is
  `.spinner` (+ `spin` keyframe) from `/landing.css` (the host route loads it;
  see `css/public-sign-contract.css`, which reproduces it).
- **Client state owned:**
  - `hasInk: boolean` (signal/`useState`) — whether any committed stroke exists;
    gates the placeholder, undo/clear enable, and submit enable.
  - `name: string` — the typed legal name input.
  - `submitting: boolean` — POST in flight.
  - `status: "idle" | "ok" | "error"` — terminal state (`ok` swaps to the success
    panel).
  - `err: string | undefined` — inline error text.
  - **Imperative refs (NOT signals):** `canvasRef` (the `<canvas>`),
    `strokesRef: Stroke[]` (committed strokes), `drawingRef: Stroke | null` (the
    in-progress stroke). A `Stroke` is `{ points: {x,y,t}[] }` — `t` is
    `performance.now()` per sample, used for speed→width.
- **Drawing interaction (the core mechanic):**
  - **Pointer Events** unify mouse/touch/pen. `onPointerDown` →
    `canvas.setPointerCapture(e.pointerId)`, starts a new `drawingRef` stroke with
    the first sample, and sets `hasInk=true` immediately (so the placeholder
    clears under the very first stroke, not on pointer-up). `onPointerMove` pushes
    a `{x,y,t}` sample and calls `redraw()`. `onPointerUp` /
    `onPointerCancel` / `onPointerLeave` all route to `onPointerUp`, which
    releases capture, commits the stroke to `strokesRef` **only if it has >1
    point** (a bare tap adds nothing), nulls `drawingRef`, and re-syncs `hasInk`
    to `strokesRef.length > 0` (so a tap that drew nothing restores the
    placeholder).
  - **Variable stroke width** = ink-pen feel: per segment, `speed = dist/dt` and
    `width = clamp(0.9, 3.2, 3.4 - speed*1.6)` — faster = thinner.
  - **Hi-DPI:** `setupCanvas()` sizes the backing buffer to
    `rect.width/height * devicePixelRatio` and `ctx.scale(dpr,dpr)`.
  - **Undo** pops the last stroke + redraws; **Clear** empties `strokesRef`. Both
    `disabled` when `!hasInk`.
  - **Resize-aware:** a `resize` listener re-runs `setupCanvas()` (which re-sizes
    the buffer and `redraw()`s) so the signature survives a viewport change /
    rotation.
  - **PNG export (`exportSignaturePng`)** crops to the strokes' bounding box
    (+10px pad), caps width at 480px, redraws onto an offscreen canvas with a
    white fill, and returns a `toDataURL("image/png")` — keeping the payload
    ~3–10KB to stay under the backend's 64KB row limit (a full hi-DPI canvas
    would be ~150KB+).
- **Server mutation + feedback:**
  - `onSign` (form submit) early-returns unless `name.trim()` AND `hasInk`. Then
    `POST /api/contracts/:id/sign` JSON `{ name: trimmed, signature: dataUrl }`.
    On non-ok it throws `text.slice(0,200)` (truncated body) or the status code.
  - **Flash:** the submit button swaps to `<span class="spinner"/> + "Signing…"`
    and `disabled`; on success `status="ok"` shows the green check panel.
- **`location.reload()` FLAG — PRESENT.** On success the island sets
  `status="ok"`, then `setTimeout(() => globalThis.location.reload(), 900)` so the
  **SSR-rendered "signed" contract** takes over (the right-hand customer-signature
  card fills in with the typed name + date, matching the contractor card). This is
  a **flagged anti-pattern**: a full-document reload to "refresh" after a
  mutation. The 900ms green-check is purely cosmetic before the hard reload.
  - **Fix:** prefer a server PRG (`POST /sign` responds `303 → /c/:id`, browser
    re-fetches the signed doc via the server), or have the island patch the
    customer-signature card in place from the success response (the data it needs —
    typed name + date — is already in hand) instead of reloading. Contrast the
    sibling `PublicInvoiceClaim`, which does the correct in-memory swap with NO
    reload.
- **Liveness:** request-response only. No polling/websocket.
- **Data source / honest-empty:** owns no fetch on mount — receives
  `contractId` + `lang` as props; the contract document itself is SSR'd by the
  route. If the contract is already signed/declined the route doesn't mount this
  island (renders the signed doc instead).
- **Reactivity / i18n:** `lang` is a **prop** (`"en"|"es"`, default `"en"`),
  resolved by the route; all strings via `tFor(lang,key,vars)`. No on-page toggle
  → NOT reactive to `langSignal`.

### JS jank lint — forced layout (synchronous reflow) in pointer handlers
- **FINDING (jank):** `onPointerMove` runs on every pointer sample and calls
  `pointerXY(e)` → `canvas.getBoundingClientRect()`, then `redraw()` →
  `canvas.getBoundingClientRect()` **again**. `getBoundingClientRect()` forces a
  **synchronous layout flush**; calling it (twice) at pointer-sample frequency
  (often 60–240Hz on a pen/trackpad) is classic **layout thrash** in the hot
  drawing path. It coexists with a 2D-canvas paint, so the cost is a forced
  reflow + a full canvas repaint per move.
- **FINDING (algorithmic):** `redraw()` re-clears and **replays ALL committed
  strokes plus the in-progress stroke from scratch on every pointermove** — O(total
  points drawn so far) per sample. As the signature grows, each new sample gets
  more expensive (quadratic-ish over a stroke), so a long signature visibly
  degrades. There is no `requestAnimationFrame` batching — `redraw()` runs
  synchronously inside the event handler.
- **FIX:**
  1. **Cache the rect** — read `getBoundingClientRect()` once in `setupCanvas()`
     (and on the existing `resize` listener) into a ref; reuse it in `pointerXY`
     and `redraw` instead of re-measuring per move. (Also account for scroll if
     the page can scroll during signing.)
  2. **Incremental draw** — in `onPointerMove`, draw only the newest segment
     (`lineTo` from the previous point) onto the live context instead of full
     `redraw()`; reserve the full replay for undo/clear/resize.
  3. **rAF-coalesce** pointermove → at most one draw per frame
     (`requestAnimationFrame`), dropping intermediate samples' redundant repaints.
- **Reduced-motion:** N/A to the drawing itself (user-driven), but see Motion §6
  for the `.spinner` and the submit `transition`.

### A11y — keyboard / typed-name fallback
- **There IS a typed-name fallback** — the `<input type="text" autoComplete="name"
  required>` is a fully keyboard-accessible legal-name capture, and the disclaimer
  frames the typed name as the binding record.
- **BUT signing still HARD-REQUIRES a drawn mark:** `onSign` early-returns and the
  submit stays `disabled` unless **both** `name.trim()` AND `hasInk`. The canvas
  is **pointer-only** — there is **no keyboard path to produce ink** (no
  type-to-sign, no "use my typed name as signature" toggle). So a
  keyboard-only / no-pointer / screen-reader user **cannot complete signing at
  all**. This is the headline a11y gap (see §8).

## 2. Anatomy (inline styles; see js + css for literals)
```
status === "ok"  →  success panel (transient, 900ms before reload)
<div style="margin-top:24px;
            background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(81,152,67,0.04));
            border:1px solid rgba(72,158,95,0.35); border-radius:18px;
            padding:24px; text-align:center">
  <div circle #519843 + ✓ svg/>
  <div weight:800 #519843 18px>  publicSign.success.title  ("Contract signed!")
  <div #6b7a7e 13px>             publicSign.success.body
</div>

status !== "ok"  →  the form
<form onSubmit=onSign style="margin-top:24px;text-align:left">
  ── header strip ──
  <div eyebrow #d94e4e>  publicSign.eyebrow
  <div actions>
     <button Undo  type=button disabled={!hasInk}  aria-label  (↺ svg) />
     <button Clear type=button disabled={!hasInk}  aria-label  (🗑 svg) />
  ── pad ──
  <div pad-wrapper  border:2px dashed #FF6B6B; radius:18px; box-shadow:…>
     <div faint-grid aria-hidden/>        20px×20px rgba(255,107,107,0.05)
     <div baseline   aria-hidden/>        border-bottom @ 36px from bottom
     <div "✕" guide  aria-hidden/>        Helvetica Neue 900, bottom-left
     <canvas ref onPointerDown/Move/Up/Cancel/Leave
             style="width:100%;height:200px;touch-action:none;cursor:crosshair"/>
     {!hasInk && <div placeholder aria-hidden>publicSign.pad.heading + .sub</div>}
  ── typed legal name ──
  <label>  publicSign.nameLabel
  <input type=text required autoComplete=name value=name onInput placeholder=publicSign.namePlaceholder/>
  <div disclaimer #6b7a7e 12px>  publicSign.disclaimer
  {err && <div #b3261e 13px>publicSign.error{err}</div>}
  ── submit ──
  <button type=submit disabled={submitting || !name.trim() || !hasInk}
     style="width:100%;
            bg = enabled ? linear-gradient(135deg,#519843,#71a85f) : #a8c8a0;
            box-shadow = enabled ? 0 10px 22px -6px rgba(81,152,67,0.55) : none;
            transition: transform 160ms">
     { submitting ? <span class=spinner/> + publicSign.submitting
       : (hasInk && name.trim()) ? ✒ svg + publicSign.submitEnabled
                                 : ✒ svg + publicSign.submitDisabled }
  </button>
</form>
```
- **Slots/children:** none.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `contractId` | `string` (required) | — | text | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

`hasInk`/`name`/`submitting`/`status`/`err` are internal `useState`; the
strokes/drawing/canvas are imperative refs — drive via Events / case `_signals`.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| idle | empty pad + placeholder; name empty; undo/clear + submit disabled | `cases/idle/idle.json` |
| inked | `hasInk=true` + name filled → submit enabled (green gradient) | `cases/inked/inked.json` |
| submitting | POST in flight → spinner + "Signing…", inputs locked | `cases/submitting/submitting.json` |
| success | `status="ok"` green check panel (transient; reload follows) | `cases/success/success.json` |
| error | POST failed → red error line; form stays interactive for retry | `cases/error/error.json` |
| es | Spanish strings throughout | `cases/es/es.json` |

The canvas strokes are imperative refs, not signals — isolate can only fake the
post-stroke UI via the `hasInk` signal; **real ink must be produced by the Events
pointer sequence** (a fixture cannot inject `strokesRef`).

## 5. Events (`capture(page)` predicates)
- `ev.expect(e => e.source === "canvas" && e.type === "pointerdown")` →
  `setPointerCapture` + start stroke + `setHasInk(true)`.
- `ev.expect(e => e.source === "canvas" && e.type === "pointermove")` → push
  sample + `redraw()` (the jank hot path — §1).
- `ev.expect(e => e.source === "canvas" && e.type === "pointerup")` → commit
  stroke (if >1 pt) + re-sync `hasInk`.
- `ev.expect(e => e.source === "button" /* Undo */ && e.type === "click")` →
  `undoStroke()`.
- `ev.expect(e => e.source === "button" /* Clear */ && e.type === "click")` →
  `clearPad()`.
- `ev.expect(e => e.source === "input" /* name */ && e.type === "input")` →
  `setName(value)`.
- `ev.expect(e => e.source === "form" && e.type === "submit")` → `onSign` →
  `POST /api/contracts/:id/sign` → on ok `status="ok"` → **900ms →
  location.reload() (FLAGGED)**.

## 6. Motion (real CSS only)
- **Submit button `transition: transform 160ms`** — the ONLY declared transition
  on the island (no transform is actually applied in source beyond hover/active
  the UA may add; it's a latent affordance).
- **`.spinner`** (from `/landing.css`, reproduced in `css/`): 14px ring,
  `border-right-color:transparent`, `animation: spin 0.7s linear infinite`
  (`@keyframes spin { to { transform: rotate(360deg) } }`). Shown only while
  `submitting`.
- The canvas redraw is JS-driven (no CSS animation).
- **Reduced-motion:** the island declares no reduced-motion block; the global
  token clamp (`prefers-reduced-motion: reduce` → durations 0.01ms) applies to
  the `.spinner`/transition once landing.css/tokens are present. Rebuild should
  keep the spinner honoring reduced-motion.

## 7. Responsive
- No own `@media`. The pad is `width:100%; height:200px` (fixed height) inside the
  route's document column; the button row + inputs are full-width. The `resize`
  listener re-runs `setupCanvas()` so the backing buffer + drawn strokes survive
  width changes / rotation. `touch-action:none` on the canvas is load-bearing —
  it lets pointer drawing work on touch without the browser hijacking the gesture
  to scroll.

## 8. A11y
- Undo/Clear carry `aria-label` (`publicSign.undoAria`/`clearAria`); the pad's
  decorative grid/baseline/✕/placeholder are all `aria-hidden`. Typed name input
  is `required` + `autoComplete="name"`. Submit label changes meaningfully
  (`submitDisabled`→`submitEnabled`).
- **GAPS (headline):**
  - **No keyboard path to sign.** Producing ink is pointer-only; signing requires
    `hasInk`, so a keyboard-only / no-pointer / SR user is **fully blocked**. The
    typed name alone cannot satisfy submit. Rebuild: offer a "use my typed name as
    my signature" option (render the typed name into the canvas) or accept a typed
    signature as the legal mark — i.e. make the drawn mark optional when a name is
    present.
  - The `<canvas>` has no `role`/`aria-label`/instructions for SR users — it's an
    opaque interactive region.
  - Error is a plain `<div>` (no `role="alert"`/`aria-live`) → a send failure
    isn't announced.
  - On success no focus is moved to the result panel, and the 900ms reload yanks
    context out from under assistive tech.

## 9. Used on
- `/c/:id` only — mounted by `routes/c/[id].tsx` under the contract document, only
  when the contract is not already signed/declined. Sole importer; passed
  `contractId` + `lang` (from the contractor's comms language).
