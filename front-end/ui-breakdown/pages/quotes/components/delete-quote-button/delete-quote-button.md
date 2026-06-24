# DeleteQuoteButton

A small **confirm → delete → reload** action button. Two visual variants: a
`btn` (the unclassed "Delete" button in QuoteCard's back foot) and an `icon` (the
compact `×` in a DecidedRow). On click it fires a native `confirm()`, then
`DELETE /quotes/:id`, then **reloads the whole document**.

## 1. Classification & behavior

- **Bucket:** `island` (`islands/DeleteQuoteButton.tsx`).
- **Interaction tier:** `island` — a **client-driven server mutation**. This is
  the one mutating control in the quotes feature.
- **Server action + flash:** there is **no `<form>` / PRG / Fresh route handler**.
  The mutation is a client `fetch` via `quotesClient.delete(id)` →
  `DELETE /quotes/:id` → `{ ok }`. There is **no flash message**; success
  feedback is the page reload, failure feedback is a native `alert()`.
- **Island client-state + refresh:**
  - `busy: boolean` (`useState`) — set true between confirm and the
    delete-resolve; disables the button (`disabled={busy}`, cursor `wait`). On
    error it's reset to false (so the user can retry); on success the page
    reloads before it matters.
  - `lang = langSignal.value` — read **during render**, so the label
    ("Delete"/"Deleting…"/aria-label) re-localizes live when SettingsPage flips
    language. The `lang` **prop** is an ignored SSR seed (the interface keeps it
    but the function body reads the signal).
- **`location.reload()` FLAG — YES, this is the reload.**
  `await quotesClient.delete(id); globalThis.location.reload();`. This is the
  canonical "whole-page island + reload-after-mutation" anti-pattern: the quote
  list lives in `QuotesPage`'s frozen `useState`, so a delete can't surgically
  splice the removed row — the app nukes the entire document, re-running every
  fetch (`/quotes`, win-rate, insight) and re-rendering the shell
  (`DashSidebar`/`DashTopbar` + their `dash-cache` reads). Deleting one decided
  row triggers a full SPA reload.
- **Data source:** none of its own; it only **writes** (`DELETE /quotes/:id`).
  Takes the target `id` as a prop.
- **Honest-empty:** N/A — it's a single action button; it always renders given an
  `id`. (After it deletes the last quote, the reloaded page shows the
  honest-empty QuotesHero.)
- **Liveness:** none. One-shot mutation, no polling/websocket.
- **Confirm gate:** `globalThis.confirm(resolvedConfirm)` — a **native browser
  confirm dialog** ("Delete this quote? This cannot be undone."), not an in-app
  modal. Cancel → no-op (returns before `setBusy`).
- **Error path:** `quotesClient.delete` reject → `setBusy(false)` +
  `globalThis.alert(tFor(lang,"deleteQuoteButton.error",{message}))` (native
  alert, not a toast).
- **Data-shape hazards:**
  - **Reload after mutate** (above) — the headline rebuild target.
  - **Native `confirm`/`alert`** block the thread and are unstyled OS dialogs —
    no design-system styling, no i18n beyond the message string passed in, and
    `confirm` is sometimes suppressed in embedded/automation contexts (drive the
    confirm explicitly when capturing).
  - **Frozen `id` prop** — fine here (the parent re-renders with new ids on
    reload), but the lack of an `onDeleted(id)` callback is exactly why the
    parent must reload instead of splicing.

### Anti-pattern + rebuild fix

This is the mutation half of the QuotesPage page-island anti-pattern. Two viable
rebuilds (mirrors the quotes-page spec):
1. **`<form method="POST">` + PRG / Fresh Partial:** post the delete to a route
   handler that deletes then `303`-redirects back to `/quotes`, rendered through
   an `f-partial` so only the list fragment swaps — no JS reload, success/error
   as a **flash** on the redirect, confirm as a styled in-app dialog
   (`<dialog>` / island modal) instead of native `confirm`.
2. **Lift + optimistic island state:** hold the `quotes` array in a signal owned
   by QuotesPage; pass `onDeleted(id)` down; this button calls it to splice the
   row (optimistic) and reconciles on the `{ ok }` response. No document reload.
   (Callbacks aren't serializable → in isolate they surface as **Events**, not
   props.)

## 2. Anatomy

```
variant="icon":
  <button type=button class="qdone__del" onClick disabled={busy}
          aria-label={ariaLabel} title={ariaLabel}>×</button>

variant="btn" (default):
  <button type=button onClick disabled={busy}>
    {busy ? "Deleting…" : resolvedLabel}     ← UNCLASSED; inherits .qcard__back-foot button
  </button>
```
- **Slots/children:** none.
- **No dedicated CSS.** The icon variant uses `.qdone__del` (decided-row scoped,
  in `static/quotes.css` / mirrored in quotes-sections css). The btn variant is
  an **unclassed `<button>`** that inherits `.qcard__back-foot button` rules when
  rendered inside QuoteCard's back face. Both are reproduced in this folder's
  `css/delete-quote-button.css` so the button can be isolated without its host
  page CSS.
- **No icon dependency** — the `×` is a literal U+00D7 glyph, not an `<I>`.

## 3. Props

| name | type | default | control | signal? |
|---|---|---|---|---|
| `id` | string (quote id) | — (required) | text | no |
| `variant` | `"btn"\|"icon"` | `"btn"` | select | no |
| `label` | string (overrides "Delete") | `tFor(lang,"deleteQuoteButton.label")` | text | no |
| `confirmText` | string (overrides confirm copy) | `tFor(lang,"deleteQuoteButton.confirm")` | text | no |
| `lang` | `"en"\|"es"` | `"en"` | select | **ignored SSR seed** — live lang from `langSignal.value` |

## 4. States → cases

| state | meaning | case |
|---|---|---|
| btn | default variant, idle ("Delete") | `cases/btn/btn.json` |
| btn-busy | mid-delete ("Deleting…", disabled, cursor wait) | `cases/btn-busy/btn-busy.json` |
| icon | compact `×` (decided-row), idle | `cases/icon/icon.json` |
| icon-busy | `×` disabled (opacity .5, cursor wait) | `cases/icon-busy/icon-busy.json` |
| es | Spanish label/confirm | `cases/es/es.json` |

> Isolate note: `busy` is internal `useState`. The `*-busy` cases force it via
> `"_signals": { "busy": true }`. To exercise the real flow, mock
> `quotesClient.delete` (`_mocks`) — a never-resolving promise keeps it busy; a
> reject surfaces the native `alert`. The native `confirm` must be auto-accepted
> in the harness (it blocks otherwise).

## 5. Events

- `ev.expect(e => e.source === "button.qdone__del" && e.type === "click")`
  (icon) / `e.source === "button" && e.type === "click"` (btn) → `stopPropagation`
  (so it doesn't flip the parent card), then `confirm()`; on accept →
  `setBusy(true)` → `quotesClient.delete(id)` → `location.reload()`; on reject of
  the fetch → `setBusy(false)` + `alert(error)`.
- `confirm` cancel → no-op (early return, no busy, no fetch).

## 6. Motion (extracted)

- **No keyframes.** Hover transitions only:
  - icon (`.qdone__del`): `border-color`/`color`/`background` over `--dur-fast`
    `--ease-out` → pink-tinted on hover.
  - btn (`.qcard__back-foot button`): `border-color`/`color` + `translateY(-1px)`
    over `--dur-fast` on hover → pink.
- **Disabled:** `opacity:.5; cursor:wait` (no transition on the disabled flip —
  it just snaps).
- **Jank:** none — trivial color/transform transitions.
- **Reduced motion:** no local guard; relies on the global tokens clamp (the
  hover transitions go instant). The native `confirm`/`alert` dialogs are
  OS-rendered and unaffected.

## 7. Responsive

- **No own `@media`.** Geometry is fixed (icon 24×24px; btn padding 9px×6px). The
  icon variant sits in the DecidedRow grid, which hides the `.qdone__when` column
  at **560px** but keeps the `×` (quotes-sections css). Verify within those host
  widths.

## 8. A11y

- icon variant: has `aria-label` + `title` (`deleteQuoteButton.ariaLabel` =
  "Delete quote") — good, since `×` alone isn't a label.
- btn variant: text label ("Delete") is its accessible name — fine.
- `disabled={busy}` correctly removes it from tab order mid-delete.
- **Gap:** destructive action gated only by a **native `confirm`** — no
  `aria`-described danger affordance, no focus management, no styled
  confirmation. Rebuild: a styled confirm dialog (`<dialog>`/island modal) with
  focus trap + `aria-describedby`, and announce success/failure via an
  `aria-live` flash rather than a native `alert`.

## 9. Used on

`/quotes` only, via two hosts:
- **QuoteCard back foot** — `<DeleteQuoteButton id={q.id}>` (btn variant)
  [`islands/QuoteCard.tsx:198`].
- **DecidedRow** — `<DeleteQuoteButton id={q.id} variant="icon">`
  [`components/QuotesSections.tsx:186`].

Both hosts render only on `/quotes`. No other consumer (grep of
`DeleteQuoteButton` import/JSX across `routes/ islands/ components/`).
