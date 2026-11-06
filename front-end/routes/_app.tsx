import { define } from "../utils.ts";
import MobileViewport from "../islands/MobileViewport.tsx";
import ImpersonationBanner from "../islands/ImpersonationBanner.tsx";
import DemoModeOverlay from "../islands/DemoModeOverlay.tsx";
import HtmlLang from "../islands/HtmlLang.tsx";
import MetaPixel from "../components/MetaPixel.tsx";
import GoogleTag from "../components/GoogleTag.tsx";
import CrazyEgg from "../components/CrazyEgg.tsx";
import { readSessionCookie } from "../lib/api.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import { langFromCookie } from "../lib/lang.ts";
import { pmLangFromAcceptLanguage } from "../../shared/quote-flow/public-lang.ts";

// Browser-side `lib/api.ts` reads window.__PUBLIC_BACKEND_URL to decide
// where to POST. Inline the SSR-side env so islands hit the standalone
// backend (api.aimonsters.com in prod, ngrok in dev) instead of bouncing
// through the Fresh /api/* proxy.
const PUBLIC_BACKEND_URL = typeof Deno !== "undefined"
  ? Deno.env.get("PUBLIC_BACKEND_URL") ?? ""
  : "";

// The app has NO service worker of its own, so any registration/CacheStorage
// found on this origin is a leftover (e.g. another project once served on
// this localhost port) that keeps serving STALE JS across tabs and server
// restarts. Purge it and reload once so the page picks up fresh modules.
// sessionStorage-guarded so a failed purge can never reload-loop.
const SW_PURGE_SCRIPT = `(async()=>{try{
var regs=navigator.serviceWorker?await navigator.serviceWorker.getRegistrations():[];
var keys=self.caches?await caches.keys():[];
if((regs.length||keys.length)&&!sessionStorage.getItem("pm:sw-purged")){
sessionStorage.setItem("pm:sw-purged","1");
await Promise.all(regs.map(function(r){return r.unregister()}));
await Promise.all(keys.map(function(k){return caches.delete(k)}));
console.warn("[pm] purged stale service worker/caches — reloading");
location.reload();}
}catch(_e){}})();`;

// REQ-189 — a page whose island code fails to load reloads itself ONCE. A browser that kept an
// island module from before an edit (Safari did, ignoring Vite's no-cache) imports a module that
// no longer exists, the module script fails, and nothing on the page hydrates. On the module
// script's error event (capture — it does not bubble) or the import-failure rejection (Safari:
// "Importing a module script failed."; Chromium/Firefox: "… dynamically imported module"), every
// module the page loaded is refetched bypassing the cache and the page reloads. At most once per
// 30 s per tab (sessionStorage), so a page that is really broken never loops.
// AMENDMENT — Safari reuses module scripts across navigations whatever the cache headers say (the
// replica frame ran an old sidebar silently, no error to recover from). On a dev host, after every
// load, each module the page loaded is refetched bypassing the cache (which refreshes Safari's
// copy) and its ETag compared with the one this tab saw last time; any change means the page
// just ran stale code, so it reloads once (same 30 s cooldown) and runs the fresh copy.
const MODULE_RECOVERY_SCRIPT = `(function(){try{
var done=false;
function recover(){
var last=Number(sessionStorage.getItem("pm:module-reloaded")||0);
if(done||Date.now()-last<30000)return;
done=true;sessionStorage.setItem("pm:module-reloaded",String(Date.now()));
var urls=performance.getEntriesByType("resource").map(function(e){return e.name}).filter(function(u){return /\\/@id\\/|\\/@fs\\/|\\.[jt]sx?(\\?|$)/.test(u)});
console.warn("[pm] island code failed to load — refetching "+urls.length+" modules and reloading once");
Promise.all(urls.map(function(u){return fetch(u,{cache:"reload"}).catch(function(){})})).then(function(){location.reload()},function(){location.reload()});
}
document.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="SCRIPT"&&t.type==="module")recover()},true);
if(/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)){
window.addEventListener("load",function(){
var urls=performance.getEntriesByType("resource").map(function(e){return e.name}).filter(function(u){return /\\/@id\\/|\\/@fs\\/|\\.[jt]sx?(\\?|$)/.test(u)});
var prev={};try{prev=JSON.parse(sessionStorage.getItem("pm:module-etags")||"{}")}catch(_e){}
var next={},changed=[];
Promise.all(urls.map(function(u){return fetch(u,{cache:"reload"}).then(function(r){var e=r.headers.get("etag")||"";if(e)next[u]=e;if(e&&prev[u]&&prev[u]!==e)changed.push(u)}).catch(function(){})})).then(function(){
sessionStorage.setItem("pm:module-etags",JSON.stringify(next));
if(changed.length===0)return;
var last=Number(sessionStorage.getItem("pm:module-reloaded")||0);
if(Date.now()-last<30000)return;
sessionStorage.setItem("pm:module-reloaded",String(Date.now()));
console.warn("[pm] "+changed.length+" dev module(s) changed since this tab's cache — reloading once");
location.reload();
});
});}
window.addEventListener("unhandledrejection",function(e){var m=e.reason&&(e.reason.message||String(e.reason))||"";if(/Importing a module script failed|dynamically imported module/i.test(m))recover()});
}catch(_e){}})();`;

export default define.page(function App(ctx) {
  const { Component } = ctx;
  const bootScript = (PUBLIC_BACKEND_URL
    ? `window.__PUBLIC_BACKEND_URL=${JSON.stringify(PUBLIC_BACKEND_URL)};`
    : "") + SW_PURGE_SCRIPT + MODULE_RECOVERY_SCRIPT;
  // P-67: only mount the impersonation banner when the request actually
  // carries a session cookie. pm_session is HttpOnly, so the island can't
  // gate itself client-side — without this SSR gate it probed
  // /api/admin/whoami on EVERY page for anonymous visitors too, spraying
  // transient 5xx/refused noise across login/logout transitions.
  const hasSession =
    readSessionCookie(ctx.req.headers.get("cookie")) !== undefined;
  // SSR-resolve <html lang> so the very first paint declares the right
  // language (screen readers, crawlers, browser translate prompts).
  //
  // A page that resolved its own language says so on ctx.state.lang (REQ-122:
  // the public pages — the four legal pages and /contact — through
  // lib/public-page.ts) and the shell labels <html> with THAT: those pages are
  // Spanish-first regardless of the browser, and guessing from Accept-Language
  // here labelled a Spanish page "en" for every English browser. Otherwise:
  // an explicit ?lang= is the strongest signal (a Spanish ad set links
  // "/?lang=es"), then the visitor's persisted pm_lang choice. With neither:
  // the two marketing landings are Spanish-first BY PRODUCT DECISION
  // (lib/lang.ts pickLangFromAcceptLanguage) and render ES regardless of the
  // browser, so <html lang> must say "es" to match what they actually paint;
  // every other surface — the public customer documents, the branded 404 —
  // follows the visitor's own Accept-Language, which is why English pages
  // used to be mislabelled <html lang="es">.
  const url = new URL(ctx.req.url);
  const qLang = url.searchParams.get("lang");
  const spanishFirst = url.pathname === "/" || url.pathname === "/landing" ||
    url.pathname === "/landing2" || url.pathname === "/landing3" ||
    url.pathname === "/landing4" || url.pathname === "/landing5";
  const lang: Lang = ctx.state.lang ??
    ((qLang === "en" || qLang === "es")
      ? qLang
      : langFromCookie(ctx.req?.headers?.get("cookie")) ??
        (spanishFirst ? "es" : pmLangFromAcceptLanguage(
          ctx.req?.headers?.get("accept-language"),
        ) ??
          "es"));
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="theme-color" content="#144852" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <title>{tFor(lang, "brand.name")}</title>
        {
          /* REQ-124: the Google tag (gtag.js, G-RN3H6L5263) on every page —
            Google's loader on the real deploy, the app's own fake on the gate
            and a dev box. */
        }
        <GoogleTag />
        {
          /* REQ-080: the Meta Pixel, on the ad funnel's pages only (the two
            landings, the code page, the welcome wizard, the plan pages,
            settings, login) — Meta's loader on the real deploy with
            META_PIXEL_ID set, the app's own fake on the gate and a dev box,
            nothing on the real deploy without an id. */
        }
        <MetaPixel path={url.pathname} />
        {
          /* REQ-125: Crazy Egg's tracking script, on /landing2 alone — theirs
            on the real deploy, the app's own fake on the gate and a dev box. */
        }
        <CrazyEgg path={url.pathname} />
        {bootScript
          ? (
            <script
              // Server-built boot script (no user input).
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{ __html: bootScript }}
            />
          )
          : null}
      </head>
      <body>
        {
          /* Global keyboard handling: mirrors visualViewport.height into
            --app-vh on every page. iOS Safari overlays the soft keyboard
            without shrinking 100dvh, so page shells anchored to --app-vh
            track the space above the keyboard (inputs/buttons never get
            trapped behind it). Android is covered by interactive-widget
            above; this makes iOS behave the same. Renders nothing. */
        }
        <MobileViewport />
        {
          /* Keeps <html lang> in sync with the in-app language toggle
            (langSignal) after hydration. SSR sets the initial value above from
            the pm_lang cookie; this covers the logged-in case where the
            language comes from the user's profile (no cookie). Renders
            nothing. */
        }
        <HtmlLang initial={lang} />
        {
          /* Global super-admin impersonation banner. Mounted only for
            requests that carry a session cookie (SSR gate above); it then
            self-gates on /admin/whoami — renders nothing for ordinary
            sessions. */
        }
        {hasSession ? <ImpersonationBanner /> : null}
        {/* REQ-153 — demo mode: self-gates on /demo-mode/active, renders nothing otherwise. */}
        {hasSession ? <DemoModeOverlay /> : null}
        <Component />
      </body>
    </html>
  );
});
