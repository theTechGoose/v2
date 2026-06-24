# RedirectToast

A tiny one-shot toast that reads a known query parameter on mount and surfaces a
single explanatory line for ~6 seconds, then strips the param. Used by the
`/messages → /assistant?from=messages` consolidation (P6.14) so the silent jump
is no longer confusing.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/RedirectToast.tsx`).
- **Interaction tier:** `island` (client-only, one-shot) — no fetch, no events.
- **Client state owned:**
  - `key: string | null` — the i18n message key to show. `null` = hidden.
  - `lang` — `langSignal.value` (the `lang` prop is an ignored SSR seed) so a
    live language flip re-localizes the visible toast.
- **Mount logic (effect):** reads `URLSearchParams.get("from")`; maps it through
  `MESSAGE_KEYS = { messages: "redirectToast.messagesConsolidated" }`. If a known
  key matches: `setKey(k)`, then **`history.replaceState`** to drop `?from=` (so
  reloads don't re-fire), and `setTimeout(() => setKey(null), 6000)`.
- **Data source:** the URL query string only. No backend.
- **Liveness:** none.
- **Honest-empty:** returns `null` (renders nothing) unless a recognized `from`
  value is present — so on a normal `/assistant` visit it's invisible.
- **Anti-patterns:** none. `history.replaceState` is the correct param-strip; no
  reload. (The 6s auto-dismiss has no manual close button — minor.)
- **Styling:** fully **inline-styled** (a pill: teal bg `#1A535C`, white text,
  fixed top-center, `z-index:9999`). No external CSS class — nothing to extract;
  the `css/redirect-toast.css` here only documents the inline values.

## 2. Anatomy
```
key===null → renders null
else:
<div role="status" style="position:fixed;top:18px;left:50%;translateX(-50%);
     background:var(--brand-teal,#1A535C);color:#fff;padding:10px 18px;
     border-radius:999px;font-size:13.5px;font-weight:500;
     box-shadow:0 4px 14px rgba(0,0,0,.18);z-index:9999;max-width:90vw">
  {tFor(lang, key)}
</div>
```

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `lang` | `"en"\|"es"` | (ignored) | select | **ignored SSR seed** — reads `langSignal.value` |

(No other props — the trigger is the URL, not a prop.)

## 4. States → cases
| state | meaning | case |
|---|---|---|
| from-messages | `?from=messages` present → consolidation line visible | `cases/from-messages/from-messages.json` |
| hidden | no recognized `from` → renders nothing | `cases/hidden/hidden.json` |

> Isolate note: the trigger is `location.search`, which isolate can't set per
> case. Drive via `_signals.key` (set to `"redirectToast.messagesConsolidated"`
> to show, `null` to hide), bypassing the URL read. The 6s auto-dismiss timer is
> harmless in isolate.

## 5. Events
- No user events (no buttons). The only "event" is the mount-time URL read and
  the 6s self-dismiss timer.

## 6. Motion (extracted)
- **None.** The toast appears/disappears via conditional render — no entrance or
  exit transition is defined (it pops in and pops out). A rebuild could add a
  fade/slide; the current source has no animation.
- **Reduced motion:** N/A (no animation).

## 7. Responsive
- `max-width:90vw` keeps it on-screen on narrow viewports; otherwise fixed
  top-center at all widths. No `@media`.

## 8. A11y
- `role="status"` — announced politely by AT. Good.
- **Gap:** no dismiss control and no `aria-live` region wrapper beyond the
  implicit `role="status"`; acceptable for a 6s informational toast.

## 9. Used on
Only `routes/assistant/index.tsx` (mounted unconditionally; self-gates on the
`?from=` param). Not on `[threadId].tsx`. This is the visible half of the
`/messages` → `/assistant?from=messages` 302 redirect
(`routes/messages/index.tsx`).
