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
 *
 * REQ-353 (demo-loop cycle 1, M40/m23): at ≤640px the greeting is the one
 * item that gives — it shrinks with an ellipsis — so the menu, the greeting
 * and the EN/ES pill always fit a 390px phone. Before, the greeting could not
 * shrink (flex-shrink:0, nowrap) and "What can I take off your plate?" pushed
 * the pill 17px past the edge: "ES" was cut off and <main> gained a hidden
 * 17px sideways range that a focus() scrolled the whole app into.
 *
 * REQ-406 (demo-loop cycle 2, m47/m15): the bar's positioning lives here, not
 * in an inline style — DashTopbar's inline `position:relative` beat the phone
 * rule's `position:sticky`, so on a phone the header with ☰ scrolled away.
 * Desktop: relative + z-index 40 (REQ-207: the search panel paints above the
 * content); phone: sticky under the impersonation banner (REQ-181). And below
 * 1250px the live-activity pill is hidden: its 220px floor (REQ-273) and the
 * search box's placeholder cannot both fit beside the greeting there, and the
 * pill was squeezing the search box to "Search a number, customer,".
 *
 * REQ-799 (one search): the phone rule no longer HIDES the search box — with
 * the Customers page's own box gone, the topbar's is the only search, so at
 * ≤640px the bar wraps and the box is its full-width second row (order 10,
 * under ☰ / greeting / EN‑ES, so EN/ES still never sits on it); only the `/`
 * hint and the ticker stay hidden there.
 *
 * REQ-726 (demo-loop cycle 5, m6): that breakpoint is now 1500px. At the 1280
 * and 1440 widths the testers used, the greeting, the search box, the pill and
 * EN/ES still shared one row: the placeholder read "Search a number, customer,
 * address or date." cut short, the sentence was clamped and the time wrapped.
 */
export const TOPBAR_CSS = `
.topbar__lang{display:flex;gap:2px;background:var(--mint-100);border:1px solid var(--border);border-radius:999px;padding:3px;flex-shrink:0;margin-left:10px}
.topbar__lang-btn{border:none;background:transparent;font-weight:800;font-size:11px;letter-spacing:.05em;color:var(--fg-muted);padding:4px 10px;border-radius:999px;cursor:pointer;transition:background 160ms,color 160ms}
.topbar__lang-btn:hover{color:var(--brand-teal)}
.topbar__lang-btn--on{background:#fff;color:var(--brand-teal);box-shadow:0 1px 3px rgba(20,72,82,.12)}
.topbar{position:relative;z-index:40}
@media (max-width:1499px){.topbar__ticker{display:none}}
@media (max-width:640px){.topbar{flex-wrap:wrap;height:auto;min-height:60px;row-gap:0}.topbar__search{display:flex;flex:1 1 100%;order:10;max-width:none;min-width:0;margin:0 0 8px}.topbar__kbd{display:none}.topbar__ticker{display:none}}
@media (max-width:640px){.topbar{position:sticky;top:var(--banner-h,0px);padding:0 12px;gap:8px}.topbar__greet{flex:1 1 auto;flex-shrink:1;min-width:0;overflow:hidden}.topbar__greet-line,.topbar__greet-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.topbar__greet-name{font-size:14px}.topbar__lang{margin-left:auto}.topbar__lang-btn{padding:4px 8px}}
`;
