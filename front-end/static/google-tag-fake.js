/* REQ-124 — the fake Google tag loader. Served in place of Google's gtag.js
 * whenever DENO_DEPLOY is unset (REQ-318: the gate, a dev box, a pin run on
 * fakes). The page's snippet has already defined gtag() and pushed `js` and
 * `config` onto window.dataLayer — which is what the e2e story reads; this
 * only marks the document so the story can tell the loader itself was
 * fetched and ran. Nothing leaves the browser. */
(function () {
  document.documentElement.setAttribute("data-google-tag-loaded", "fake");
})();
