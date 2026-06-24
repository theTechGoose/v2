# ImpersonationBanner

Persistent "you are impersonating" warning bar. Mounted **globally** in
`routes/_app.tsx`. Self-gates: renders `null` for ordinary sessions.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/ImpersonationBanner.tsx`).
- **Interaction tier:** `island` (client-only state) with a server mutation.
- **Client state owned:**
  - `who: WhoAmI | null` — result of the self-gate fetch.
  - `busy: boolean` — true while the stop-impersonating request is in flight.
- **Self-gate (data source):** on mount calls `clients/admin.ts`
  `adminClient.whoami()` → `GET /admin/whoami`. If the response's
  `who.impersonating` is falsy (or the call throws — not logged in / backend
  down), it returns `null` and renders nothing. So it is **safe to mount on
  every page**; the cost is one `/admin/whoami` request per full page load.
- **Honest-empty:** the entire component is absent unless an active impersonation
  session is detected. No skeleton, no placeholder.
- **Server mutation + feedback:**
  - "Return to your account" → `adminClient.stopImpersonating()`
    (`/admin/stop-impersonating`; server swaps the session cookie back), then
    `globalThis.location.href = "/admin"`.
  - **ANTI-PATTERN (mild, justified):** this is a full-document navigation after
    a mutation. It is *somewhat* warranted — the cookie identity changes
    server-side and every island holding the impersonated user's data must be
    rebuilt from a fresh request. The clean fix is a server-side **PRG**: have
    `/admin/stop-impersonating` respond `303 → /admin` so the browser navigates
    via the server rather than a client `location.href` (also avoids a flash of
    the stale impersonated page). Flash feedback while in flight = the button
    label switches to "Returning…" and is `disabled`.
- **Liveness:** request-response (one whoami on mount). No polling/websocket.
- **Data-shape hazards:**
  - `actingLabel` = `acting.name || acting.businessName || fmtPhone(acting.phoneNumber)`,
    falling back to `"another user"` if `who.user` is missing.
  - `who.impersonator?.name` optional → renders `(as {name})` suffix only if present.

## 2. Anatomy
```
{ who?.impersonating ? (
  <div role="status" style="...fixed maroon bar...">          ← .impersonation-banner
    <span>Impersonating <strong>{actingLabel}</strong>{ (as {impersonator.name}) }</span>
    <button onClick=stop disabled={busy}>                      ← .impersonation-banner__btn
      {busy ? "Returning…" : "Return to your account"}
    </button>
  </div>
) : null }
```
- **Slots/children:** none. **All styling inline** (no CSS classes; see
  `css/impersonation-banner.css` for the extracted literals).
- Copy is **not internationalized** (operator-only tool, English literal).

## 3. Props
None.

| name | type | default | control | signal? |
|---|---|---|---|---|
| — | — | — | — | — |

(Display data comes entirely from the `whoami` fetch.)

## 4. States → cases
| state | meaning | case |
|---|---|---|
| hidden | ordinary session / not logged in → renders nothing | `cases/hidden/hidden.json` |
| impersonating | banner shown, idle | `cases/impersonating/impersonating.json` |
| busy | "Return" clicked, request in flight (disabled, "Returning…") | `cases/busy/busy.json` |

## 5. Events
- `ev.expect(e => e.source === "button.impersonation-banner__btn" && e.type === "click")`
  → `setBusy(true)` → `stopImpersonating()` → redirect `/admin` (on failure,
  `setBusy(false)` and the banner stays).

## 6. Motion
- None. No transitions/animations. (No reduced-motion concern.) It simply pins to
  the top of the viewport with a static box-shadow.
- **Note:** being `position:fixed; top:0` it overlays page content; pages do not
  reserve space, so on impersonation sessions the very top of the underlying
  page is covered ~33px. Rebuild may want a body top-padding when active.

## 7. Responsive
- No `@media` queries. The bar is `flex-wrap: wrap`, full-width, centered — on
  narrow screens the label + button wrap to two lines. Works at all widths.

## 8. A11y
- `role="status"` so SR users are informed of the impersonation context (polite
  live region). Button is a real `<button>` with `disabled` while busy.
- **Gaps:** no `aria-live` priority beyond `status`; the maroon/white contrast is
  strong (passes). No focus management (it just appears at page top).

## 9. Used on
**Global** — `<ImpersonationBanner />` in `routes/_app.tsx`, so it is present on
every route but only visible during a super-admin impersonation session.
Evidence: import in `routes/_app.tsx`. Single global instance.
