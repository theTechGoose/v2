# WelcomeBackToast

A small "Welcome back, {firstName}." pill that fades into the top-right of the
dashboard for returning users who land from `/verify` with `?welcome=back` in the
URL. It auto-dismisses after 3 seconds and strips the query param so a refresh
doesn't re-flash. For everyone else it renders nothing.

## 1. Classification & behavior
- **Bucket:** `island` (file lives in `islands/WelcomeBackToast.tsx`). Mounted at
  the dashboard route root (sibling of `.app`).
- **Interaction tier:** `island` — client-only state, self-gating, one
  fire-and-forget fetch for the name. Non-interactive output
  (`pointer-events: none`).
- **Self-gate (the headline behavior):** on mount it reads
  `new URLSearchParams(location.search).get("welcome")`; if it is not `"back"` it
  returns early and never shows. So the pill only appears on the post-verify
  redirect, not on normal dashboard loads.
- **Client state owned (`useState`):**
  - `show: boolean` — gates the pill; set `true` once the name resolves, set
    `false` by a 3s timer.
  - `name: string` — the user's first name (best-effort; defaults to a fallback).
- **Data source:** `fetch("/api/me", { credentials: "include" })` → `{ name? }`;
  takes the first whitespace-delimited token as the first name. This is a **raw
  `fetch`, not a `clients/*` helper** (a small inline call). On any non-ok
  response or network error it silently bails (`catch {}`) — the pill simply
  doesn't show rather than showing a broken state. (Note: the generic
  fallback-name path is only reached at render via
  `t("welcomeBackToast.nameFallback")` → "friend"; a failed `/api/me` returns
  before `setShow(true)`, so in practice a network failure suppresses the toast
  entirely.)
- **Query-param cleanup:** after a 50ms defer (so it doesn't race the param read),
  it `history.replaceState`s the URL with `welcome` deleted — so a manual refresh
  won't re-trigger the toast. In-place, no navigation.
- **i18n (note — uses `lib/lang.ts`, not the JSON dict):** the message template
  comes from `STRINGS[lang]["welcome.back"]` (`"Welcome back, {firstName}."`),
  with `{firstName}` replaced by the fetched name (or the `t(...)` fallback
  "friend"). `lang` is `langSignal.value` at render (reactive). This is the
  `lib/lang.ts` `STRINGS` map, distinct from the `lang/en.json` dict the other
  components use.
- **Server mutations / PRG / flash:** none — it's read-only feedback.
- **`location.reload()`:** none. ✅ (It uses `replaceState`, not reload/assign.)
- **Liveness:** request-response (one `/api/me` GET) + two timers (50ms param
  cleanup, 3000ms auto-dismiss). No polling, no websocket. Cleanup clears the
  dismiss timer and a `cancelled` flag on unmount.
- **Data-shape hazards:** `me.name` is optional → `(me.name ?? "").trim().split(
  /\s+/)[0] ?? ""` yields `""` for a nameless user, which falls through to the
  "friend" fallback at render. `URLSearchParams`/`URL` are wrapped against SSR
  (`typeof globalThis.window === "undefined"` guard up top). `replaceState` is
  try/catch'd.

## 2. Anatomy
```
(SSR / window undefined) → effect no-ops
(welcome !== "back") → never shows
(!show) → null
else:
<div role="status" aria-live="polite"
     style="position:fixed;top:18px;right:18px;z-index:9999;
            inline-flex;gap:10px;padding:10px 16px 10px 14px;
            background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:999px;
            box-shadow:0 6px 24px rgba(0,0,0,.10),0 1px 3px rgba(0,0,0,.04);
            font-size:14px;font-weight:600;color:#144852;
            animation:pm-toast-in 280ms cubic-bezier(.34,1.56,.64,1) both;
            pointer-events:none">
  <span aria-hidden style="22px circle; background:#FF6B6B; color:#fff;">👋</span>
  <span>{message}</span>          ← "Welcome back, {firstName}." (or "…, friend.")
  <style> @keyframes pm-toast-in + reduced-motion guard
```
- **Slots/children:** none.
- **No icon import** — the 👋 is an emoji in a pink circle. Fully inline-styled;
  the only shared concept is the `--brand-pink`/`--brand-teal` hexes inlined as
  `#FF6B6B`/`#144852`.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| — | — | — | — | — |

The island takes **no props** — mounted bare (`<WelcomeBackToast />`). The name
comes from `/api/me`, the gate from the URL, the language from `langSignal`.

## 4. States → cases
Self-gating + fetched name; isolate models the URL param + `/api/me` via `_mocks`
and the `show`/`name` via `_signals`. Language via `_signals`.

| state | meaning | case |
|---|---|---|
| named | `?welcome=back` + `/api/me` → "Welcome back, Raphael." | `cases/named/named.json` |
| fallback-name | `?welcome=back` + nameless `/api/me` → "Welcome back, friend." | `cases/fallback-name/fallback-name.json` |
| no-param | no `?welcome=back` → renders nothing | `cases/no-param/no-param.json` |

## 5. Events
- **No user events** — `pointer-events: none`; the user cannot click it.
- Internal: a `setTimeout(3000)` flips `show=false` (auto-dismiss); a
  `setTimeout(50)` `history.replaceState`s the cleaned URL.
- No emitted custom events; no nav; the only fetch is the one-shot `/api/me`.
- `ev.expect(...)`: N/A for interaction — assert the rendered message text and
  that the toast disappears after 3s.

## 6. Motion (extracted — self-injected <style>, welcome-back-toast.css)
- **Entrance only:** `@keyframes pm-toast-in` — `opacity 0→1` +
  `translateY(-6px) scale(0.96) → translateY(0) scale(1)` over **280ms**
  `cubic-bezier(.34,1.56,.64,1)` (`both` fill). A single gentle drop-in pop.
- **Exit:** there is **no exit animation** — `show=false` unmounts the node
  abruptly at t=3s (FLAG: the pill pops out with no fade; consider a reverse
  `pm-toast-out` for symmetry).
- No looping/idle motion; the 👋 does not animate here (unlike the coachmark's
  waving 👋).
- **Jank finding:** none — `position:fixed` + `transform`/`opacity` entrance is
  compositor-friendly; the box is tiny.
- **Reduced motion:** the island ships its OWN guard
  (`@media (prefers-reduced-motion: reduce)` →
  `[role=status][style*="pm-toast-in"] { animation: none !important }`), in
  ADDITION to the global tokens clamp. The pill then appears instantly with no
  drop-in.

## 7. Responsive (own @media)
- **None.** It's a `position:fixed` pill pinned `top:18px right:18px` at all
  widths; content sizes to its text. On a narrow viewport with a long localized
  name it could approach the edge, but there is no media query and no max-width —
  verify it doesn't overflow at 390px during capture.

## 8. A11y
- Correctly a **live region**: `role="status"` + `aria-live="polite"` — the
  "Welcome back, …" message is announced to screen readers when it appears (the
  right semantics for a transient, non-interactive toast).
- `pointer-events: none` — not focusable, not clickable (intentional; it's
  informational and auto-dismisses).
- The 👋 avatar is `aria-hidden` (decorative).
- Reduced motion handled (own guard + global).
- **Minor:** auto-dismiss at 3s with no manual dismiss — fine for a polite status,
  but a user who needs more time can't re-summon it (it's also param-stripped, so
  refresh won't bring it back). Acceptable for a low-stakes greeting.

## 9. Used on
**`/dashboard` only.** Imported by `routes/dashboard/index.tsx`
(`import WelcomeBackToast from "../../islands/WelcomeBackToast.tsx"`), rendered
once at the route root. Triggered exclusively by the `/verify` → `/dashboard?
welcome=back` returning-user redirect. Not shared.
