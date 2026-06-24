# public-contract-view (PublicContractView)

Client-side loader for the public agreement page. Renders a skeleton
immediately, fetches the contract over the `/api` proxy, then swaps in
`ContractDoc` (or `ErrorCard`).

## 1. Classification & behavior
- **Bucket:** `island` (`islands/PublicContractView.tsx`, 90 lines).
- **Interaction tier:** `island` — client state + one fetch effect.
- **Client state owned:** a single `useState<State>` where
  `phase: "loading" | "error" | "ok"`, plus `contract?` and `message?`.
- **Server-mutation action endpoint:** none (read-only loader). No flash.
- **Data source:** `fetch("/api/contracts/:id/public")` in a `useEffect`
  keyed on `id`, with an `alive` guard to drop late responses on unmount.
  Backend: `GET /contracts/:id/public` → `ContractPublic` (data-model § 1.5).
  Auth-FREE (`accept: application/json`, no session).
  - **Honest-empty / expired:** `r.ok===false` (or a thrown fetch) →
    `phase:"error"`, message = `tFor(lang,"publicContract.linkGone")`. Renders
    `ErrorCard`. No fabricated content — a missing/expired link shows the card,
    not an empty doc.
- **Liveness:** request-response only. One fetch on mount; no polling/socket.
  After signing, `PublicSignContract` reloads the whole page (so this island
  re-mounts and re-fetches the now-signed projection).
- **Anti-patterns:** none in this island itself (clean fetch + guard). It does
  inherit the page's `location.reload()` flow from the sign island.
- **Data-shape hazards:** the fetched `ContractPublic` is the composite-read
  join (hazard #7) — but the cost is on the backend; the island just consumes
  it.

## 2. Anatomy
- **OK:** returns `<ContractDoc contract={s.contract} />` (no wrapper of its own).
- **Error:** returns `<ErrorCard message=… />` (exported from contract-doc).
- **Loading:** returns a local `LoadingSkeleton` — an inline `<style>` with the
  `ctr-skel` opacity-pulse keyframe + a mimic of the doc card: brand-strip bar,
  pink/teal ribbon (`#144852→#0e333b`), and 5 staggered placeholder bars
  (widths 220/320/140/280/200, `animation-delay i*0.08s`) + a 120px block.
  Fill colours `#e3e8e6`/`#e9edeb`/`#eef2f0`; card `#fffdf7` radius 24.
- All inline-styled; no CSS classes.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `id` | string (required) | — | text | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no (used only for the error copy) |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| loading | skeleton shimmer, fetch in flight | `cases/loading/loading.json` |
| error | non-ok fetch → ErrorCard | `cases/error/error.json` |
| ok | fetch resolves → ContractDoc | `cases/ok/ok.json` |

Cases use `_mocks` to stub the `/api/contracts/:id/public` response (delay for
loading, 404 for error, full `ContractPublic` body for ok).

## 5. Events
- No user events. The only "event" is the mount effect firing the fetch:
  `ev.expect(net => net.url.endsWith("/api/contracts/"+id+"/public") && net.method==="GET")`.

## 6. Motion (real CSS)
- `@keyframes ctr-skel { 0%,100%{opacity:.55} 50%{opacity:.85} }` — a slow
  opacity pulse on the placeholder bars, 1.2s ease-in-out infinite, staggered.
- **Reduced-motion gap (flag):** no component-local `prefers-reduced-motion`
  guard, and the public surface does NOT load the Sabor tokens' global clamp,
  so the pulse keeps running under reduced-motion. Rebuild should add a guard.
- The skeleton→doc swap is an instant replace (no cross-fade).

## 7. Responsive
- None of its own — it fills the route's `max-width:760px` column. Skeleton bar
  widths use `max-width:100%` so they don't overflow narrow phones.

## 8. A11y
- Skeleton bars are decorative (no text, no `aria`). The error card is plain
  text. The OK path delegates to `ContractDoc`. No live-region announcement of
  the loading→ready transition (minor).

## 9. Used on
- **public-contract route** (`routes/c/[id].tsx`) — the only mount point. It is
  the route's sole child; it renders `ContractDoc`/`ErrorCard`.
