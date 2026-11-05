/* REQ-183 — the fake Google Tag Manager loader. Served in place of Google's
 * gtm.js whenever DENO_DEPLOY is unset (REQ-318: the gate, a dev box, a pin
 * run on fakes). The page's snippet has already pushed gtm.start onto
 * window.dataLayer — which is what the e2e story reads; this only marks the
 * document so the story can tell the loader itself was fetched and ran.
 * Nothing leaves the browser. */
(function () {
  document.documentElement.setAttribute("data-gtm-loaded", "fake");
})();
