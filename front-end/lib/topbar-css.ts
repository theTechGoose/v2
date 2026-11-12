/**
 * REQ-223 — the DashTopbar island's own chrome CSS: the EN/ES toggle and the
 * phone rule that hides the search box and the ticker.
 *
 * These rules used to live only in static/dashboard.css, so a route that
 * renders DashTopbar but links another stylesheet (/assistant links only
 * assistant-page.css) showed the toggle as two grey browser-default boxes and,
 * at 390px, squeezed them on top of a still-visible search box (demo issues
 * i18n-formatting-m11 and i18n-formatting-m6). DashTopbar renders this string
 * in a <style> inside the island — part of its vdom, so hydration keeps it
 * (a route-level <style> can be dropped, see GlobalSearch) — and every route
 * that renders the bar gets the same chrome.
 */
export const TOPBAR_CSS = `
.topbar__lang{display:flex;gap:2px;background:var(--mint-100);border:1px solid var(--border);border-radius:999px;padding:3px;flex-shrink:0;margin-left:10px}
.topbar__lang-btn{border:none;background:transparent;font-weight:800;font-size:11px;letter-spacing:.05em;color:var(--fg-muted);padding:4px 10px;border-radius:999px;cursor:pointer;transition:background 160ms,color 160ms}
.topbar__lang-btn:hover{color:var(--brand-teal)}
.topbar__lang-btn--on{background:#fff;color:var(--brand-teal);box-shadow:0 1px 3px rgba(20,72,82,.12)}
@media (max-width:640px){.topbar__search{display:none}.topbar__ticker{display:none}}
`;
