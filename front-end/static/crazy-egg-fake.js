/* REQ-125 — the fake Crazy Egg script. Served in place of Crazy Egg's own
 * whenever DENO_DEPLOY is unset (REQ-318: the gate, a dev box, a pin run on
 * fakes). It only marks the document so the e2e story can tell the tag was
 * fetched and ran. Nothing leaves the browser. */
(function () {
  document.documentElement.setAttribute("data-crazy-egg-loaded", "fake");
})();
